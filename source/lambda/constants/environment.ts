export const EnvironmentKey = {
  WEBSITE_BUCKET_NAME: 'WEBSITE_BUCKET_NAME',
  DATA_BUCKET_NAME: 'DATA_BUCKET_NAME',
  DATA_BUCKET_PATH: 'DATA_BUCKET_PATH',
  SOURCE_ACCESS_POINT_ARN: 'SOURCE_ACCESS_POINT_ARN',
  SOURCE_FOLDERS: 'SOURCE_FOLDERS',
  DATA_FETCH_LAMBDA_NAME: 'DATA_FETCH_LAMBDA_NAME',
  CLOUDTRAIL_ANALYZER_LAMBDA_NAME: 'CLOUDTRAIL_ANALYZER_LAMBDA_NAME',
  // TODO: Add these to the usage-analysis-stack and insights stack env vars once the analyzers are implemented
  RESOURCE_EXPLORER_ANALYZER_LAMBDA_NAME: 'RESOURCE_EXPLORER_ANALYZER_LAMBDA_NAME',
  CLOUDFORMATION_ANALYZER_LAMBDA_NAME: 'CLOUDFORMATION_ANALYZER_LAMBDA_NAME',
  ANALYSIS_STATE_MACHINE_ARN: 'ANALYSIS_STATE_MACHINE_ARN',
  POLICY_TABLE_NAME: 'POLICY_TABLE_NAME',
  IAM_HELPER_LAMBDA_NAME: 'IAM_HELPER_LAMBDA_NAME',
  TERRAFORM_OVERLAY_FUNCTION_NAME: 'TERRAFORM_OVERLAY_FUNCTION_NAME',
  PLAN_TABLE_NAME: 'PLAN_TABLE_NAME',
  GITHUB_TOKEN_SECRET_NAME: 'GITHUB_TOKEN_SECRET_NAME',
  GITHUB_FETCH_FUNCTION_NAME: 'GITHUB_FETCH_FUNCTION_NAME',
  DATA_UPLOADS_TABLE_NAME: 'DATA_UPLOADS_TABLE_NAME',
} as const;

export type EnvironmentKey = (typeof EnvironmentKey)[keyof typeof EnvironmentKey];

export function getEnv(key: EnvironmentKey): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

/** Returns the environment variable value or a fallback if not set. */
export function getOptionalEnv(key: EnvironmentKey, fallback = ''): string {
  return process.env[key] ?? fallback;
}
