import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toIamAction, IAM_SERVICE_PREFIX_OVERRIDES } from './iam-action-mapping';

/**
 * Feature: policy-enforcer, Property 5: IAM action mapping preserves service and operation identity
 * Validates: Requirements 3.3
 */
describe('Feature: policy-enforcer, Property 5: IAM action mapping preserves service and operation identity', () => {
  // Generator for random alphanumeric service names (lowercase, like real SDK service names)
  const alphanumericServiceNameArb = fc.stringMatching(/^[a-z][a-z0-9]*$/, {
    minLength: 1,
    maxLength: 30,
  });

  // Generator for PascalCase action names: starts with uppercase, followed by alphanumeric
  const pascalCaseActionNameArb = fc
    .tuple(
      fc.stringMatching(/^[A-Z]$/, { minLength: 1, maxLength: 1 }),
      fc.stringMatching(/^[a-zA-Z0-9]*$/, { minLength: 0, maxLength: 29 }),
    )
    .map(([first, rest]) => first + rest);

  // Generator for service names that ARE in the overrides table
  const overriddenServiceNameArb = fc.constantFrom(
    ...Object.keys(IAM_SERVICE_PREFIX_OVERRIDES),
  );

  // Generator for service names NOT in the overrides table
  const nonOverriddenServiceNameArb = alphanumericServiceNameArb.filter(
    name => !(name in IAM_SERVICE_PREFIX_OVERRIDES),
  );

  it('output always has the format "prefix:action" (contains exactly one colon)', () => {
    fc.assert(
      fc.property(alphanumericServiceNameArb, pascalCaseActionNameArb, (serviceName, actionName) => {
        const result = toIamAction(serviceName, actionName);

        // The result should contain exactly one colon
        const colonCount = (result.match(/:/g) || []).length;
        expect(colonCount).toBe(1);

        // The result should match the format "prefix:action"
        const parts = result.split(':');
        expect(parts).toHaveLength(2);
        expect(parts[0].length).toBeGreaterThan(0);
        expect(parts[1].length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('the action part (after the colon) is always the original apiAction unchanged', () => {
    fc.assert(
      fc.property(alphanumericServiceNameArb, pascalCaseActionNameArb, (serviceName, actionName) => {
        const result = toIamAction(serviceName, actionName);

        // Extract the action part (after the colon)
        const actionPart = result.split(':')[1];

        // The action part must be the original apiAction unchanged
        expect(actionPart).toBe(actionName);
      }),
      { numRuns: 100 },
    );
  });

  it('the prefix part is either the override value or the original service name', () => {
    fc.assert(
      fc.property(alphanumericServiceNameArb, pascalCaseActionNameArb, (serviceName, actionName) => {
        const result = toIamAction(serviceName, actionName);

        // Extract the prefix part (before the colon)
        const prefixPart = result.split(':')[0];

        // The prefix should be either the override or the original service name
        const expectedPrefix = IAM_SERVICE_PREFIX_OVERRIDES[serviceName] ?? serviceName;
        expect(prefixPart).toBe(expectedPrefix);
      }),
      { numRuns: 100 },
    );
  });

  it('for service names in the overrides table, the prefix is the override value', () => {
    fc.assert(
      fc.property(overriddenServiceNameArb, pascalCaseActionNameArb, (serviceName, actionName) => {
        const result = toIamAction(serviceName, actionName);

        // Extract the prefix part
        const prefixPart = result.split(':')[0];

        // The prefix must be the override value from the table
        expect(prefixPart).toBe(IAM_SERVICE_PREFIX_OVERRIDES[serviceName]);
      }),
      { numRuns: 100 },
    );
  });

  it('for service names NOT in the overrides table, the prefix is the original service name', () => {
    fc.assert(
      fc.property(nonOverriddenServiceNameArb, pascalCaseActionNameArb, (serviceName, actionName) => {
        const result = toIamAction(serviceName, actionName);

        // Extract the prefix part
        const prefixPart = result.split(':')[0];

        // The prefix must be the original service name (no override applied)
        expect(prefixPart).toBe(serviceName);
      }),
      { numRuns: 100 },
    );
  });
});
