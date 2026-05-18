import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { PlanProcessor } from './plan-processor';

// --- Generators ---

/**
 * Generates a valid AWS service name segment (PascalCase, 2-15 chars).
 * Examples: S3, Lambda, DynamoDB, EC2, CloudFront
 */
const serviceNameArb = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{1,14}$/);

/**
 * Generates a valid AWS resource type segment (PascalCase, 2-15 chars).
 * Examples: Bucket, Function, Table, Instance
 */
const resourceTypeArb = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{1,14}$/);

/**
 * Generates a valid CloudFormation resource type in `AWS::{Service}::{Resource}` format.
 */
const cfnResourceTypeArb = fc
  .tuple(serviceNameArb, resourceTypeArb)
  .map(([service, resource]) => `AWS::${service}::${resource}`);

// --- Helpers ---

/**
 * Creates a PlanProcessor with minimal mock dependencies.
 * Only the CloudFormation path is exercised, so overlay/PAT functions are stubs.
 */
function createProcessor(): PlanProcessor {
  return new PlanProcessor({
    getOverlayData: async () => ({
      metadata: {
        generatedAt: '2025-01-01T00:00:00Z',
        awsccProviderCommitSha: 'abc',
        classicAwsProviderCommitSha: 'def',
        awsccResourceCount: 0,
        classicAwsResourceCount: 0,
      },
      awscc: [],
      classicAws: [],
    }),
    getGitHubPat: async () => 'mock-pat',
  });
}

/**
 * Builds a minimal CloudFormation JSON template from a list of resource types
 * and returns it as a base64-encoded string.
 */
function buildCfnTemplateBase64(resourceTypes: string[]): string {
  const resources: Record<string, { Type: string; Properties: Record<string, never> }> = {};
  resourceTypes.forEach((type, index) => {
    resources[`Resource${index}`] = { Type: type, Properties: {} };
  });

  const template = {
    AWSTemplateFormatVersion: '2010-09-09',
    Resources: resources,
  };

  return Buffer.from(JSON.stringify(template)).toString('base64');
}

/**
 * Extracts the expected service name from a CFN resource type.
 * Given `AWS::ServiceName::ResourceType`, returns `ServiceName`.
 */
function expectedServiceName(cfnType: string): string {
  return cfnType.split('::')[1];
}

// --- Property 16 Tests ---

/**
 * Property 16: Service name derivation from resource types
 *
 * For any CloudFormation resource type in the format `AWS::{ServiceName}::{ResourceType}`,
 * the service name derivation function SHALL extract the service name segment and map it
 * to the corresponding display name used in the Services tab.
 *
 * **Validates: Requirements 6.9**
 */
describe('Feature: infrastructure-planning, Property 16: Service name derivation from resource types', () => {
  const processor = createProcessor();

  it('derives the correct service name segment from each CFN resource type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(cfnResourceTypeArb, { minLength: 1, maxLength: 20 }),
        async (resourceTypes) => {
          const templateContent = buildCfnTemplateBase64(resourceTypes);

          const result = await processor.process({
            planName: 'test-plan',
            sourceType: 'cloudformation',
            templateContent,
          });

          // Extract expected unique service names from the generated resource types
          const expectedNames = [...new Set(resourceTypes.map(expectedServiceName))].sort();

          // The processor should derive exactly these service names
          expect(result.serviceNames).toEqual(expectedNames);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('produces unique service names even when multiple resource types share the same service', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          serviceNameArb,
          fc.uniqueArray(resourceTypeArb, { minLength: 2, maxLength: 10 })
        ),
        async ([service, resources]) => {
          // Create multiple resource types all under the same service
          const resourceTypes = resources.map((r) => `AWS::${service}::${r}`);
          const templateContent = buildCfnTemplateBase64(resourceTypes);

          const result = await processor.process({
            planName: 'test-plan',
            sourceType: 'cloudformation',
            templateContent,
          });

          // Should derive exactly one service name for all resources under the same service
          expect(result.serviceNames).toEqual([service]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('derives service names from multiple distinct services correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.tuple(serviceNameArb, resourceTypeArb),
          { minLength: 2, maxLength: 15, selector: ([s]) => s }
        ),
        async (pairs) => {
          // Each pair has a unique service name
          const resourceTypes = pairs.map(([s, r]) => `AWS::${s}::${r}`);
          const templateContent = buildCfnTemplateBase64(resourceTypes);

          const result = await processor.process({
            planName: 'test-plan',
            sourceType: 'cloudformation',
            templateContent,
          });

          // Should have exactly one service name per unique service
          const expectedNames = pairs.map(([s]) => s).sort();
          expect(result.serviceNames).toEqual(expectedNames);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns sorted service names', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(cfnResourceTypeArb, { minLength: 1, maxLength: 20 }),
        async (resourceTypes) => {
          const templateContent = buildCfnTemplateBase64(resourceTypes);

          const result = await processor.process({
            planName: 'test-plan',
            sourceType: 'cloudformation',
            templateContent,
          });

          // Service names should be sorted
          const sorted = [...result.serviceNames].sort();
          expect(result.serviceNames).toEqual(sorted);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('service names set is a subset of the service segments in cfnResourceTypes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(cfnResourceTypeArb, { minLength: 1, maxLength: 20 }),
        async (resourceTypes) => {
          const templateContent = buildCfnTemplateBase64(resourceTypes);

          const result = await processor.process({
            planName: 'test-plan',
            sourceType: 'cloudformation',
            templateContent,
          });

          // Every service name should correspond to at least one resource type
          for (const serviceName of result.serviceNames) {
            const hasMatchingResource = result.cfnResourceTypes.some(
              (rt) => rt.split('::')[1] === serviceName
            );
            expect(hasMatchingResource).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
