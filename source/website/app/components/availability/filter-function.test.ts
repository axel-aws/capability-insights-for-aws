import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createFilteringFunction } from './availability-table-properties';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import type { RegionalAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import type { PropertyFilterQuery, PropertyFilterToken, PropertyFilterTokenGroup } from '@cloudscape-design/collection-hooks';

function makeItem(overrides: Partial<RegionalAvailability> & { id: string }): RegionalAvailability {
  return { parentId: null, name: '', regionalAvailabilityType: RegionalAvailabilityType.SERVICE, ...overrides };
}

function filterItems(items: RegionalAvailability[], query: PropertyFilterQuery): RegionalAvailability[] {
  const filterFn = createFilteringFunction(items);
  return items.filter(item => filterFn(item, query));
}

const ec2 = makeItem({ id: 'svc-ec2', name: 'EC2', regionalAvailability: { 'us-east-1': 'Available', 'us-gov-west-1': 'Available', 'us-gov-east-1': 'Not Available' } });
const instance = makeItem({ id: 'rt-instance', parentId: 'svc-ec2', name: 'Instance', regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE, regionalAvailability: { 'us-east-1': 'Available', 'us-gov-west-1': 'Available', 'us-gov-east-1': 'Available' } });
const s3 = makeItem({ id: 'svc-s3', name: 'S3', regionalAvailability: { 'us-east-1': 'Available', 'us-gov-west-1': 'Not Available', 'us-gov-east-1': 'Available' } });
const bucket = makeItem({ id: 'rt-bucket', parentId: 'svc-s3', name: 'Bucket', regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE, regionalAvailability: { 'us-east-1': 'Available', 'us-gov-west-1': 'Not Available', 'us-gov-east-1': 'Available' } });
const lambda = makeItem({ id: 'svc-lambda', name: 'Lambda', regionalAvailability: { 'us-east-1': 'Not Available', 'us-gov-west-1': 'Not Available', 'us-gov-east-1': 'Not Available' } });
const fn = makeItem({ id: 'rt-function', parentId: 'svc-lambda', name: 'Function', regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE, regionalAvailability: { 'us-east-1': 'Not Available', 'us-gov-west-1': 'Not Available', 'us-gov-east-1': 'Not Available' } });
const allItems = [ec2, instance, s3, bucket, lambda, fn];

describe('OR queries', () => {
  it('returns rows matching either OR condition', () => {
    const query: PropertyFilterQuery = { operation: 'or', tokens: [], tokenGroups: [
      { propertyKey: 'region:us-gov-west-1', operator: '=', value: 'Available' },
      { propertyKey: 'region:us-gov-east-1', operator: '=', value: 'Available' },
    ]};
    const ids = new Set(filterItems(allItems, query).map(r => r.id));
    expect(ids.has('svc-ec2')).toBe(true);
    expect(ids.has('rt-instance')).toBe(true);
    expect(ids.has('svc-s3')).toBe(true);
    expect(ids.has('svc-lambda')).toBe(false);
    expect(ids.has('rt-function')).toBe(false);
  });
});

describe('AND queries', () => {
  it('returns rows matching both AND conditions', () => {
    const query: PropertyFilterQuery = { operation: 'and', tokens: [], tokenGroups: [
      { propertyKey: 'region:us-east-1', operator: '=', value: 'Available' },
      { propertyKey: 'name', operator: ':', value: 'EC2' },
    ]};
    const ids = new Set(filterItems(allItems, query).map(r => r.id));
    expect(ids.has('svc-ec2')).toBe(true);
    expect(ids.has('rt-instance')).toBe(true);
    expect(ids.has('svc-s3')).toBe(false);
  });
});

describe('nested token groups', () => {
  it('evaluates AND within OR', () => {
    const query: PropertyFilterQuery = { operation: 'or', tokens: [], tokenGroups: [
      { operation: 'and', tokens: [
        { propertyKey: 'region:us-gov-west-1', operator: '=', value: 'Available' },
        { propertyKey: 'name', operator: ':', value: 'EC2' },
      ]} as PropertyFilterTokenGroup,
      { operation: 'and', tokens: [
        { propertyKey: 'region:us-gov-east-1', operator: '=', value: 'Available' },
        { propertyKey: 'name', operator: ':', value: 'S3' },
      ]} as PropertyFilterTokenGroup,
    ]};
    const ids = new Set(filterItems(allItems, query).map(r => r.id));
    expect(ids.has('svc-ec2')).toBe(true);
    expect(ids.has('svc-s3')).toBe(true);
    expect(ids.has('svc-lambda')).toBe(false);
  });
});

describe('parent-to-child inheritance', () => {
  it('child not included if ancestor only partially matches', () => {
    const parent = makeItem({ id: 'p1', name: 'Match', regionalAvailability: { 'us-east-1': 'Not Available' } });
    const child = makeItem({ id: 'c1', parentId: 'p1', name: 'Child', regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE });
    const query: PropertyFilterQuery = { operation: 'and', tokens: [], tokenGroups: [
      { propertyKey: 'name', operator: '=', value: 'Match' },
      { propertyKey: 'region:us-east-1', operator: '=', value: 'Available' },
    ]};
    expect(filterItems([parent, child], query)).toHaveLength(0);
  });
});

describe('free-text tokens', () => {
  it('match against name', () => {
    const query: PropertyFilterQuery = { operation: 'and', tokens: [{ operator: ':', value: 'EC2' }] };
    const ids = new Set(filterItems(allItems, query).map(r => r.id));
    expect(ids.has('svc-ec2')).toBe(true);
    expect(ids.has('svc-s3')).toBe(false);
  });
});

describe('empty token groups', () => {
  it('empty AND matches all', () => {
    expect(filterItems(allItems, { operation: 'and', tokens: [], tokenGroups: [] })).toHaveLength(allItems.length);
  });
  it('empty OR matches none', () => {
    expect(filterItems(allItems, { operation: 'or', tokens: [], tokenGroups: [] })).toHaveLength(0);
  });
});

// Property-based test
const AVAIL = ['Available', 'Not Available'] as const;
const leafArb: fc.Arbitrary<PropertyFilterToken> = fc.record({
  propertyKey: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1').map(r => `region:${r}`),
  operator: fc.constant('=' as const),
  value: fc.constantFrom(...AVAIL),
});
function groupArb(d: number): fc.Arbitrary<PropertyFilterTokenGroup> {
  if (d <= 1) return fc.record({ operation: fc.constantFrom('and' as const, 'or' as const), tokens: fc.array(leafArb, { minLength: 0, maxLength: 4 }) });
  return fc.record({ operation: fc.constantFrom('and' as const, 'or' as const), tokens: fc.array(fc.oneof({ weight: 3, arbitrary: leafArb }, { weight: 1, arbitrary: groupArb(d - 1) }), { minLength: 0, maxLength: 4 }) });
}
function refEval(item: RegionalAvailability, t: PropertyFilterToken | PropertyFilterTokenGroup): boolean {
  if ('operation' in t) { const g = t as PropertyFilterTokenGroup; return g.operation === 'and' ? g.tokens.every(c => refEval(item, c)) : g.tokens.length > 0 && g.tokens.some(c => refEval(item, c)); }
  return (item.regionalAvailability?.[(t as PropertyFilterToken).propertyKey!.slice(7)] ?? '') === (t as PropertyFilterToken).value;
}

describe('PBT: recursive boolean evaluation', () => {
  it('matches reference evaluator', () => {
    const itemA = fc.record({ id: fc.constant('t'), parentId: fc.constant(null), name: fc.constant('X'), regionalAvailabilityType: fc.constant(RegionalAvailabilityType.SERVICE), regionalAvailability: fc.record({ 'us-east-1': fc.constantFrom(...AVAIL), 'us-west-2': fc.constantFrom(...AVAIL), 'eu-west-1': fc.constantFrom(...AVAIL) }) });
    fc.assert(fc.property(groupArb(3), itemA, (group, item) => {
      const filterFn = createFilteringFunction([item]);
      expect(filterFn(item, { operation: group.operation, tokens: [], tokenGroups: group.tokens })).toBe(refEval(item, group));
    }), { numRuns: 200 });
  });
});
