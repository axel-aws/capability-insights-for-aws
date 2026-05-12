import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serializeToItem, deserializeFromItem } from './policy-config-store';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

/**
 * Feature: policy-enforcer, Property 11: Configuration serialization round-trip
 * Validates: Requirements 7.6
 */
describe('Feature: policy-enforcer, Property 11: Configuration serialization round-trip', () => {
  // Generator for valid ISO 8601 timestamps
  const isoTimestampArb = fc
    .integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-12-31').getTime() })
    .map(ms => new Date(ms).toISOString());

  // Generator for valid policy status
  const policyStatusArb = fc.constantFrom('active' as const, 'pending' as const, 'error' as const);

  // Generator for valid refresh outcome
  const refreshOutcomeArb = fc.constantFrom('success' as const, 'retained' as const, 'error' as const);

  // Generator for valid policy tags
  const policyTagArb = fc.record({
    key: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
    value: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  });

  // Generator for valid exception entries
  const exceptionEntryArb = fc.record({
    action: fc
      .tuple(
        fc.stringMatching(/^[a-zA-Z0-9-]+$/, { minLength: 1, maxLength: 20 }),
        fc.oneof(
          fc
            .tuple(
              fc.stringMatching(/^[A-Z]$/, { minLength: 1, maxLength: 1 }),
              fc.stringMatching(/^[a-zA-Z0-9]*$/, { minLength: 0, maxLength: 15 }),
            )
            .map(([first, rest]) => first + rest),
          fc.constant('*'),
        ),
      )
      .map(([prefix, action]) => `${prefix}:${action}`),
    reason: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    addedAt: isoTimestampArb,
  });

  // Generator for valid AWS region codes
  const regionArb = fc.constantFrom(
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2',
    'eu-west-1',
    'eu-west-2',
    'eu-central-1',
    'ap-southeast-1',
    'ap-northeast-1',
    'sa-east-1',
  );

  // Generator for valid PolicyConfiguration objects
  const policyConfigurationArb: fc.Arbitrary<PolicyConfiguration> = fc.record({
    policyId: fc.uuid(),
    policyName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    description: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
    tags: fc.array(policyTagArb, { minLength: 0, maxLength: 5 }),
    regions: fc.uniqueArray(regionArb, { minLength: 1, maxLength: 5 }),
    mode: fc.constantFrom('intersection' as const, 'union' as const),
    policyType: fc.constantFrom('IAM' as const, 'SCP' as const),
    exceptions: fc.array(exceptionEntryArb, { minLength: 0, maxLength: 5 }),
    refreshIntervalHours: fc.integer({ min: 1, max: 24 }),
    status: policyStatusArb,
    policyArn: fc.option(
      fc.string({ minLength: 10, maxLength: 80 }).map(s => `arn:aws:iam::123456789012:policy/${s}`),
      { nil: undefined },
    ),
    additionalPolicyArns: fc.option(
      fc.array(
        fc.string({ minLength: 5, maxLength: 30 }).map(s => `arn:aws:iam::123456789012:policy/${s}`),
        { minLength: 1, maxLength: 3 },
      ),
      { nil: undefined },
    ),
    lastRefreshTime: fc.option(isoTimestampArb, { nil: undefined }),
    lastRefreshOutcome: fc.option(refreshOutcomeArb, { nil: undefined }),
    lastActionCount: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: undefined }),
    stackId: fc.option(fc.uuid().map(id => `arn:aws:cloudformation:us-east-1:123456789012:stack/test/${id}`), {
      nil: undefined,
    }),
    createdAt: isoTimestampArb,
    updatedAt: isoTimestampArb,
  });

  it('serializing to DynamoDB item format and deserializing back produces a deeply equal configuration', () => {
    fc.assert(
      fc.property(policyConfigurationArb, (config: PolicyConfiguration) => {
        // Serialize to DynamoDB item format
        const item = serializeToItem(config);

        // Deserialize back to PolicyConfiguration
        const deserialized = deserializeFromItem(item);

        // Assert deep equality with original
        expect(deserialized).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  it('serialization preserves all fields including optional ones when present', () => {
    // Generate configs where all optional fields are present
    const fullConfigArb = fc.record({
      policyId: fc.uuid(),
      policyName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      description: fc.string({ minLength: 1, maxLength: 200 }),
      tags: fc.array(policyTagArb, { minLength: 1, maxLength: 5 }),
      regions: fc.uniqueArray(regionArb, { minLength: 1, maxLength: 5 }),
      mode: fc.constantFrom('intersection' as const, 'union' as const),
      policyType: fc.constantFrom('IAM' as const, 'SCP' as const),
      exceptions: fc.array(exceptionEntryArb, { minLength: 1, maxLength: 5 }),
      refreshIntervalHours: fc.integer({ min: 1, max: 24 }),
      status: policyStatusArb,
      policyArn: fc.string({ minLength: 5, maxLength: 30 }).map(s => `arn:aws:iam::123456789012:policy/${s}`),
      additionalPolicyArns: fc.array(
        fc.string({ minLength: 5, maxLength: 30 }).map(s => `arn:aws:iam::123456789012:policy/${s}`),
        { minLength: 1, maxLength: 3 },
      ),
      lastRefreshTime: isoTimestampArb,
      lastRefreshOutcome: refreshOutcomeArb,
      lastActionCount: fc.integer({ min: 0, max: 10000 }),
      stackId: fc.uuid().map(id => `arn:aws:cloudformation:us-east-1:123456789012:stack/test/${id}`),
      createdAt: isoTimestampArb,
      updatedAt: isoTimestampArb,
    });

    fc.assert(
      fc.property(fullConfigArb, (config: PolicyConfiguration) => {
        const item = serializeToItem(config);
        const deserialized = deserializeFromItem(item);

        // All fields should be preserved
        expect(deserialized.policyId).toBe(config.policyId);
        expect(deserialized.policyName).toBe(config.policyName);
        expect(deserialized.description).toBe(config.description);
        expect(deserialized.tags).toEqual(config.tags);
        expect(deserialized.regions).toEqual(config.regions);
        expect(deserialized.mode).toBe(config.mode);
        expect(deserialized.policyType).toBe(config.policyType);
        expect(deserialized.exceptions).toEqual(config.exceptions);
        expect(deserialized.refreshIntervalHours).toBe(config.refreshIntervalHours);
        expect(deserialized.status).toBe(config.status);
        expect(deserialized.policyArn).toBe(config.policyArn);
        expect(deserialized.additionalPolicyArns).toEqual(config.additionalPolicyArns);
        expect(deserialized.lastRefreshTime).toBe(config.lastRefreshTime);
        expect(deserialized.lastRefreshOutcome).toBe(config.lastRefreshOutcome);
        expect(deserialized.lastActionCount).toBe(config.lastActionCount);
        expect(deserialized.stackId).toBe(config.stackId);
        expect(deserialized.createdAt).toBe(config.createdAt);
        expect(deserialized.updatedAt).toBe(config.updatedAt);
      }),
      { numRuns: 100 },
    );
  });

  it('serialization preserves structure when optional fields are absent', () => {
    // Generate configs with minimal optional fields (all undefined)
    const minimalConfigArb = fc.record({
      policyId: fc.uuid(),
      policyName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      description: fc.constant(undefined),
      tags: fc.constant([] as { key: string; value: string }[]),
      regions: fc.uniqueArray(regionArb, { minLength: 1, maxLength: 3 }),
      mode: fc.constantFrom('intersection' as const, 'union' as const),
      policyType: fc.constantFrom('IAM' as const, 'SCP' as const),
      exceptions: fc.constant([] as { action: string; reason?: string; addedAt: string }[]),
      refreshIntervalHours: fc.integer({ min: 1, max: 24 }),
      status: policyStatusArb,
      policyArn: fc.constant(undefined),
      additionalPolicyArns: fc.constant(undefined),
      lastRefreshTime: fc.constant(undefined),
      lastRefreshOutcome: fc.constant(undefined),
      lastActionCount: fc.constant(undefined),
      stackId: fc.constant(undefined),
      createdAt: isoTimestampArb,
      updatedAt: isoTimestampArb,
    });

    fc.assert(
      fc.property(minimalConfigArb, (config: PolicyConfiguration) => {
        const item = serializeToItem(config);
        const deserialized = deserializeFromItem(item);

        expect(deserialized).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });
});
