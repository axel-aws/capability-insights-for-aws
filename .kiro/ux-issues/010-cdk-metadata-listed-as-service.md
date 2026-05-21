# AWS::CDK::Metadata incorrectly listed as a "CDK" service

**Severity:** Low
**Category:** Bug
**Page:** /infrastructure-planning/:planId (Services tab)
**Component:** source/lambda/routes/plan-routes.ts (or the resource extraction logic)

## Problem

When a CDK-synthesized CloudFormation template is uploaded (like the Redshift Serverless template), the resource extraction logic includes `AWS::CDK::Metadata` as a resource type and derives "CDK" as a service name in the Services tab.

`AWS::CDK::Metadata` is a build-tool artifact automatically inserted by CDK during synthesis. It is NOT a real AWS service and has no regional availability implications. Including it:
- Dilutes the accuracy of the extracted service list
- Could confuse users who think they have a dependency on a "CDK" service
- Makes the service count (8 instead of 7) slightly misleading

Current Services tab shows: CDK, EC2, Glue, IAM, KMS, RedshiftServerless, SSM, SecretsManager
Expected: EC2, Glue, IAM, KMS, RedshiftServerless, SSM, SecretsManager (7 services)

## Screenshot

See artifacts/infrastructure_plan_detail.png

## Fix Instructions

1. In the resource extraction logic (likely in `source/lambda/routes/plan-routes.ts` or a shared utility that parses CloudFormation templates), add a filter to exclude known metadata/tooling resource types:

   ```typescript
   const EXCLUDED_RESOURCE_TYPES = [
     'AWS::CDK::Metadata',
     'AWS::CloudFormation::WaitCondition',
     'AWS::CloudFormation::WaitConditionHandle',
   ];
   
   const filteredResources = extractedResources.filter(
     r => !EXCLUDED_RESOURCE_TYPES.includes(r.resourceTypeName)
   );
   ```

2. Apply this filter before computing the "Services" grouping so "CDK" doesn't appear as a service

3. Optionally, keep `AWS::CDK::Metadata` visible in the Resource Types tab but annotated with a "(metadata)" or "(tooling)" suffix and a lighter visual treatment, so users can see it was detected but understand it's not a real dependency

**Acceptance Criteria:**
- [ ] "CDK" does not appear in the Services tab for CDK-synthesized templates
- [ ] AWS::CDK::Metadata is either filtered from Resource Types or annotated as metadata
- [ ] The resource count accurately reflects real AWS service dependencies
- [ ] Other legitimate CDK-created resources (e.g., AWS::Lambda::Function) are NOT filtered out
