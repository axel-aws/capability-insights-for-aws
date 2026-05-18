import type {
  PlanConfiguration,
  CapabilitySet,
  CreatePlanRequest,
  UpdatePlanRequest,
  ListPlansQuery,
  PlanNamesResponse,
} from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';
import { s3Client } from './s3-client';

export class InfrastructurePlanningClient {
  private cachedBaseUrl: string | null = null;

  private async getApiBaseUrl(): Promise<string> {
    if (this.cachedBaseUrl) return this.cachedBaseUrl;
    const config = await s3Client.fetchJson<{ apiBaseUrl: string }>('/api-config.json');
    this.cachedBaseUrl = config.apiBaseUrl;
    return this.cachedBaseUrl;
  }

  async createPlan(request: CreatePlanRequest): Promise<PlanConfiguration> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Failed to create plan: ${res.status}`);
    }
    const data = await res.json();
    return data.plan;
  }

  async listPlans(query?: ListPlansQuery): Promise<PlanConfiguration[]> {
    const baseUrl = await this.getApiBaseUrl();
    const params = new URLSearchParams();
    if (query?.search) params.set('search', query.search);
    if (query?.sourceType) params.set('sourceType', query.sourceType);
    if (query?.labelKey) params.set('labelKey', query.labelKey);
    if (query?.labelValue) params.set('labelValue', query.labelValue);

    const queryString = params.toString();
    const url = queryString ? `${baseUrl}/plans?${queryString}` : `${baseUrl}/plans`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Failed to list plans: ${res.status}`);
    }
    const data = await res.json();
    return data.plans;
  }

  async getPlan(planId: string): Promise<PlanConfiguration> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/plans/${encodeURIComponent(planId)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Failed to get plan: ${res.status}`);
    }
    const data = await res.json();
    return data.plan;
  }

  async updatePlan(planId: string, request: UpdatePlanRequest): Promise<PlanConfiguration> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/plans/${encodeURIComponent(planId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Failed to update plan: ${res.status}`);
    }
    const data = await res.json();
    return data.plan;
  }

  async deletePlan(planId: string): Promise<void> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/plans/${encodeURIComponent(planId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Failed to delete plan: ${res.status}`);
    }
  }

  async reprocessPlan(planId: string, templateContent?: string): Promise<PlanConfiguration> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/plans/${encodeURIComponent(planId)}/reprocess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(templateContent ? { templateContent } : {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Failed to reprocess plan: ${res.status}`);
    }
    const data = await res.json();
    return data.plan;
  }

  async getCapabilitySet(planId: string): Promise<CapabilitySet> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/plans/${encodeURIComponent(planId)}/capability-set`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Failed to get capability set: ${res.status}`);
    }
    return res.json();
  }

  async listPlanNames(): Promise<string[]> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/plans/names`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Failed to list plan names: ${res.status}`);
    }
    const data: PlanNamesResponse = await res.json();
    return data.planNames;
  }
}

export const infrastructurePlanningClient = new InfrastructurePlanningClient();
