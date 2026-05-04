import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { filterByStackResources } from './stack-filter';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import type { CfnAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import type { ResourceTypePair } from '@capability-insights/shared/types/capability/stack';

/**
 * Feature: stack-resource-filter, Property 6: Hierarchical row filtering preserves structure
 * Validates: Requirements 4.1, 4.2
 */
describe('Feature: stack-resource-filter, Property 6: Hierarchical row filtering preserves structure', () => {
  // Arbitrary for non-empty alphanumeric strings used as names
  const nameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]*$/, { minLength: 1, maxLength: 20 });

  /**
   * Generator for a valid CfnAvailability hierarchy:
   * - Service rows: parentId = null, type = SERVICE
   * - Resource type rows: parentId = service id, type = RESOURCE_TYPE
   * - Property rows: parentId = resource type id, type = PROPERTY
   * - Configuration rows: parentId = property id, type = CONFIGURATION
   *
   * Returns { rows, services } where services maps service id → { serviceName, resourceTypes[] }
   */
  interface GeneratedHierarchy {
    rows: CfnAvailability[];
    serviceMap: Map<string, { serviceName: string; resourceTypeNames: string[] }>;
  }

  const hierarchyArb: fc.Arbitrary<GeneratedHierarchy> = fc
    .array(
      fc.record({
        serviceName: nameArb,
        resourceTypes: fc.array(
          fc.record({
            resourceTypeName: nameArb,
            properties: fc.array(
              fc.record({
                propertyName: nameArb,
                configurations: fc.array(nameArb, { minLength: 0, maxLength: 3 }),
              }),
              { minLength: 0, maxLength: 3 },
            ),
          }),
          { minLength: 1, maxLength: 5 },
        ),
      }),
      { minLength: 1, maxLength: 5 },
    )
    .map((services) => {
      const rows: CfnAvailability[] = [];
      const serviceMap = new Map<string, { serviceName: string; resourceTypeNames: string[] }>();
      let idCounter = 1;

      for (const service of services) {
        const serviceId = `svc-${idCounter++}`;
        const resourceTypeNames: string[] = [];

        // Service row
        rows.push({
          id: serviceId,
          parentId: null,
          name: service.serviceName,
          regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
        });

        for (const rt of service.resourceTypes) {
          const rtId = `rt-${idCounter++}`;
          resourceTypeNames.push(rt.resourceTypeName);

          // Resource type row
          rows.push({
            id: rtId,
            parentId: serviceId,
            name: rt.resourceTypeName,
            regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
          });

          for (const prop of rt.properties) {
            const propId = `prop-${idCounter++}`;

            // Property row
            rows.push({
              id: propId,
              parentId: rtId,
              name: prop.propertyName,
              regionalAvailabilityType: RegionalAvailabilityType.PROPERTY,
            });

            for (const config of prop.configurations) {
              const configId = `cfg-${idCounter++}`;

              // Configuration row
              rows.push({
                id: configId,
                parentId: propId,
                name: config,
                regionalAvailabilityType: RegionalAvailabilityType.CONFIGURATION,
              });
            }
          }
        }

        serviceMap.set(serviceId, {
          serviceName: service.serviceName,
          resourceTypeNames,
        });
      }

      return { rows, serviceMap };
    });

  /**
   * Given a generated hierarchy, produce a ResourceTypePair filter set that includes
   * some matching pairs from the hierarchy and optionally some non-matching pairs.
   */
  const filterArb = (hierarchy: GeneratedHierarchy): fc.Arbitrary<ResourceTypePair[]> => {
    // Collect all valid pairs from the hierarchy
    const allPairs: ResourceTypePair[] = [];
    for (const [, info] of hierarchy.serviceMap) {
      for (const rtName of info.resourceTypeNames) {
        allPairs.push({ serviceName: info.serviceName, resourceTypeName: rtName });
      }
    }

    // Generate a subset of the valid pairs (some matching)
    const subsetArb = fc.subarray(allPairs, { minLength: 0 });

    // Generate some non-matching pairs
    const nonMatchingArb = fc.array(
      fc.record({
        serviceName: nameArb,
        resourceTypeName: nameArb,
      }),
      { minLength: 0, maxLength: 3 },
    );

    return fc.tuple(subsetArb, nonMatchingArb).map(([subset, nonMatching]) => {
      // Filter out non-matching pairs that accidentally match a real pair
      const existingKeys = new Set(allPairs.map((p) => `${p.serviceName}::${p.resourceTypeName}`));
      const trulyNonMatching = nonMatching.filter(
        (p) => !existingKeys.has(`${p.serviceName}::${p.resourceTypeName}`),
      );
      return [...subset, ...trulyNonMatching];
    });
  };

  it('every matching resource type row is included in the filtered result', () => {
    fc.assert(
      fc.property(
        hierarchyArb.chain((hierarchy) =>
          filterArb(hierarchy).map((filters) => ({ hierarchy, filters })),
        ),
        ({ hierarchy, filters }) => {
          const result = filterByStackResources({
            rows: hierarchy.rows,
            resourceTypePairs: filters,
            propertyMatches: [],
          });

          const filterSet = new Set(
            filters.map((f) => `${f.serviceName}::${f.resourceTypeName}`),
          );

          // Build a lookup of row id → row for parent resolution
          const rowById = new Map(hierarchy.rows.map((r) => [r.id, r]));

          // Every resource type row in the hierarchy that matches a filter pair must be in the result
          for (const row of hierarchy.rows) {
            if (row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE && row.parentId) {
              const parentRow = rowById.get(row.parentId);
              if (parentRow) {
                const key = `${parentRow.name}::${row.name}`;
                if (filterSet.has(key)) {
                  const resultIds = new Set(result.map((r) => r.id));
                  expect(resultIds.has(row.id)).toBe(true);
                }
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('parent service rows are included for every included resource type row', () => {
    fc.assert(
      fc.property(
        hierarchyArb.chain((hierarchy) =>
          filterArb(hierarchy).map((filters) => ({ hierarchy, filters })),
        ),
        ({ hierarchy, filters }) => {
          const result = filterByStackResources({
            rows: hierarchy.rows,
            resourceTypePairs: filters,
            propertyMatches: [],
          });

          const resultIds = new Set(result.map((r) => r.id));

          // For every resource type row in the result, its parent service row must also be in the result
          for (const row of result) {
            if (
              row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE &&
              row.parentId
            ) {
              expect(resultIds.has(row.parentId)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no non-matching resource type rows are included', () => {
    fc.assert(
      fc.property(
        hierarchyArb.chain((hierarchy) =>
          filterArb(hierarchy).map((filters) => ({ hierarchy, filters })),
        ),
        ({ hierarchy, filters }) => {
          const result = filterByStackResources({
            rows: hierarchy.rows,
            resourceTypePairs: filters,
            propertyMatches: [],
          });

          const filterSet = new Set(
            filters.map((f) => `${f.serviceName}::${f.resourceTypeName}`),
          );

          // Build a lookup of row id → row for parent resolution
          const rowById = new Map(hierarchy.rows.map((r) => [r.id, r]));

          // No resource type row in the result should be non-matching
          for (const row of result) {
            if (row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE && row.parentId) {
              const parentRow = rowById.get(row.parentId);
              if (parentRow) {
                const key = `${parentRow.name}::${row.name}`;
                expect(filterSet.has(key)).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no orphan service rows (whose children are all excluded) are included', () => {
    fc.assert(
      fc.property(
        hierarchyArb.chain((hierarchy) =>
          filterArb(hierarchy).map((filters) => ({ hierarchy, filters })),
        ),
        ({ hierarchy, filters }) => {
          const result = filterByStackResources({
            rows: hierarchy.rows,
            resourceTypePairs: filters,
            propertyMatches: [],
          });

          const resultIds = new Set(result.map((r) => r.id));

          // For every service row in the result, at least one of its child resource type rows
          // must also be in the result
          for (const row of result) {
            if (row.regionalAvailabilityType === RegionalAvailabilityType.SERVICE) {
              const childResourceTypes = hierarchy.rows.filter(
                (r) =>
                  r.parentId === row.id &&
                  r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE,
              );
              const hasIncludedChild = childResourceTypes.some((child) => resultIds.has(child.id));
              expect(hasIncludedChild).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

import type { PropertyMatch } from '@capability-insights/shared/types/capability/stack';

/**
 * Feature: stack-resource-filter, Property 7: Configuration row filtering with property values
 * Validates: Requirements 4.3, 4.4
 */
describe('Feature: stack-resource-filter, Property 7: Configuration row filtering with property values', () => {
  // Arbitrary for non-empty alphanumeric strings used as names
  const nameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]*$/, { minLength: 1, maxLength: 20 });

  /**
   * Detailed hierarchy info tracked per resource type for verification.
   */
  interface ResourceTypeInfo {
    rtId: string;
    serviceName: string;
    resourceTypeName: string;
    properties: Array<{
      propId: string;
      propertyName: string;
      configurations: Array<{ configId: string; configName: string }>;
    }>;
  }

  interface GeneratedHierarchy {
    rows: CfnAvailability[];
    resourceTypes: ResourceTypeInfo[];
  }

  /**
   * Generator for CfnAvailability hierarchies where every resource type has
   * at least one property with at least one configuration child.
   * This ensures we always have configuration rows to verify filtering on.
   */
  const hierarchyArb: fc.Arbitrary<GeneratedHierarchy> = fc
    .array(
      fc.record({
        serviceName: nameArb,
        resourceTypes: fc.array(
          fc.record({
            resourceTypeName: nameArb,
            properties: fc.array(
              fc.record({
                propertyName: nameArb,
                configurations: fc.array(nameArb, { minLength: 1, maxLength: 4 }),
              }),
              { minLength: 1, maxLength: 3 },
            ),
          }),
          { minLength: 1, maxLength: 4 },
        ),
      }),
      { minLength: 1, maxLength: 4 },
    )
    .map((services) => {
      const rows: CfnAvailability[] = [];
      const resourceTypes: ResourceTypeInfo[] = [];
      let idCounter = 1;

      for (const service of services) {
        const serviceId = `svc-${idCounter++}`;

        rows.push({
          id: serviceId,
          parentId: null,
          name: service.serviceName,
          regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
        });

        for (const rt of service.resourceTypes) {
          const rtId = `rt-${idCounter++}`;
          const rtInfo: ResourceTypeInfo = {
            rtId,
            serviceName: service.serviceName,
            resourceTypeName: rt.resourceTypeName,
            properties: [],
          };

          rows.push({
            id: rtId,
            parentId: serviceId,
            name: rt.resourceTypeName,
            regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
          });

          for (const prop of rt.properties) {
            const propId = `prop-${idCounter++}`;
            const propInfo: ResourceTypeInfo['properties'][number] = {
              propId,
              propertyName: prop.propertyName,
              configurations: [],
            };

            rows.push({
              id: propId,
              parentId: rtId,
              name: prop.propertyName,
              regionalAvailabilityType: RegionalAvailabilityType.PROPERTY,
            });

            for (const config of prop.configurations) {
              const configId = `cfg-${idCounter++}`;
              propInfo.configurations.push({ configId, configName: config });

              rows.push({
                id: configId,
                parentId: propId,
                name: config,
                regionalAvailabilityType: RegionalAvailabilityType.CONFIGURATION,
              });
            }

            rtInfo.properties.push(propInfo);
          }

          resourceTypes.push(rtInfo);
        }
      }

      return { rows, resourceTypes };
    });

  /**
   * Given a hierarchy, generate ResourceTypePairs that include ALL resource types
   * (so the resource type filter itself doesn't exclude anything — we focus on config filtering).
   * Then for a random subset of resource types, generate PropertyMatch values that match
   * some of their configuration names. For the rest, generate no property matches.
   */
  const inputArb = hierarchyArb.chain((hierarchy) => {
    const allPairs: ResourceTypePair[] = hierarchy.resourceTypes.map((rt) => ({
      serviceName: rt.serviceName,
      resourceTypeName: rt.resourceTypeName,
    }));

    // For each resource type, decide whether to generate property matches
    // Use a boolean per resource type to decide
    const matchDecisionsArb = fc.tuple(
      ...hierarchy.resourceTypes.map((rt) =>
        fc.boolean().chain((hasMatches) => {
          if (!hasMatches) {
            return fc.constant({ rt, propertyMatches: [] as PropertyMatch[] });
          }
          // Collect all configuration names across all properties for this resource type
          const allConfigNames: string[] = [];
          for (const prop of rt.properties) {
            for (const cfg of prop.configurations) {
              allConfigNames.push(cfg.configName);
            }
          }
          if (allConfigNames.length === 0) {
            return fc.constant({ rt, propertyMatches: [] as PropertyMatch[] });
          }
          // Pick a non-empty subset of config names as property match values
          return fc
            .subarray(allConfigNames, { minLength: 1 })
            .map((matchedNames) => ({
              rt,
              propertyMatches: matchedNames.map((value) => ({
                serviceName: rt.serviceName,
                resourceTypeName: rt.resourceTypeName,
                propertyName: rt.properties[0].propertyName, // use first property name
                value,
              })),
            }));
        }),
      ),
    );

    return matchDecisionsArb.map((decisions) => {
      const allPropertyMatches: PropertyMatch[] = [];
      const matchedResourceTypes = new Map<string, Set<string>>(); // rtKey → matched config values

      for (const decision of decisions) {
        for (const pm of decision.propertyMatches) {
          allPropertyMatches.push(pm);
        }
        if (decision.propertyMatches.length > 0) {
          const key = `${decision.rt.serviceName}::${decision.rt.resourceTypeName}`;
          const values = new Set(decision.propertyMatches.map((pm) => pm.value));
          matchedResourceTypes.set(key, values);
        }
      }

      return {
        hierarchy,
        resourceTypePairs: allPairs,
        propertyMatches: allPropertyMatches,
        matchedResourceTypes,
      };
    });
  });

  it('when property matches exist for a resource type, only configuration rows whose name matches a property match value are included', () => {
    fc.assert(
      fc.property(inputArb, ({ hierarchy, resourceTypePairs, propertyMatches, matchedResourceTypes }) => {
        const result = filterByStackResources({
          rows: hierarchy.rows,
          resourceTypePairs,
          propertyMatches,
        });

        const resultIds = new Set(result.map((r) => r.id));

        // For each resource type that HAS property matches, check configuration rows
        for (const rtInfo of hierarchy.resourceTypes) {
          const rtKey = `${rtInfo.serviceName}::${rtInfo.resourceTypeName}`;
          const matchedValues = matchedResourceTypes.get(rtKey);

          if (matchedValues && matchedValues.size > 0) {
            // This resource type has property matches — only matching config rows should be included
            for (const prop of rtInfo.properties) {
              for (const cfg of prop.configurations) {
                if (matchedValues.has(cfg.configName)) {
                  // Matching config row SHOULD be included
                  expect(resultIds.has(cfg.configId)).toBe(true);
                } else {
                  // Non-matching config row SHOULD NOT be included
                  expect(resultIds.has(cfg.configId)).toBe(false);
                }
              }
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('when no property matches exist for a resource type, all child rows (properties and configurations) are included', () => {
    fc.assert(
      fc.property(inputArb, ({ hierarchy, resourceTypePairs, propertyMatches, matchedResourceTypes }) => {
        const result = filterByStackResources({
          rows: hierarchy.rows,
          resourceTypePairs,
          propertyMatches,
        });

        const resultIds = new Set(result.map((r) => r.id));

        // For each resource type that has NO property matches, all children should be included
        for (const rtInfo of hierarchy.resourceTypes) {
          const rtKey = `${rtInfo.serviceName}::${rtInfo.resourceTypeName}`;
          const matchedValues = matchedResourceTypes.get(rtKey);

          if (!matchedValues || matchedValues.size === 0) {
            // No property matches — all property and configuration rows should be included
            for (const prop of rtInfo.properties) {
              expect(resultIds.has(prop.propId)).toBe(true);

              for (const cfg of prop.configurations) {
                expect(resultIds.has(cfg.configId)).toBe(true);
              }
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Unit tests for filterByStackResources
 * These complement the property-based tests above by testing specific known inputs and expected outputs.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */
describe('filterByStackResources - unit tests', () => {
  // --- Realistic hierarchy helpers ---
  // EC2 service → Instance resource type → InstanceType property → t3.micro, m5.large configs
  // S3 service → Bucket resource type → (no properties)
  // Lambda service → Function resource type → Runtime property → nodejs20.x, python3.12 configs

  const ec2Service: CfnAvailability = {
    id: 'svc-ec2',
    parentId: null,
    name: 'EC2',
    regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
  };

  const ec2Instance: CfnAvailability = {
    id: 'rt-instance',
    parentId: 'svc-ec2',
    name: 'Instance',
    regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
  };

  const instanceTypeProp: CfnAvailability = {
    id: 'prop-instancetype',
    parentId: 'rt-instance',
    name: 'InstanceType',
    regionalAvailabilityType: RegionalAvailabilityType.PROPERTY,
  };

  const t3MicroConfig: CfnAvailability = {
    id: 'cfg-t3micro',
    parentId: 'prop-instancetype',
    name: 't3.micro',
    regionalAvailabilityType: RegionalAvailabilityType.CONFIGURATION,
  };

  const m5LargeConfig: CfnAvailability = {
    id: 'cfg-m5large',
    parentId: 'prop-instancetype',
    name: 'm5.large',
    regionalAvailabilityType: RegionalAvailabilityType.CONFIGURATION,
  };

  const s3Service: CfnAvailability = {
    id: 'svc-s3',
    parentId: null,
    name: 'S3',
    regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
  };

  const s3Bucket: CfnAvailability = {
    id: 'rt-bucket',
    parentId: 'svc-s3',
    name: 'Bucket',
    regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
  };

  const lambdaService: CfnAvailability = {
    id: 'svc-lambda',
    parentId: null,
    name: 'Lambda',
    regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
  };

  const lambdaFunction: CfnAvailability = {
    id: 'rt-function',
    parentId: 'svc-lambda',
    name: 'Function',
    regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
  };

  const runtimeProp: CfnAvailability = {
    id: 'prop-runtime',
    parentId: 'rt-function',
    name: 'Runtime',
    regionalAvailabilityType: RegionalAvailabilityType.PROPERTY,
  };

  const nodejs20Config: CfnAvailability = {
    id: 'cfg-nodejs20',
    parentId: 'prop-runtime',
    name: 'nodejs20.x',
    regionalAvailabilityType: RegionalAvailabilityType.CONFIGURATION,
  };

  const python312Config: CfnAvailability = {
    id: 'cfg-python312',
    parentId: 'prop-runtime',
    name: 'python3.12',
    regionalAvailabilityType: RegionalAvailabilityType.CONFIGURATION,
  };

  const allRows: CfnAvailability[] = [
    ec2Service,
    ec2Instance,
    instanceTypeProp,
    t3MicroConfig,
    m5LargeConfig,
    s3Service,
    s3Bucket,
    lambdaService,
    lambdaFunction,
    runtimeProp,
    nodejs20Config,
    python312Config,
  ];

  describe('hierarchical filtering (Requirements 4.1, 4.2)', () => {
    it('filters to only matching resource types and their parent services', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [{ serviceName: 'EC2', resourceTypeName: 'Instance' }],
        propertyMatches: [],
      });

      const resultIds = new Set(result.map((r) => r.id));

      // EC2 service and Instance resource type should be included
      expect(resultIds.has('svc-ec2')).toBe(true);
      expect(resultIds.has('rt-instance')).toBe(true);

      // Property and config children should be included (no property matches → fallback to all)
      expect(resultIds.has('prop-instancetype')).toBe(true);
      expect(resultIds.has('cfg-t3micro')).toBe(true);
      expect(resultIds.has('cfg-m5large')).toBe(true);

      // S3 and Lambda should be excluded
      expect(resultIds.has('svc-s3')).toBe(false);
      expect(resultIds.has('rt-bucket')).toBe(false);
      expect(resultIds.has('svc-lambda')).toBe(false);
      expect(resultIds.has('rt-function')).toBe(false);
    });

    it('includes multiple matching resource types across different services', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [
          { serviceName: 'EC2', resourceTypeName: 'Instance' },
          { serviceName: 'S3', resourceTypeName: 'Bucket' },
        ],
        propertyMatches: [],
      });

      const resultIds = new Set(result.map((r) => r.id));

      // Both EC2 and S3 services should be included
      expect(resultIds.has('svc-ec2')).toBe(true);
      expect(resultIds.has('rt-instance')).toBe(true);
      expect(resultIds.has('svc-s3')).toBe(true);
      expect(resultIds.has('rt-bucket')).toBe(true);

      // Lambda should still be excluded
      expect(resultIds.has('svc-lambda')).toBe(false);
      expect(resultIds.has('rt-function')).toBe(false);
    });

    it('excludes unmatched resource types but keeps matched ones under the same service', () => {
      // Add a second resource type under EC2
      const ec2SecurityGroup: CfnAvailability = {
        id: 'rt-sg',
        parentId: 'svc-ec2',
        name: 'SecurityGroup',
        regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
      };

      const rows = [...allRows, ec2SecurityGroup];

      const result = filterByStackResources({
        rows,
        resourceTypePairs: [{ serviceName: 'EC2', resourceTypeName: 'Instance' }],
        propertyMatches: [],
      });

      const resultIds = new Set(result.map((r) => r.id));

      // EC2 service and Instance should be included
      expect(resultIds.has('svc-ec2')).toBe(true);
      expect(resultIds.has('rt-instance')).toBe(true);

      // SecurityGroup should be excluded (not in filter)
      expect(resultIds.has('rt-sg')).toBe(false);
    });
  });

  describe('configuration narrowing with property matches (Requirements 4.3, 4.4)', () => {
    it('narrows configuration rows when property matches are present', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [{ serviceName: 'EC2', resourceTypeName: 'Instance' }],
        propertyMatches: [
          {
            serviceName: 'EC2',
            resourceTypeName: 'Instance',
            propertyName: 'InstanceType',
            value: 't3.micro',
          },
        ],
      });

      const resultIds = new Set(result.map((r) => r.id));

      // EC2 service, Instance, and InstanceType property should be included
      expect(resultIds.has('svc-ec2')).toBe(true);
      expect(resultIds.has('rt-instance')).toBe(true);
      expect(resultIds.has('prop-instancetype')).toBe(true);

      // Only t3.micro config should be included, not m5.large
      expect(resultIds.has('cfg-t3micro')).toBe(true);
      expect(resultIds.has('cfg-m5large')).toBe(false);
    });

    it('includes all children when no property matches exist for a resource type', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [{ serviceName: 'Lambda', resourceTypeName: 'Function' }],
        propertyMatches: [],
      });

      const resultIds = new Set(result.map((r) => r.id));

      // Lambda service, Function, Runtime property, and ALL configs should be included
      expect(resultIds.has('svc-lambda')).toBe(true);
      expect(resultIds.has('rt-function')).toBe(true);
      expect(resultIds.has('prop-runtime')).toBe(true);
      expect(resultIds.has('cfg-nodejs20')).toBe(true);
      expect(resultIds.has('cfg-python312')).toBe(true);
    });

    it('narrows one resource type while showing all children for another', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [
          { serviceName: 'EC2', resourceTypeName: 'Instance' },
          { serviceName: 'Lambda', resourceTypeName: 'Function' },
        ],
        propertyMatches: [
          {
            serviceName: 'EC2',
            resourceTypeName: 'Instance',
            propertyName: 'InstanceType',
            value: 't3.micro',
          },
        ],
      });

      const resultIds = new Set(result.map((r) => r.id));

      // EC2 Instance: narrowed to t3.micro only
      expect(resultIds.has('cfg-t3micro')).toBe(true);
      expect(resultIds.has('cfg-m5large')).toBe(false);

      // Lambda Function: all configs included (no property matches)
      expect(resultIds.has('cfg-nodejs20')).toBe(true);
      expect(resultIds.has('cfg-python312')).toBe(true);
    });

    it('supports multiple property match values for the same resource type', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [{ serviceName: 'EC2', resourceTypeName: 'Instance' }],
        propertyMatches: [
          {
            serviceName: 'EC2',
            resourceTypeName: 'Instance',
            propertyName: 'InstanceType',
            value: 't3.micro',
          },
          {
            serviceName: 'EC2',
            resourceTypeName: 'Instance',
            propertyName: 'InstanceType',
            value: 'm5.large',
          },
        ],
      });

      const resultIds = new Set(result.map((r) => r.id));

      // Both config values should be included
      expect(resultIds.has('cfg-t3micro')).toBe(true);
      expect(resultIds.has('cfg-m5large')).toBe(true);
    });
  });

  describe('empty inputs and edge cases (Requirement 4.5)', () => {
    it('returns empty array when rows are empty', () => {
      const result = filterByStackResources({
        rows: [],
        resourceTypePairs: [{ serviceName: 'EC2', resourceTypeName: 'Instance' }],
        propertyMatches: [],
      });

      expect(result).toEqual([]);
    });

    it('returns empty array when resourceTypePairs are empty', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [],
        propertyMatches: [],
      });

      expect(result).toEqual([]);
    });

    it('returns empty array when both rows and resourceTypePairs are empty', () => {
      const result = filterByStackResources({
        rows: [],
        resourceTypePairs: [],
        propertyMatches: [],
      });

      expect(result).toEqual([]);
    });

    it('returns empty array when no resource types match any rows', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [{ serviceName: 'RDS', resourceTypeName: 'DBInstance' }],
        propertyMatches: [],
      });

      expect(result).toEqual([]);
    });

    it('ignores property matches for resource types not in the filter set', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [{ serviceName: 'EC2', resourceTypeName: 'Instance' }],
        propertyMatches: [
          {
            serviceName: 'Lambda',
            resourceTypeName: 'Function',
            propertyName: 'Runtime',
            value: 'nodejs20.x',
          },
        ],
      });

      const resultIds = new Set(result.map((r) => r.id));

      // EC2 should be included with all children (no property matches for EC2)
      expect(resultIds.has('svc-ec2')).toBe(true);
      expect(resultIds.has('rt-instance')).toBe(true);
      expect(resultIds.has('cfg-t3micro')).toBe(true);
      expect(resultIds.has('cfg-m5large')).toBe(true);

      // Lambda should not be included (not in resourceTypePairs)
      expect(resultIds.has('svc-lambda')).toBe(false);
    });

    it('handles property matches with values that do not match any configuration row', () => {
      const result = filterByStackResources({
        rows: allRows,
        resourceTypePairs: [{ serviceName: 'EC2', resourceTypeName: 'Instance' }],
        propertyMatches: [
          {
            serviceName: 'EC2',
            resourceTypeName: 'Instance',
            propertyName: 'InstanceType',
            value: 'c5.xlarge',
          },
        ],
      });

      const resultIds = new Set(result.map((r) => r.id));

      // Service and resource type should still be included
      expect(resultIds.has('svc-ec2')).toBe(true);
      expect(resultIds.has('rt-instance')).toBe(true);
      expect(resultIds.has('prop-instancetype')).toBe(true);

      // No config rows should match since c5.xlarge is not in the hierarchy
      expect(resultIds.has('cfg-t3micro')).toBe(false);
      expect(resultIds.has('cfg-m5large')).toBe(false);
    });
  });
});

/**
 * Feature: stack-resource-filter, Property 8: Stack filter and PropertyFilter composition
 * Validates: Requirements 4.7
 */
describe('Feature: stack-resource-filter, Property 8: Stack filter and PropertyFilter composition', () => {
  // Arbitrary for non-empty alphanumeric strings used as names
  const nameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]*$/, { minLength: 1, maxLength: 20 });

  /**
   * Generator for a valid CfnAvailability hierarchy (reused from Property 6):
   * - Service rows: parentId = null, type = SERVICE
   * - Resource type rows: parentId = service id, type = RESOURCE_TYPE
   * - Property rows: parentId = resource type id, type = PROPERTY
   * - Configuration rows: parentId = property id, type = CONFIGURATION
   */
  interface GeneratedHierarchy {
    rows: CfnAvailability[];
    serviceMap: Map<string, { serviceName: string; resourceTypeNames: string[] }>;
  }

  const hierarchyArb: fc.Arbitrary<GeneratedHierarchy> = fc
    .array(
      fc.record({
        serviceName: nameArb,
        resourceTypes: fc.array(
          fc.record({
            resourceTypeName: nameArb,
            properties: fc.array(
              fc.record({
                propertyName: nameArb,
                configurations: fc.array(nameArb, { minLength: 0, maxLength: 3 }),
              }),
              { minLength: 0, maxLength: 3 },
            ),
          }),
          { minLength: 1, maxLength: 5 },
        ),
      }),
      { minLength: 1, maxLength: 5 },
    )
    .map((services) => {
      const rows: CfnAvailability[] = [];
      const serviceMap = new Map<string, { serviceName: string; resourceTypeNames: string[] }>();
      let idCounter = 1;

      for (const service of services) {
        const serviceId = `svc-${idCounter++}`;
        const resourceTypeNames: string[] = [];

        rows.push({
          id: serviceId,
          parentId: null,
          name: service.serviceName,
          regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
        });

        for (const rt of service.resourceTypes) {
          const rtId = `rt-${idCounter++}`;
          resourceTypeNames.push(rt.resourceTypeName);

          rows.push({
            id: rtId,
            parentId: serviceId,
            name: rt.resourceTypeName,
            regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
          });

          for (const prop of rt.properties) {
            const propId = `prop-${idCounter++}`;

            rows.push({
              id: propId,
              parentId: rtId,
              name: prop.propertyName,
              regionalAvailabilityType: RegionalAvailabilityType.PROPERTY,
            });

            for (const config of prop.configurations) {
              const configId = `cfg-${idCounter++}`;

              rows.push({
                id: configId,
                parentId: propId,
                name: config,
                regionalAvailabilityType: RegionalAvailabilityType.CONFIGURATION,
              });
            }
          }
        }

        serviceMap.set(serviceId, {
          serviceName: service.serviceName,
          resourceTypeNames,
        });
      }

      return { rows, serviceMap };
    });

  /**
   * Given a generated hierarchy, produce a ResourceTypePair filter set that includes
   * some matching pairs from the hierarchy and optionally some non-matching pairs.
   */
  const filterArb = (hierarchy: GeneratedHierarchy): fc.Arbitrary<ResourceTypePair[]> => {
    const allPairs: ResourceTypePair[] = [];
    for (const [, info] of hierarchy.serviceMap) {
      for (const rtName of info.resourceTypeNames) {
        allPairs.push({ serviceName: info.serviceName, resourceTypeName: rtName });
      }
    }

    const subsetArb = fc.subarray(allPairs, { minLength: 0 });

    const nonMatchingArb = fc.array(
      fc.record({
        serviceName: nameArb,
        resourceTypeName: nameArb,
      }),
      { minLength: 0, maxLength: 3 },
    );

    return fc.tuple(subsetArb, nonMatchingArb).map(([subset, nonMatching]) => {
      const existingKeys = new Set(allPairs.map((p) => `${p.serviceName}::${p.resourceTypeName}`));
      const trulyNonMatching = nonMatching.filter(
        (p) => !existingKeys.has(`${p.serviceName}::${p.resourceTypeName}`),
      );
      return [...subset, ...trulyNonMatching];
    });
  };

  /**
   * Simulated PropertyFilter: filters rows where row.name contains the query string
   * (case-insensitive). This mirrors the name-based substring matching behavior of
   * the PropertyFilter in the AvailabilityTable.
   *
   * For hierarchical data, the PropertyFilter filters the flat array. A parent row
   * is included if it matches OR if any of its descendants match (to preserve structure).
   */
  function simulatedPropertyFilter(rows: CfnAvailability[], query: string): CfnAvailability[] {
    if (query === '') return rows;

    const lowerQuery = query.toLowerCase();
    const rowById = new Map(rows.map((r) => [r.id, r]));

    // First pass: find rows that directly match the query by name
    const directMatchIds = new Set<string>();
    for (const row of rows) {
      if (row.name.toLowerCase().includes(lowerQuery)) {
        directMatchIds.add(row.id);
      }
    }

    // Second pass: include ancestors of matching rows to preserve hierarchy
    const includedIds = new Set<string>(directMatchIds);
    for (const row of rows) {
      if (directMatchIds.has(row.id)) {
        // Walk up the parent chain and include all ancestors
        let current = row.parentId ? rowById.get(row.parentId) : undefined;
        while (current) {
          includedIds.add(current.id);
          current = current.parentId ? rowById.get(current.parentId) : undefined;
        }
      }
    }

    // Third pass: include descendants of matching rows to preserve hierarchy
    // Build children map
    const childrenMap = new Map<string, CfnAvailability[]>();
    for (const row of rows) {
      if (row.parentId) {
        const children = childrenMap.get(row.parentId) ?? [];
        children.push(row);
        childrenMap.set(row.parentId, children);
      }
    }

    function includeDescendants(id: string) {
      const children = childrenMap.get(id) ?? [];
      for (const child of children) {
        includedIds.add(child.id);
        includeDescendants(child.id);
      }
    }

    for (const id of directMatchIds) {
      includeDescendants(id);
    }

    return rows.filter((r) => includedIds.has(r.id));
  }

  /**
   * Generate random name substring queries. We pick substrings from actual row names
   * to ensure some queries produce matches, and also generate random short strings
   * that may or may not match.
   */
  const queryArb = (hierarchy: GeneratedHierarchy): fc.Arbitrary<string> => {
    const allNames = hierarchy.rows.map((r) => r.name);

    // Either pick a substring from an existing name, or generate a random short string
    return fc.oneof(
      // Substring of an existing name (likely to match)
      fc.constantFrom(...allNames).chain((name) => {
        if (name.length === 0) return fc.constant('');
        return fc.tuple(
          fc.integer({ min: 0, max: name.length - 1 }),
          fc.integer({ min: 1, max: name.length }),
        ).map(([start, end]) => {
          const actualEnd = Math.min(start + end, name.length);
          return name.slice(start, actualEnd).toLowerCase();
        });
      }),
      // Random short string (may or may not match)
      fc.stringMatching(/^[a-zA-Z0-9]*$/, { minLength: 0, maxLength: 5 }),
    );
  };

  it('applying stack filter then PropertyFilter produces the same result as PropertyFilter then stack filter', () => {
    fc.assert(
      fc.property(
        hierarchyArb.chain((hierarchy) =>
          fc.tuple(
            filterArb(hierarchy),
            queryArb(hierarchy),
          ).map(([filters, query]) => ({ hierarchy, filters, query })),
        ),
        ({ hierarchy, filters, query }) => {
          const { rows } = hierarchy;

          // Path A: stackFilter first, then PropertyFilter
          const stackFiltered = filterByStackResources({
            rows,
            resourceTypePairs: filters,
            propertyMatches: [],
          });
          const pathA = simulatedPropertyFilter(stackFiltered, query);

          // Path B: PropertyFilter first, then stackFilter
          const propertyFiltered = simulatedPropertyFilter(rows, query);
          const pathB = filterByStackResources({
            rows: propertyFiltered,
            resourceTypePairs: filters,
            propertyMatches: [],
          });

          // Both paths should produce the same set of row IDs
          const idsA = new Set(pathA.map((r) => r.id));
          const idsB = new Set(pathB.map((r) => r.id));

          expect(idsA).toEqual(idsB);
        },
      ),
      { numRuns: 100 },
    );
  });
});
