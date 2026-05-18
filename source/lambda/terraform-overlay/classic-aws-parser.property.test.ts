import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseGoSourceFile } from './classic-aws-parser';

// --- Generators ---

/**
 * Generator for valid Terraform resource names.
 * Format: `aws_` prefix followed by 2-15 lowercase alpha chars with underscores.
 * Ensures no consecutive underscores and doesn't end with underscore.
 */
const terraformResourceNameArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,7}$/),
    fc.stringMatching(/^[a-z]{2,7}$/),
  )
  .map(([service, resource]) => `aws_${service}_${resource}`);

/**
 * Generator for valid CFN type strings.
 * Format: `AWS::` prefix followed by PascalCase Service and Resource segments.
 * e.g., `AWS::S3::Bucket`, `AWS::EC2::Instance`
 */
const cfnTypeArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z][a-z]{1,9}$/),
    fc.stringMatching(/^[A-Z][a-z]{1,9}$/),
  )
  .map(([service, resource]) => `AWS::${service}::${resource}`);

/**
 * Generator for a resource name (the `name` parameter in annotations).
 * Simple PascalCase identifier.
 */
const resourceDisplayNameArb = fc
  .stringMatching(/^[A-Z][a-z]{1,9}$/)
  .map((s) => s);

/**
 * Generator for a single @SDKResource annotation with metadata about what was generated.
 * Randomly decides whether to include cfnType parameter.
 */
const annotationArb = fc
  .tuple(
    terraformResourceNameArb,
    resourceDisplayNameArb,
    cfnTypeArb,
    fc.boolean(), // whether to include cfnType
  )
  .map(([terraformName, displayName, cfnType, includeCfnType]) => {
    const cfnParam = includeCfnType ? `, cfnType="${cfnType}"` : '';
    const annotation = `// @SDKResource("${terraformName}", name="${displayName}"${cfnParam})`;
    return {
      annotation,
      expectedTerraformType: terraformName,
      expectedCfnType: includeCfnType ? cfnType : null,
    };
  });

/**
 * Generator for a Go source file containing N @SDKResource annotations.
 * Generates 1-20 annotations embedded in realistic Go source file structure.
 */
const goSourceFileArb = fc
  .array(annotationArb, { minLength: 1, maxLength: 20 })
  .map((annotations) => {
    const header = `package ec2\n\nimport (\n\t"context"\n\t"fmt"\n)\n\n`;
    const body = annotations
      .map(
        (a, i) =>
          `${a.annotation}\nfunc resource${i}() {}\n`,
      )
      .join('\n');
    return {
      source: header + body,
      annotations,
    };
  });

// --- Property Tests ---

/**
 * Feature: terraform-overlay, Property 3: @SDKResource Annotation Parsing
 *
 * For any Go source file containing N `@SDKResource` annotations, the parser SHALL produce
 * exactly N mapping entries where: (a) each entry's `terraformType` matches the first argument
 * of its annotation, (b) each entry's `cfnType` equals the `cfnType` named parameter value
 * if present, or null if absent.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.5**
 */
describe('Feature: terraform-overlay, Property 3: @SDKResource Annotation Parsing', () => {
  it('N annotations → N mappings with correct terraformType and cfnType', () => {
    fc.assert(
      fc.property(goSourceFileArb, ({ source, annotations }) => {
        // Parse the generated Go source file
        const mappings = parseGoSourceFile(source);

        // Verify: N annotations produce exactly N mappings
        expect(mappings.length).toBe(annotations.length);

        // Verify each mapping matches its corresponding annotation
        for (let i = 0; i < annotations.length; i++) {
          const expected = annotations[i];
          const actual = mappings[i];

          // (a) terraformType matches the first argument of the annotation
          expect(actual.terraformType).toBe(expected.expectedTerraformType);

          // (b) cfnType equals the cfnType named parameter value if present, or null if absent
          expect(actual.cfnType).toBe(expected.expectedCfnType);
        }
      }),
      { numRuns: 100 },
    );
  });
});
