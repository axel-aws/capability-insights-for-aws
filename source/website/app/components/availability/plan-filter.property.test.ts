import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createFilteringFunction, itemMatchesPlan } from './availability-table-properties';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import type { RegionalAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import type { CapabilitySet } from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';
import type {
  PropertyFilterQuery,
  PropertyFilterToken,
  PropertyFilterTokenGroup,
} from '@cloudscape-design/collection-hooks';

/**
 * Property-based tests for plan filter integration.
 * Feature: infrastructure-planning, Property 14: Plan filter composition with AND/OR
 * **Validates: Requirements 6.6**
 */

// --- Generators ---

/** Generate a valid AWS service name */
const serviceNameArb = fc.constantFrom(
  'Amazon S3',
  'AWS Lambda',
  'Amazon DynamoDB',
  'Amazon EC2',
  'Amazon SQS',
  'Amazon SNS',
  'AWS CloudFormation',
  'Amazon RDS',
);

/** Generate a valid CFN resource type */
const cfnResourceTypeArb = fc.constantFrom(
  'AWS::S3::Bucket',
  'AWS::Lambda::Function',
  'AWS::DynamoDB::Table',
  'AWS::EC2::Instance',
  'AWS::SQS::Queue',
  'AWS::SNS::Topic',
  'AWS::CloudFormation::Stack',
  'AWS::RDS::DBInstance',
);

/** Generate a valid API operation */
const apiOperationArb = fc.constantFrom(
  's3:GetObject',
  's3:PutObject',
  'lambda:Invoke',
  'dynamodb:GetItem',
  'ec2:DescribeInstances',
  'sqs:SendMessage',
  'sns:Publish',
  'rds:DescribeDBInstances',
);

/** Generate a CapabilitySet with random subsets of known values */
const capabilitySetArb: fc.Arbitrary<CapabilitySet> = fc.record({
  cfnResourceTypes: fc.subarray(
    [
      'AWS::S3::Bucket',
      'AWS::Lambda::Function',
      'AWS::DynamoDB::Table',
      'AWS::EC2::Instance',
      'AWS::SQS::Queue',
      'AWS::SNS::Topic',
      'AWS::CloudFormation::Stack',
      'AWS::RDS::DBInstance',
    ],
    { minLength: 1, maxLength: 5 },
  ),
  terraformResourceTypes: fc.constant([]),
  apiOperations: fc.subarray(
    [
      's3:GetObject',
      's3:PutObject',
      'lambda:Invoke',
      'dynamodb:GetItem',
      'ec2:DescribeInstances',
      'sqs:SendMessage',
      'sns:Publish',
      'rds:DescribeDBInstances',
    ],
    { minLength: 0, maxLength: 4 },
  ),
  serviceNames: fc.subarray(
    [
      'Amazon S3',
      'AWS Lambda',
      'Amazon DynamoDB',
      'Amazon EC2',
      'Amazon SQS',
      'Amazon SNS',
      'AWS CloudFormation',
      'Amazon RDS',
    ],
    { minLength: 1, maxLength: 5 },
  ),
  terraformToCfnMapping: fc.constant({}),
});

/** Known region codes for generating region filter tokens */
const KNOWN_REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1'] as const;
const AVAILABILITY_VALUES = ['Available', 'Not Available'] as const;

/** Generate a RegionalAvailability item of type SERVICE */
const serviceItemArb: fc.Arbitrary<RegionalAvailability> = fc.record({
  id: fc.constant('svc-1'),
  parentId: fc.constant(null),
  name: serviceNameArb,
  regionalAvailabilityType: fc.constant(RegionalAvailabilityType.SERVICE),
  regionalAvailability: fc.record({
    'us-east-1': fc.constantFrom(...AVAILABILITY_VALUES),
    'us-west-2': fc.constantFrom(...AVAILABILITY_VALUES),
    'eu-west-1': fc.constantFrom(...AVAILABILITY_VALUES),
  }),
});

/** Generate a RegionalAvailability item of type RESOURCE_TYPE */
const resourceTypeItemArb: fc.Arbitrary<RegionalAvailability> = fc.record({
  id: fc.constant('rt-1'),
  parentId: fc.constant('svc-1'),
  name: cfnResourceTypeArb,
  regionalAvailabilityType: fc.constant(RegionalAvailabilityType.RESOURCE_TYPE),
  regionalAvailability: fc.record({
    'us-east-1': fc.constantFrom(...AVAILABILITY_VALUES),
    'us-west-2': fc.constantFrom(...AVAILABILITY_VALUES),
    'eu-west-1': fc.constantFrom(...AVAILABILITY_VALUES),
  }),
});

/** Generate a RegionalAvailability item of type OPERATION */
const operationItemArb: fc.Arbitrary<RegionalAvailability> = fc.record({
  id: fc.constant('op-1'),
  parentId: fc.constant('sdk-1'),
  name: apiOperationArb,
  regionalAvailabilityType: fc.constant(RegionalAvailabilityType.OPERATION),
  regionalAvailability: fc.record({
    'us-east-1': fc.constantFrom(...AVAILABILITY_VALUES),
    'us-west-2': fc.constantFrom(...AVAILABILITY_VALUES),
    'eu-west-1': fc.constantFrom(...AVAILABILITY_VALUES),
  }),
});

/** Generate a non-plan filter token (name, type, or region) */
const nonPlanTokenArb: fc.Arbitrary<PropertyFilterToken> = fc.oneof(
  // Name filter token
  fc.record({
    propertyKey: fc.constant('name' as string),
    operator: fc.constantFrom('=' as const, '!=' as const, ':' as const, '!:' as const),
    value: fc.constantFrom(
      'Amazon S3',
      'AWS Lambda',
      'Amazon DynamoDB',
      'AWS::S3::Bucket',
      'AWS::Lambda::Function',
      's3:GetObject',
      'lambda:Invoke',
    ),
  }),
  // Type filter token
  fc.record({
    propertyKey: fc.constant('regionalAvailabilityType' as string),
    operator: fc.constantFrom('=' as const, '!=' as const),
    value: fc.constantFrom('Service', 'Resource Type', 'Operation', 'Property'),
  }),
  // Region filter token
  fc.record({
    propertyKey: fc.constantFrom(...KNOWN_REGIONS).map(r => `region:${r}`),
    operator: fc.constantFrom('=' as const, '!=' as const),
    value: fc.constantFrom(...AVAILABILITY_VALUES),
  }),
);

/** Generate a plan filter token */
const planTokenArb: fc.Arbitrary<PropertyFilterToken> = fc.record({
  propertyKey: fc.constant('plan' as string),
  operator: fc.constantFrom('=' as const, '!=' as const),
  value: fc.constant('TestPlan'),
});

// --- Reference evaluator ---

/**
 * Reference implementation for evaluating a single non-plan, non-stack token against an item.
 * This mirrors the logic in createFilteringFunction for value resolution and matching.
 */
function referenceEvaluateNonPlanToken(item: RegionalAvailability, token: PropertyFilterToken): boolean {
  let value: string | undefined;

  if (token.propertyKey?.startsWith('region:')) {
    const regionCode = token.propertyKey.slice('region:'.length);
    value = item.regionalAvailability?.[regionCode];
  } else if (token.propertyKey === 'name') {
    value = item.name;
  } else if (token.propertyKey === 'regionalAvailabilityType') {
    value = item.regionalAvailabilityType;
  } else {
    value = undefined;
  }

  const stringValue = value ?? '';
  const tokenValues: string[] = Array.isArray(token.value) ? token.value : [token.value];

  switch (token.operator) {
    case '=':
      return tokenValues.includes(stringValue);
    case '!=':
      return !tokenValues.includes(stringValue);
    case ':':
      return tokenValues.some(tv => stringValue.toLowerCase().includes(tv.toLowerCase()));
    case '!:':
      return !tokenValues.some(tv => stringValue.toLowerCase().includes(tv.toLowerCase()));
    default:
      return false;
  }
}

/**
 * Reference implementation for evaluating a plan token against an item.
 */
function referenceEvaluatePlanToken(
  item: RegionalAvailability,
  token: PropertyFilterToken,
  capabilitySet: CapabilitySet,
  byId: Map<string, RegionalAvailability>,
): boolean {
  const matches = itemMatchesPlan(item, capabilitySet, byId);
  return token.operator === '=' ? matches : !matches;
}

// --- Tests ---

describe('Property 14: Plan filter composition with AND/OR', () => {
  /**
   * Property 14: Plan filter composition with AND/OR
   *
   * For any combination of a plan filter token with other filter tokens (name, type, region),
   * the composed filter SHALL evaluate correctly under both AND and OR operations —
   * the plan token result is combined with other token results using standard boolean logic.
   *
   * **Validates: Requirements 6.6**
   */

  it('AND composition: plan token AND non-plan token evaluates as logical conjunction', () => {
    fc.assert(
      fc.property(
        serviceItemArb,
        capabilitySetArb,
        planTokenArb,
        nonPlanTokenArb,
        (item, capabilitySet, planToken, otherToken) => {
          const items = [item];
          const planCache = new Map<string, CapabilitySet>([['TestPlan', capabilitySet]]);
          const filterFn = createFilteringFunction(items, undefined, undefined, planCache, undefined);

          // Build AND query with plan token and other token
          const query: PropertyFilterQuery = {
            operation: 'and',
            tokens: [],
            tokenGroups: [planToken, otherToken],
          };

          const actual = filterFn(item, query);

          // Compute expected: plan result AND other result
          const byId = new Map(items.map(i => [i.id, i]));
          const planResult = referenceEvaluatePlanToken(item, planToken, capabilitySet, byId);
          const otherResult = referenceEvaluateNonPlanToken(item, otherToken);
          const expected = planResult && otherResult;

          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('OR composition: plan token OR non-plan token evaluates as logical disjunction', () => {
    fc.assert(
      fc.property(
        serviceItemArb,
        capabilitySetArb,
        planTokenArb,
        nonPlanTokenArb,
        (item, capabilitySet, planToken, otherToken) => {
          const items = [item];
          const planCache = new Map<string, CapabilitySet>([['TestPlan', capabilitySet]]);
          const filterFn = createFilteringFunction(items, undefined, undefined, planCache, undefined);

          // Build OR query with plan token and other token
          const query: PropertyFilterQuery = {
            operation: 'or',
            tokens: [],
            tokenGroups: [planToken, otherToken],
          };

          const actual = filterFn(item, query);

          // Compute expected: plan result OR other result
          const byId = new Map(items.map(i => [i.id, i]));
          const planResult = referenceEvaluatePlanToken(item, planToken, capabilitySet, byId);
          const otherResult = referenceEvaluateNonPlanToken(item, otherToken);
          const expected = planResult || otherResult;

          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('AND composition with RESOURCE_TYPE items: plan AND region filter', () => {
    fc.assert(
      fc.property(
        resourceTypeItemArb,
        capabilitySetArb,
        planTokenArb,
        fc.record({
          propertyKey: fc.constantFrom(...KNOWN_REGIONS).map(r => `region:${r}`),
          operator: fc.constantFrom('=' as const, '!=' as const),
          value: fc.constantFrom(...AVAILABILITY_VALUES),
        }),
        (item, capabilitySet, planToken, regionToken) => {
          // Create a parent service item so the hierarchy is valid
          const parentService: RegionalAvailability = {
            id: 'svc-1',
            parentId: null,
            name: 'Amazon S3',
            regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
          };
          const items = [parentService, item];
          const planCache = new Map<string, CapabilitySet>([['TestPlan', capabilitySet]]);
          const filterFn = createFilteringFunction(items, undefined, undefined, planCache, undefined);

          const query: PropertyFilterQuery = {
            operation: 'and',
            tokens: [],
            tokenGroups: [planToken, regionToken],
          };

          const actual = filterFn(item, query);

          // Compute expected: plan result AND region result
          const byId = new Map(items.map(i => [i.id, i]));
          const planResult = referenceEvaluatePlanToken(item, planToken, capabilitySet, byId);
          const regionResult = referenceEvaluateNonPlanToken(item, regionToken);
          const expected = planResult && regionResult;

          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('OR composition with OPERATION items: plan OR name filter', () => {
    fc.assert(
      fc.property(
        operationItemArb,
        capabilitySetArb,
        planTokenArb,
        fc.record({
          propertyKey: fc.constant('name' as string),
          operator: fc.constantFrom('=' as const, '!=' as const, ':' as const),
          value: fc.constantFrom(
            's3:GetObject',
            'lambda:Invoke',
            'dynamodb:GetItem',
            'ec2:DescribeInstances',
            'nonexistent:Operation',
          ),
        }),
        (item, capabilitySet, planToken, nameToken) => {
          // Create a parent SDK service item
          const parentSdk: RegionalAvailability = {
            id: 'sdk-1',
            parentId: null,
            name: 'S3',
            regionalAvailabilityType: RegionalAvailabilityType.SDK_SERVICE,
          };
          const items = [parentSdk, item];
          const planCache = new Map<string, CapabilitySet>([['TestPlan', capabilitySet]]);
          const filterFn = createFilteringFunction(items, undefined, undefined, planCache, undefined);

          const query: PropertyFilterQuery = {
            operation: 'or',
            tokens: [],
            tokenGroups: [planToken, nameToken],
          };

          const actual = filterFn(item, query);

          // Compute expected: plan result OR name result
          const byId = new Map(items.map(i => [i.id, i]));
          const planResult = referenceEvaluatePlanToken(item, planToken, capabilitySet, byId);
          const nameResult = referenceEvaluateNonPlanToken(item, nameToken);
          const expected = planResult || nameResult;

          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('nested composition: (plan AND region) OR name evaluates correctly', () => {
    fc.assert(
      fc.property(
        serviceItemArb,
        capabilitySetArb,
        planTokenArb,
        fc.record({
          propertyKey: fc.constantFrom(...KNOWN_REGIONS).map(r => `region:${r}`),
          operator: fc.constant('=' as const),
          value: fc.constantFrom(...AVAILABILITY_VALUES),
        }),
        fc.record({
          propertyKey: fc.constant('name' as string),
          operator: fc.constantFrom('=' as const, ':' as const),
          value: fc.constantFrom(
            'Amazon S3',
            'AWS Lambda',
            'Amazon DynamoDB',
            'Amazon EC2',
            'NonExistentService',
          ),
        }),
        (item, capabilitySet, planToken, regionToken, nameToken) => {
          const items = [item];
          const planCache = new Map<string, CapabilitySet>([['TestPlan', capabilitySet]]);
          const filterFn = createFilteringFunction(items, undefined, undefined, planCache, undefined);

          // Build nested query: (plan AND region) OR name
          const query: PropertyFilterQuery = {
            operation: 'or',
            tokens: [],
            tokenGroups: [
              {
                operation: 'and',
                tokens: [planToken, regionToken],
              } as PropertyFilterTokenGroup,
              nameToken,
            ],
          };

          const actual = filterFn(item, query);

          // Compute expected: (plan AND region) OR name
          const byId = new Map(items.map(i => [i.id, i]));
          const planResult = referenceEvaluatePlanToken(item, planToken, capabilitySet, byId);
          const regionResult = referenceEvaluateNonPlanToken(item, regionToken);
          const nameResult = referenceEvaluateNonPlanToken(item, nameToken);
          const expected = (planResult && regionResult) || nameResult;

          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('nested composition: plan OR (region AND type) evaluates correctly', () => {
    fc.assert(
      fc.property(
        serviceItemArb,
        capabilitySetArb,
        planTokenArb,
        fc.record({
          propertyKey: fc.constantFrom(...KNOWN_REGIONS).map(r => `region:${r}`),
          operator: fc.constant('=' as const),
          value: fc.constantFrom(...AVAILABILITY_VALUES),
        }),
        fc.record({
          propertyKey: fc.constant('regionalAvailabilityType' as string),
          operator: fc.constantFrom('=' as const, '!=' as const),
          value: fc.constantFrom('Service', 'Resource Type', 'Operation'),
        }),
        (item, capabilitySet, planToken, regionToken, typeToken) => {
          const items = [item];
          const planCache = new Map<string, CapabilitySet>([['TestPlan', capabilitySet]]);
          const filterFn = createFilteringFunction(items, undefined, undefined, planCache, undefined);

          // Build nested query: plan OR (region AND type)
          const query: PropertyFilterQuery = {
            operation: 'or',
            tokens: [],
            tokenGroups: [
              planToken,
              {
                operation: 'and',
                tokens: [regionToken, typeToken],
              } as PropertyFilterTokenGroup,
            ],
          };

          const actual = filterFn(item, query);

          // Compute expected: plan OR (region AND type)
          const byId = new Map(items.map(i => [i.id, i]));
          const planResult = referenceEvaluatePlanToken(item, planToken, capabilitySet, byId);
          const regionResult = referenceEvaluateNonPlanToken(item, regionToken);
          const typeResult = referenceEvaluateNonPlanToken(item, typeToken);
          const expected = planResult || (regionResult && typeResult);

          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
