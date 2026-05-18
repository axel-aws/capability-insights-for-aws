import { describe, it, expect, beforeEach } from 'vitest';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';
import { GitHubTokenStore } from './github-token-store';

/**
 * Unit tests for GitHubTokenStore.
 * Validates: Requirements 4.1, 5.1, 5.2, 6.1, 6.2
 */

const smMock = mockClient(SecretsManagerClient);
const TEST_SECRET_NAME = 'TestGitHubPAT-us-east-1';

describe('GitHubTokenStore', () => {
  let store: GitHubTokenStore;

  beforeEach(() => {
    smMock.reset();
    store = new GitHubTokenStore(TEST_SECRET_NAME);
  });

  describe('getToken', () => {
    it('returns the secret string when it exists', async () => {
      smMock.on(GetSecretValueCommand).resolves({
        SecretString: 'ghp_abc123token',
      });

      const result = await store.getToken();

      expect(result).toBe('ghp_abc123token');
    });

    it('returns undefined when ResourceNotFoundException is thrown', async () => {
      smMock.on(GetSecretValueCommand).rejects(
        new ResourceNotFoundException({
          message: 'Secret not found',
          $metadata: {},
        }),
      );

      const result = await store.getToken();

      expect(result).toBeUndefined();
    });

    it('returns undefined when SecretString is empty', async () => {
      smMock.on(GetSecretValueCommand).resolves({
        SecretString: '',
      });

      const result = await store.getToken();

      expect(result).toBeUndefined();
    });

    it('throws for non-recoverable errors', async () => {
      smMock.on(GetSecretValueCommand).rejects(new Error('Access denied'));

      await expect(store.getToken()).rejects.toThrow('Access denied');
    });

    it('passes the correct SecretId to GetSecretValueCommand', async () => {
      smMock.on(GetSecretValueCommand).resolves({
        SecretString: 'ghp_token',
      });

      await store.getToken();

      const call = smMock.commandCalls(GetSecretValueCommand)[0];
      expect(call.args[0].input).toEqual({ SecretId: TEST_SECRET_NAME });
    });
  });

  describe('hasToken', () => {
    it('returns true when a non-empty secret exists', async () => {
      smMock.on(GetSecretValueCommand).resolves({
        SecretString: 'ghp_validtoken',
      });

      const result = await store.hasToken();

      expect(result).toBe(true);
    });

    it('returns false when no secret exists (ResourceNotFoundException)', async () => {
      smMock.on(GetSecretValueCommand).rejects(
        new ResourceNotFoundException({
          message: 'Secret not found',
          $metadata: {},
        }),
      );

      const result = await store.hasToken();

      expect(result).toBe(false);
    });

    it('returns false when secret is empty string', async () => {
      smMock.on(GetSecretValueCommand).resolves({
        SecretString: '',
      });

      const result = await store.hasToken();

      expect(result).toBe(false);
    });
  });

  describe('putToken', () => {
    it('calls PutSecretValueCommand with correct params', async () => {
      smMock.on(PutSecretValueCommand).resolves({});

      await store.putToken('ghp_newtoken456');

      const call = smMock.commandCalls(PutSecretValueCommand)[0];
      expect(call.args[0].input).toEqual({
        SecretId: TEST_SECRET_NAME,
        SecretString: 'ghp_newtoken456',
      });
    });

    it('throws when Secrets Manager write fails', async () => {
      smMock.on(PutSecretValueCommand).rejects(new Error('Service unavailable'));

      await expect(store.putToken('ghp_token')).rejects.toThrow('Service unavailable');
    });
  });

  describe('deleteToken', () => {
    it('calls PutSecretValueCommand with empty string', async () => {
      smMock.on(PutSecretValueCommand).resolves({});

      await store.deleteToken();

      const call = smMock.commandCalls(PutSecretValueCommand)[0];
      expect(call.args[0].input).toEqual({
        SecretId: TEST_SECRET_NAME,
        SecretString: '',
      });
    });

    it('throws when Secrets Manager write fails', async () => {
      smMock.on(PutSecretValueCommand).rejects(new Error('Throttled'));

      await expect(store.deleteToken()).rejects.toThrow('Throttled');
    });
  });
});
