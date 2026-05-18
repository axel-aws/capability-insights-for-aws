import type { ClassicAwsMapping } from '../../shared/types/terraform-overlay';

/**
 * Parses a Go source file for all @SDKResource annotations and extracts
 * Terraform resource name and optional CFN type mappings.
 *
 * Annotation format examples:
 *   // @SDKResource("aws_s3_bucket", name="Bucket")
 *   // @SDKResource("aws_instance", name="Instance", cfnType="AWS::EC2::Instance")
 *
 * Returns one ClassicAwsMapping per annotation found. Resources without
 * a cfnType parameter are marked as unmapped (cfnType: null).
 */
export function parseGoSourceFile(content: string): ClassicAwsMapping[] {
  const annotationRegex = /@SDKResource\(([^)]+)\)/g;
  const mappings: ClassicAwsMapping[] = [];

  let match: RegExpExecArray | null;
  while ((match = annotationRegex.exec(content)) !== null) {
    const parsed = parseSdkResourceAnnotation(match[0]);
    if (parsed) {
      mappings.push(parsed);
    }
  }

  return mappings;
}

/**
 * Parses a single @SDKResource annotation string and extracts the
 * Terraform resource name (first quoted argument) and optional cfnType
 * named parameter.
 *
 * Input examples:
 *   '@SDKResource("aws_s3_bucket", name="Bucket")'
 *   '@SDKResource("aws_instance", name="Instance", cfnType="AWS::EC2::Instance")'
 *
 * Returns null if the annotation cannot be parsed (e.g., missing first argument).
 */
export function parseSdkResourceAnnotation(annotation: string): ClassicAwsMapping | null {
  // Extract the content inside @SDKResource(...)
  const outerMatch = annotation.match(/@SDKResource\(([^)]+)\)/);
  if (!outerMatch) {
    return null;
  }

  const inner = outerMatch[1];

  // Extract the first quoted argument (Terraform resource name)
  const firstArgMatch = inner.match(/^"([^"]+)"/);
  if (!firstArgMatch) {
    return null;
  }

  const terraformType = firstArgMatch[1];

  // Extract the optional cfnType named parameter
  // Supports: cfnType="value", cfnType = "value"
  const cfnTypeMatch = inner.match(/cfnType\s*=\s*"([^"]+)"/);
  const cfnType = cfnTypeMatch ? cfnTypeMatch[1] : null;

  return { terraformType, cfnType };
}
