import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';
import { GitHubTokenStore } from './github-token-store';

/**
 * Property-based tests for GitHubTokenStore.
 * Uses aws-sdk-client-mock to simulate Secrets Manager behavior.
 */

const smMock = mockClient(SecretsManagerClient);
const TEST_SECRET_NAME = 'TestGitHubPAT-us-east-1';

// --- Generators ---

/**
 * Generator for valid PAT strings: non-empty, no leading/trailing whitespace.
 * These represent valid GitHub Personal Access Tokens.
 */
const validPatArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/**
 * Generator for non-empty strings (valid token values).
 * These represent tokens that have been stored in Secrets Manager.
 */
const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.length > 0);

// --- Property Tests ---

/**
 * Property 1: Token storage round-trip
 * **Validates: Requirements 4.1, 6.1, 7.1**
 *
 * For any valid PAT string (non-empty, trimmed), putToken then getToken
 * returns the exact same string.
 */
describe('Property 1: Token storage round-trip', () => {
  let store: GitHubTokenStore;

  beforeEach(() => {
    smMock.reset();
    store = new GitHubTokenStore(TEST_SECRET_NAME);
  });

  it('putToken followed by getToken returns the exact same string for any valid PAT', async () => {
    await fc.assert(
      fc.asyncProperty(validPatArb, async (token) => {
        smMock.reset();

        // Use an in-memory variable to simulate Secrets Manager storage
        let storedValue: string | undefined;

        smMock.on(PutSecretValueCommand).callsFake((input) => {
          storedValue = input.SecretString;
          return {};
        });

        smMock.on(GetSecretValueCommand).callsFake(() => {
          if (storedValue === undefined) {
            throw new ResourceNotFoundException({
              message: 'Secret not found',
              $metadata: {},
            });
          }
          return { SecretString: storedValue };
        });

        // Store the token
        await store.putToken(token);

        // Retrieve the token
        const retrieved = await store.getToken();

        // Verify exact round-trip: retrieved value must equal the stored value
        expect(retrieved).toBe(token);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 2: hasToken reflects secret state
 * **Validates: Requirements 5.1, 5.2**
 *
 * hasToken returns true if and only if a non-empty secret string exists.
 * - For any non-empty string stored via putToken, hasToken returns true
 * - When the secret is empty string (deleted state), hasToken returns false
 * - When ResourceNotFoundException is thrown (no secret), hasToken returns false
 */
describe('Property 2: hasToken reflects secret state', () => {
  let store: GitHubTokenStore;

  beforeEach(() => {
    smMock.reset();
    store = new GitHubTokenStore(TEST_SECRET_NAME);
  });

  it('hasToken returns true for any non-empty secret string stored via putToken', async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyStringArb, async (token) => {
        smMock.reset();

        // Simulate putToken succeeding
        smMock.on(PutSecretValueCommand).resolves({});

        // After putToken, getToken should return the stored value
        smMock.on(GetSecretValueCommand).resolves({
          SecretString: token,
        });

        // Store the token
        await store.putToken(token);

        // hasToken should return true for any non-empty stored value
        const result = await store.hasToken();
        expect(result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('hasToken returns false when the secret is empty string (deleted state)', async () => {
    smMock.on(GetSecretValueCommand).resolves({
      SecretString: '',
    });

    const result = await store.hasToken();
    expect(result).toBe(false);
  });

  it('hasToken returns false when ResourceNotFoundException is thrown (no secret)', async () => {
    smMock.on(GetSecretValueCommand).rejects(
      new ResourceNotFoundException({
        message: 'Secret not found',
        $metadata: {},
      }),
    );

    const result = await store.hasToken();
    expect(result).toBe(false);
  });

  it('hasToken is true iff the secret string is non-empty (property over all states)', async () => {
    const secretStateArb = fc.oneof(
      // State: non-empty secret exists → hasToken should be true
      nonEmptyStringArb.map((s) => ({ type: 'present' as const, value: s, expected: true })),
      // State: empty string (deleted) → hasToken should be false
      fc.constant({ type: 'empty' as const, value: '', expected: false }),
      // State: ResourceNotFoundException (no secret) → hasToken should be false
      fc.constant({ type: 'not_found' as const, value: undefined, expected: false }),
    );

    await fc.assert(
      fc.asyncProperty(secretStateArb, async (state) => {
        smMock.reset();

        if (state.type === 'not_found') {
          smMock.on(GetSecretValueCommand).rejects(
            new ResourceNotFoundException({
              message: 'Secret not found',
              $metadata: {},
            }),
          );
        } else {
          smMock.on(GetSecretValueCommand).resolves({
            SecretString: state.value,
          });
        }

        const result = await store.hasToken();
        expect(result).toBe(state.expected);
      }),
      { numRuns: 100 },
    );
  });
});
