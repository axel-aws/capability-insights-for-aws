import type {
  PolicyConfiguration,
  CreatePolicyRequest,
  ListPoliciesQuery,
  PreviewResponse,
} from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { s3Client } from './s3-client';

export class PolicyEnforcerClient {
  private cachedBaseUrl: string | null = null;

  private async getApiBaseUrl(): Promise<string> {
    if (this.cachedBaseUrl) return this.cachedBaseUrl;
    const config = await s3Client.fetchJson<{ apiBaseUrl: string }>('/api-config.json');
    this.cachedBaseUrl = config.apiBaseUrl;
    return this.cachedBaseUrl;
  }

  async createPolicy(request: CreatePolicyRequest): Promise<PolicyConfiguration> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to create policy: ${res.status}`);
    }
    const data = await res.json();
    return data.policy;
  }

  async listPolicies(query?: ListPoliciesQuery): Promise<PolicyConfiguration[]> {
    const baseUrl = await this.getApiBaseUrl();
    const params = new URLSearchParams();
    if (query?.tagKey) params.set('tagKey', query.tagKey);
    if (query?.tagValue) params.set('tagValue', query.tagValue);
    if (query?.status) params.set('status', query.status);
    if (query?.search) params.set('search', query.search);

    const queryString = params.toString();
    const url = queryString ? `${baseUrl}/policies?${queryString}` : `${baseUrl}/policies`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to list policies: ${res.status}`);
    }
    const data = await res.json();
    return data.policies;
  }

  async getPolicy(policyId: string): Promise<PolicyConfiguration> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/policies/${encodeURIComponent(policyId)}`);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to get policy: ${res.status}`);
    }
    const data = await res.json();
    return data.policy;
  }

  async updatePolicy(
    policyId: string,
    request: CreatePolicyRequest,
  ): Promise<PolicyConfiguration> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/policies/${encodeURIComponent(policyId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to update policy: ${res.status}`);
    }
    const data = await res.json();
    return data.policy;
  }

  async deletePolicy(policyId: string): Promise<void> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/policies/${encodeURIComponent(policyId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to delete policy: ${res.status}`);
    }
  }

  async refreshPolicy(policyId: string): Promise<void> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/policies/${encodeURIComponent(policyId)}/refresh`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to refresh policy: ${res.status}`);
    }
  }

  async previewPolicy(policyId: string): Promise<PreviewResponse> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/policies/${encodeURIComponent(policyId)}/preview`);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to preview policy: ${res.status}`);
    }
    return res.json();
  }

  async downloadTemplate(policyId: string): Promise<string> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/policies/${encodeURIComponent(policyId)}/template`);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to download template: ${res.status}`);
    }
    return res.text();
  }
}

export const policyEnforcerClient = new PolicyEnforcerClient();
