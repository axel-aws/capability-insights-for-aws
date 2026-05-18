import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseServicePackageGen } from './classic-service-package-parser';

// --- Generators ---

/**
 * Generator for valid Terraform resource type names.
 * Format: `aws_` prefix followed by lowercase service and resource segments separated by underscores.
 * e.g., "aws_s3_bucket", "aws_ec2_instance"
 */
const terraformTypeNameArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,8}$/),
    fc.stringMatching(/^[a-z]{2,10}$/),
  )
  .map(([service, resource]) => `aws_${service}_${resource}`);

/**
 * Generator for valid Go factory function names.
 * Format: camelCase identifier starting with "resource" prefix followed by PascalCase name.
 * e.g., "resourceBucket", "resourceInstance", "resourceVpcEndpoint"
 */
const factoryNameArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]$/),
    fc.stringMatching(/^[a-zA-Z]{2,15}$/),
  )
  .map(([first, rest]) => `resource${first}${rest}`);

/**
 * Generator for a single resource entry in service_package_gen.go format.
 * Produces a block like:
 *   {
 *     Factory:  resourceBucket,
 *     TypeName: "aws_s3_bucket",
 *     Name:     "Bucket",
 *   },
 */
const resourceEntryArb = fc
  .tuple(terraformTypeNameArb, factoryNameArb, fc.stringMatching(/^[A-Z][a-zA-Z]{1,12}$/))
  .map(([typeName, factoryName, displayName]) => ({
    typeName,
    factoryName,
    block: `\t\t{\n\t\t\tFactory:  ${factoryName},\n\t\t\tTypeName: "${typeName}",\n\t\t\tName:     "${displayName}",\n\t\t},`,
  }));

/**
 * Generator for a complete service_package_gen.go file with N resource entries (1-50).
 * Ensures unique TypeNames and factory names to avoid deduplication affecting count.
 */
const servicePackageGenFileArb = fc
  .array(resourceEntryArb, { minLength: 1, maxLength: 50 })
  .map((entries) => {
    // Deduplicate by typeName and factoryName to ensure uniqueness
    const seenTypeNames = new Set<string>();
    const seenFactoryNames = new Set<string>();
    const uniqueEntries = entries.filter((entry) => {
      if (seenTypeNames.has(entry.typeName) || seenFactoryNames.has(entry.factoryName)) {
        return false;
      }
      seenTypeNames.add(entry.typeName);
      seenFactoryNames.add(entry.factoryName);
      return true;
    });

    // Build the Go source file content
    const header = `package s3

import (
\t"context"
)

`;
    const resourcesSection = `func (p *servicePackage) SDKResources(_ context.Context) []*types.ServicePackageSDKResource {
\treturn []*types.ServicePackageSDKResource{
${uniqueEntries.map((e) => e.block).join('\n')}
\t}
}`;

    return {
      content: header + resourcesSection,
      entries: uniqueEntries,
    };
  })
  .filter((file) => file.entries.length >= 1);

// --- Property Tests ---

/**
 * Feature: terraform-classic-api-availability, Property 1 (partial): Parser Completeness
 *
 * For any valid `service_package_gen.go` file containing N distinct resource entries
 * (each with a unique TypeName and factory function name), the parser SHALL produce
 * exactly N resource entries, each with the correct typeName and factoryName.
 *
 * **Validates: Requirements 7.1**
 */
describe('Feature: terraform-classic-api-availability, Property 1 (partial): Parser Completeness', () => {
  it('N resource entries → N parsed results with correct typeName and factoryName', () => {
    fc.assert(
      fc.property(servicePackageGenFileArb, ({ content, entries }) => {
        // Parse the generated Go source file
        const results = parseServicePackageGen(content);

        // Verify: N entries produce exactly N results
        expect(results.length).toBe(entries.length);

        // Verify each generated typeName appears in the results
        const resultTypeNames = new Set(results.map((r) => r.typeName));
        for (const entry of entries) {
          expect(resultTypeNames.has(entry.typeName)).toBe(true);
        }

        // Verify each generated factoryName appears in the results
        const resultFactoryNames = new Set(results.map((r) => r.factoryName));
        for (const entry of entries) {
          expect(resultFactoryNames.has(entry.factoryName)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
