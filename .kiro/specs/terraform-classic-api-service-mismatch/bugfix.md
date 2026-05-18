# Bugfix Requirements Document

## Introduction

The Terraform AWS tab on the API Operations page incorrectly shows "Not Available" for operations that are actually available in the API Operations tab. This is caused by a service name mismatch between the operation availability index and the Terraform mapping data. Two issues contribute: (1) the index builder uses `parent.name` (the full display name like "AWS Organizations") instead of `parent.sdkServiceName` (the SDK name like "Organizations"), and (2) the Terraform mapping uses lowercase directory names (e.g., "organizations") while the API data uses PascalCase SDK names (e.g., "Organizations"). The result is that many services fail to match, causing their operations to appear unavailable on the Terraform AWS tab.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an operation row does not have `sdkServiceName` set directly and the index builder falls back to the parent row THEN the system uses `parent.name` (which is `sdkServiceFullName`, e.g., "AWS Organizations") as the index key instead of the SDK service name (e.g., "Organizations")

1.2 WHEN the Terraform mapping contains a service name derived from the provider directory structure (e.g., "organizations" lowercase) and the operation availability index contains the PascalCase SDK name (e.g., "Organizations") THEN the system fails to find a match due to case-sensitive comparison, resulting in "Not Available" status

1.3 WHEN a user views the Terraform AWS tab for a service like AWS Organizations THEN the system shows "Not Available" for operations like `DeleteResourcePolicy` even though the API Operations tab shows them as "Available" in all regions

### Expected Behavior (Correct)

2.1 WHEN an operation row does not have `sdkServiceName` set directly and the index builder falls back to the parent row THEN the system SHALL use `parent.sdkServiceName` (e.g., "Organizations") as the index key

2.2 WHEN the Terraform mapping contains a service name in any case (e.g., "organizations", "dynamodb", "cloudwatch") and the operation availability index contains the corresponding SDK name in a different case (e.g., "Organizations", "DynamoDB", "CloudWatch") THEN the system SHALL perform a case-insensitive lookup and correctly match the service

2.3 WHEN a user views the Terraform AWS tab for any service THEN the system SHALL show the same availability status as the API Operations tab for operations that exist in both views

### Unchanged Behavior (Regression Prevention)

3.1 WHEN an operation row has `sdkServiceName` set directly (e.g., "S3", "EC2") THEN the system SHALL CONTINUE TO use that value as the index key without any parent lookup

3.2 WHEN the Terraform mapping service name exactly matches the API data service name in both value and case (e.g., "S3" matches "S3", "EC2" matches "EC2") THEN the system SHALL CONTINUE TO resolve availability correctly

3.3 WHEN a Terraform resource has all required API operations available in a region THEN the system SHALL CONTINUE TO show "Available" for that resource in that region

3.4 WHEN a Terraform resource has one or more required API operations genuinely unavailable in a region THEN the system SHALL CONTINUE TO show "Not Available" for that resource in that region

3.5 WHEN the operation availability index is queried for services and operations that exist in the index THEN the system SHALL CONTINUE TO return correct region availability sets

---

## Bug Condition

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type ServiceLookup (sdkService name from Terraform mapping, operation availability index)
  OUTPUT: boolean

  // The bug triggers when the service name used for lookup does not exactly match
  // the index key due to either:
  //   (a) parent.name being used instead of parent.sdkServiceName, or
  //   (b) case mismatch between Terraform directory name and SDK service name

  RETURN (X.lookupKey != X.indexKey) AND (lowercase(X.lookupKey) = lowercase(X.indexKey))
END FUNCTION
```

### Property Specification — Fix Checking

```pascal
// Property: Fix Checking — Case-insensitive service name matching
FOR ALL X WHERE isBugCondition(X) DO
  result ← lookupServiceInIndex'(X.lookupKey, X.operationAvailabilityIndex)
  ASSERT result = lookupServiceInIndex'(X.indexKey, X.operationAvailabilityIndex)
  // i.e., "organizations" finds the same data as "Organizations"
END FOR
```

### Property Specification — Parent Fallback Fix Checking

```pascal
// Property: Fix Checking — Parent fallback uses sdkServiceName
FOR ALL X WHERE X.operationRow.sdkServiceName IS NULL AND X.operationRow.parentId IS NOT NULL DO
  parent ← lookupById(X.operationRow.parentId)
  indexKey ← buildOperationAvailabilityIndex'(X.operationRow)
  ASSERT indexKey = parent.sdkServiceName
  // i.e., uses "Organizations" not "AWS Organizations"
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT buildOperationAvailabilityIndex(X) = buildOperationAvailabilityIndex'(X)
  ASSERT computeResourceAvailability(X) = computeResourceAvailability'(X)
END FOR
```

This ensures that for all inputs where the service name already matches exactly (same case, same value), the fixed code behaves identically to the original.
