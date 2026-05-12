import { CreatePolicyRequest } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const EXCEPTION_ENTRY_REGEX = /^[a-zA-Z0-9-]+:(([A-Z][a-zA-Z0-9]*)|(\*))$/;

/**
 * Validates that an exception entry action string matches the required format:
 * a service prefix (alphanumeric + hyphens), followed by a colon, followed by
 * either a PascalCase action name (starts with uppercase) or a wildcard `*`.
 */
export function validateExceptionEntry(action: string): boolean {
  return EXCEPTION_ENTRY_REGEX.test(action);
}

/**
 * Validates a full CreatePolicyRequest configuration object.
 * Returns a ValidationResult with a valid flag and an array of error messages.
 */
export function validatePolicyConfiguration(config: CreatePolicyRequest): ValidationResult {
  const errors: string[] = [];

  if (!config.policyName || config.policyName.trim().length === 0) {
    errors.push('policyName is required and must be a non-empty string');
  }

  if (!config.regions || !Array.isArray(config.regions) || config.regions.length === 0) {
    errors.push('regions must be a non-empty array');
  }

  if (config.mode !== 'intersection' && config.mode !== 'union') {
    errors.push('mode must be either "intersection" or "union"');
  }

  if (config.policyType !== 'IAM' && config.policyType !== 'SCP') {
    errors.push('policyType must be either "IAM" or "SCP"');
  }

  if (config.refreshIntervalHours !== undefined) {
    if (config.refreshIntervalHours < 1 || config.refreshIntervalHours > 24) {
      errors.push('refreshIntervalHours must be between 1 and 24');
    }
  }

  if (config.exceptions) {
    for (const exception of config.exceptions) {
      if (!validateExceptionEntry(exception.action)) {
        errors.push(`Invalid exception entry: "${exception.action}" does not match required format "service:Action" or "service:*"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
