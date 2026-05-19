import type {
  PolicyConfiguration,
  CreatePolicyRequest,
  ListPoliciesQuery,
  PreviewResponse,
  PolicyPartsResponse,
  PolicyPartDetailResponse,
  CascadingDeleteResponse,
} from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { BaseApiClient } from './base-api-client';

export class PolicyEnforcerClient extends BaseApiClient {
  async createPolicy(request: CreatePolicyRequest): Promise<PolicyConfiguration> {
    const data = await this.post<{ policy: PolicyConfiguration }>('/policies', request);
    return data.policy;
  }

  async listPolicies(query?: ListPoliciesQuery): Promise<PolicyConfiguration[]> {
    const params = new URLSearchParams();
    if (query?.tagKey) params.set('tagKey', query.tagKey);
    if (query?.tagValue) params.set('tagValue', query.tagValue);
    if (query?.status) params.set('status', query.status);
    if (query?.search) params.set('search', query.search);
    const qs = params.toString();
    const data = await this.get<{ policies: PolicyConfiguration[] }>(qs ? `/policies?${qs}` : '/policies');
    return data.policies;
  }

  async getPolicy(policyId: string): Promise<PolicyConfiguration> {
    const data = await this.get<{ policy: PolicyConfiguration }>(`/policies/${encodeURIComponent(policyId)}`);
    return data.policy;
  }

  async updatePolicy(policyId: string, request: CreatePolicyRequest): Promise<PolicyConfiguration> {
    const data = await this.put<{ policy: PolicyConfiguration }>(`/policies/${encodeURIComponent(policyId)}`, request);
    return data.policy;
  }

  async deletePolicy(policyId: string): Promise<CascadingDeleteResponse> {
    return this.del<CascadingDeleteResponse>(`/policies/${encodeURIComponent(policyId)}`);
  }

  async refreshPolicy(policyId: string): Promise<void> {
    await this.post(`/policies/${encodeURIComponent(policyId)}/refresh`, {});
  }

  async previewPolicy(policyId: string): Promise<PreviewResponse> {
    return this.get<PreviewResponse>(`/policies/${encodeURIComponent(policyId)}/preview`);
  }

  async downloadTemplate(policyId: string): Promise<string> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/policies/${encodeURIComponent(policyId)}/template`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as Record<string, unknown>).message as string ?? `Failed to download template: ${res.status}`);
    }
    return res.text();
  }

  async getPolicyParts(policyId: string): Promise<PolicyPartsResponse> {
    return this.get<PolicyPartsResponse>(`/policies/${encodeURIComponent(policyId)}/parts`);
  }

  async getPolicyPartDetail(policyId: string, partIndex: number): Promise<PolicyPartDetailResponse> {
    return this.get<PolicyPartDetailResponse>(`/policies/${encodeURIComponent(policyId)}/parts/${partIndex}`);
  }

  async deletePolicyPart(policyId: string, partIndex: number): Promise<void> {
    await this.del(`/policies/${encodeURIComponent(policyId)}/parts/${partIndex}`);
  }

  async refreshAllPolicies(policyIds: string[]): Promise<void> {
    await Promise.all(policyIds.map((policyId) => this.refreshPolicy(policyId)));
  }
}

export const policyEnforcerClient = new PolicyEnforcerClient();
