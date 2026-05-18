import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serializeClassicApiMapping, deserializeClassicApiMapping } from './classic-api-mapping-writer';
import type { ClassicApiMappingData } from '../../shared/types/terraform-classic-api-mapping';

// --- Generators ---

/**
 * Generator for ISO 8601 timestamp strings.
 * Produces realistic timestamps like "2025-01-15T10:30:00.000Z".
 * Uses integer timestamps to avoid invalid date edge cases.
 */
const isoTimestampArb = fc
  .integer({ min: new Date('2020-01-01T00:00:00Z').getTime(), max: new Date('2030-12-31T23:59:59Z').getTime() })
  .map((ms) => new Date(ms).toISOString());

/**
 * Generator for hex commit SHA strings (40 characters).
 */
const commitShaArb = fc.stringMatching(/^[0-9a-f]{40}$/);

/**
 * Generator for valid Terraform resource type names.
 * Format: `aws_` prefix followed by lowercase segments separated by underscores.
 */
const terraformTypeArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,8}$/),
    fc.stringMatching(/^[a-z]{2,10}$/),
  )
  .map(([service, resource]) => `aws_${service}_${resource}`);

/**
 * Generator for SDK service names (PascalCase, e.g., "S3", "EC2", "Lambda").
 */
const sdkServiceArb = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{1,15}$/);

/**
 * Generator for API operation names (PascalCase, e.g., "CreateBucket", "PutObject").
 */
const apiOperationArb = fc
  .tuple(
    fc.constantFrom('Create', 'Delete', 'Put', 'Get', 'List', 'Describe', 'Update', 'Run', 'Start', 'Stop'),
    fc.stringMatching(/^[A-Z][a-zA-Z]{2,12}$/),
  )
  .map(([verb, noun]) => `${verb}${noun}`);

/**
 * Generator for a single ClassicApiResourceMapping entry.
 */
const resourceMappingArb = fc
  .tuple(
    terraformTypeArb,
    sdkServiceArb,
    fc.array(apiOperationArb, { minLength: 0, maxLength: 10 }),
  )
  .map(([terraformType, sdkService, requiredApis]) => ({
    terraformType,
    sdkService,
    requiredApis: [...new Set(requiredApis)], // Deduplicate
    registryPath: terraformType.replace(/^aws_/, ''),
  }));

/**
 * Generator for a complete ClassicApiMappingData object with varying resources.
 */
const classicApiMappingDataArb: fc.Arbitrary<ClassicApiMappingData> = fc
  .tuple(
    isoTimestampArb,
    commitShaArb,
    fc.array(resourceMappingArb, { minLength: 0, maxLength: 30 }),
  )
  .map(([generatedAt, providerCommitSha, resources]) => {
    const uniqueServices = new Set(resources.map((r) => r.sdkService));
    return {
      metadata: {
        generatedAt,
        providerCommitSha,
        resourceCount: resources.length,
        serviceCount: uniqueServices.size,
      },
      resources,
    };
  });

// --- Property Tests ---

/**
 * Feature: terraform-classic-api-availability, Property 6: Serialization Round-Trip
 *
 * For any valid ClassicApiMappingData object, serializing it to JSON and parsing it back
 * SHALL produce a data structure deeply equal to the original, with all metadata fields
 * (generatedAt, providerCommitSha, resourceCount, serviceCount) preserved and all resource
 * entries retaining their terraformType, sdkService, requiredApis, and registryPath fields.
 *
 * **Validates: Requirements 8.1, 8.2, 8.4**
 */
describe('Feature: terraform-classic-api-availability, Property 6: Serialization Round-Trip', () => {
  it('serialize → deserialize produces deeply equal data', () => {
    fc.assert(
      fc.property(classicApiMappingDataArb, (original: ClassicApiMappingData) => {
        // Serialize to JSON
        const json = serializeClassicApiMapping(original);

        // Deserialize back
        const restored = deserializeClassicApiMapping(json);

        // Verify deep equality
        expect(restored).toEqual(original);
      }),
      { numRuns: 100 },
    );
  });

  it('metadata fields are preserved through round-trip', () => {
    fc.assert(
      fc.property(classicApiMappingDataArb, (original: ClassicApiMappingData) => {
        const json = serializeClassicApiMapping(original);
        const restored = deserializeClassicApiMapping(json);

        // Verify each metadata field individually
        expect(restored.metadata.generatedAt).toBe(original.metadata.generatedAt);
        expect(restored.metadata.providerCommitSha).toBe(original.metadata.providerCommitSha);
        expect(restored.metadata.resourceCount).toBe(original.metadata.resourceCount);
        expect(restored.metadata.serviceCount).toBe(original.metadata.serviceCount);
      }),
      { numRuns: 100 },
    );
  });

  it('resource entries retain all fields through round-trip', () => {
    fc.assert(
      fc.property(classicApiMappingDataArb, (original: ClassicApiMappingData) => {
        const json = serializeClassicApiMapping(original);
        const restored = deserializeClassicApiMapping(json);

        // Verify resource count matches
        expect(restored.resources.length).toBe(original.resources.length);

        // Verify each resource entry field-by-field
        for (let i = 0; i < original.resources.length; i++) {
          expect(restored.resources[i].terraformType).toBe(original.resources[i].terraformType);
          expect(restored.resources[i].sdkService).toBe(original.resources[i].sdkService);
          expect(restored.resources[i].requiredApis).toEqual(original.resources[i].requiredApis);
          expect(restored.resources[i].registryPath).toBe(original.resources[i].registryPath);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('serialized output is valid JSON parseable without transformation', () => {
    fc.assert(
      fc.property(classicApiMappingDataArb, (original: ClassicApiMappingData) => {
        const json = serializeClassicApiMapping(original);

        // Verify it's valid JSON
        expect(() => JSON.parse(json)).not.toThrow();

        // Verify the parsed JSON has the expected top-level structure
        const parsed = JSON.parse(json);
        expect(parsed).toHaveProperty('metadata');
        expect(parsed).toHaveProperty('resources');
        expect(Array.isArray(parsed.resources)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
