import { describe, it, expect } from 'vitest';
import { validateExceptionEntry, validatePolicyConfiguration } from './validation';
import { CreatePolicyRequest } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

/**
 * Unit tests for validation utilities.
 * Validates: Requirements 6.3, 1.3, 1.5
 */

describe('validateExceptionEntry', () => {
  describe('valid entries', () => {
    it('accepts s3:GetObject', () => {
      expect(validateExceptionEntry('s3:GetObject')).toBe(true);
    });

    it('accepts ec2:* (wildcard)', () => {
      expect(validateExceptionEntry('ec2:*')).toBe(true);
    });

    it('accepts elasticloadbalancing:CreateLoadBalancer', () => {
      expect(validateExceptionEntry('elasticloadbalancing:CreateLoadBalancer')).toBe(true);
    });
  });

  describe('invalid entries', () => {
    it('rejects s3:getObject (lowercase action start)', () => {
      expect(validateExceptionEntry('s3:getObject')).toBe(false);
    });

    it('rejects s3: (empty action after colon)', () => {
      expect(validateExceptionEntry('s3:')).toBe(false);
    });

    it('rejects :GetObject (empty service prefix)', () => {
      expect(validateExceptionEntry(':GetObject')).toBe(false);
    });

    it('rejects s3 (no colon separator)', () => {
      expect(validateExceptionEntry('s3')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(validateExceptionEntry('')).toBe(false);
    });
  });
});

describe('validatePolicyConfiguration', () => {
  const validConfig: CreatePolicyRequest = {
    policyName: 'Test Policy',
    regions: ['us-east-1', 'eu-west-1'],
    mode: 'intersection',
    policyType: 'IAM',
    refreshIntervalHours: 24,
    exceptions: [{ action: 's3:GetObject', reason: 'needed', addedAt: '2024-01-01T00:00:00Z' }],
  };

  it('returns valid: true for a complete valid configuration', () => {
    const result = validatePolicyConfiguration(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when policyName is missing', () => {
    const config = { ...validConfig, policyName: '' };
    const result = validatePolicyConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('policyName'));
  });

  it('returns error when regions array is empty', () => {
    const config = { ...validConfig, regions: [] };
    const result = validatePolicyConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('regions'));
  });

  it('returns error when mode is invalid', () => {
    const config = { ...validConfig, mode: 'invalid' as 'intersection' | 'union' };
    const result = validatePolicyConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('mode'));
  });

  it('returns error when policyType is invalid', () => {
    const config = { ...validConfig, policyType: 'INVALID' as 'IAM' | 'SCP' };
    const result = validatePolicyConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('policyType'));
  });

  it('returns error when refreshIntervalHours is 0 (below range)', () => {
    const config = { ...validConfig, refreshIntervalHours: 0 };
    const result = validatePolicyConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('refreshIntervalHours'));
  });

  it('returns error when refreshIntervalHours is 25 (above range)', () => {
    const config = { ...validConfig, refreshIntervalHours: 25 };
    const result = validatePolicyConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('refreshIntervalHours'));
  });

  it('returns error when exceptions array contains an invalid entry', () => {
    const config = {
      ...validConfig,
      exceptions: [{ action: 's3:getObject', reason: 'bad format', addedAt: '2024-01-01T00:00:00Z' }],
    };
    const result = validatePolicyConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('s3:getObject'));
  });

  it('reports multiple validation errors at once', () => {
    const config = {
      policyName: '',
      regions: [],
      mode: 'bad' as 'intersection' | 'union',
      policyType: 'WRONG' as 'IAM' | 'SCP',
      refreshIntervalHours: 0,
      exceptions: [{ action: 'invalid', reason: '', addedAt: '2024-01-01T00:00:00Z' }],
    };
    const result = validatePolicyConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });
});
