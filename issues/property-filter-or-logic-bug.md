# Bug: PropertyFilter OR logic ignored — all tokens evaluated as AND

## Description

The PropertyFilter's boolean OR operation does not work correctly. When using `enableTokenGroups` with OR conditions (e.g., `us-gov-west-1 = Available OR us-gov-east-1 = Available`), results include rows where **neither** condition is true. The filter behaves as if all tokens are AND'd together, with parent rows leaking in via the ancestor inheritance logic.

## Steps to Reproduce

1. Open the Capability Insights dashboard
2. Navigate to any tab (Services and features, API operations, or CloudFormation resources)
3. In the PropertyFilter, add: `us-gov-west-1 = Available`
4. Change the operation to **OR**
5. Add a second token: `us-gov-east-1 = Available`
6. Observe the results

## Expected Behavior

Every row in the result should have `us-gov-west-1 = Available` **or** `us-gov-east-1 = Available` (or both). Parent rows should only appear if at least one of their children matches the OR condition.

## Actual Behavior

Results include rows where both `us-gov-west-1` and `us-gov-east-1` are "Not Available". Parent service rows appear even when none of their children satisfy either condition.

## Root Cause

The custom `createFilteringFunction` in `source/website/app/components/availability/availability-table-properties.tsx` does not handle the `tokenGroups` structure used by Cloudscape's `enableTokenGroups` feature.

**The problem** (line ~107):

```typescript
const tokens = query.tokenGroups ?? query.tokens;
```

This retrieves `tokenGroups`, which is a `readonly (PropertyFilterToken | PropertyFilterTokenGroup)[]` — a nested structure where each `PropertyFilterTokenGroup` has an `operation` ("and" | "or") and its own `tokens` array. The code then passes this to `matchesTokens`, which iterates the array and AND's every element:

```typescript
const matchesTokens = (item, tokens) => {
  for (const token of tokens) {
    if (!token.propertyKey) continue; // skips PropertyFilterTokenGroup objects entirely
    // ...
    if (!tokenMatches(value, token)) return false; // AND logic
  }
  return true;
};
```

Two issues:

1. `PropertyFilterTokenGroup` objects (which carry the OR operation) are **silently skipped** because they don't have a `propertyKey` property
2. All flat `PropertyFilterToken` objects are AND'd together regardless of the query's `operation` field

**For comparison**, the Cloudscape default filtering function (`node_modules/@cloudscape-design/collection-hooks/mjs/operations/property-filter.js`) handles this correctly with a recursive `evaluate` function that respects the `operation` field at each nesting level.

**Secondary issue**: The `hasMatchedAncestor` logic includes parent rows whenever any descendant matched in a previous iteration. Combined with the broken OR logic, this causes parent rows to appear even when they shouldn't, because the `matchedIds` set accumulates across the entire item list without respecting the query semantics.

## Affected Component

`source/website/app/components/availability/availability-table-properties.tsx` — `createFilteringFunction()`

## Impact

- OR filter operations are completely broken across all three tabs
- AND operations work correctly for flat tokens but may produce incorrect parent-row inclusion
- Affects any user trying to compare availability across regions using OR conditions
