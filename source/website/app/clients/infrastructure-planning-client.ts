import type {
  PlanConfiguration,
  CapabilitySet,
  CreatePlanRequest,
  UpdatePlanRequest,
  ListPlansQuery,
  PlanNamesResponse,
} from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';
import { BaseApiClient } from './base-api-client';

export class InfrastructurePlanningClient extends BaseApiClient {
  async createPlan(request: CreatePlanRequest): Promise<PlanConfiguration> {
    const data = await this.post<{ plan: PlanConfiguration }>('/plans', request);
    return data.plan;
  }

  async listPlans(query?: ListPlansQuery): Promise<PlanConfiguration[]> {
    const params = new URLSearchParams();
    if (query?.search) params.set('search', query.search);
    if (query?.sourceType) params.set('sourceType', query.sourceType);
    if (query?.labelKey) params.set('labelKey', query.labelKey);
    if (query?.labelValue) params.set('labelValue', query.labelValue);
    const qs = params.toString();
    const data = await this.get<{ plans: PlanConfiguration[] }>(qs ? `/plans?${qs}` : '/plans');
    return data.plans;
  }

  async getPlan(planId: string): Promise<PlanConfiguration> {
    const data = await this.get<{ plan: PlanConfiguration }>(`/plans/${encodeURIComponent(planId)}`);
    return data.plan;
  }

  async updatePlan(planId: string, request: UpdatePlanRequest): Promise<PlanConfiguration> {
    const data = await this.put<{ plan: PlanConfiguration }>(`/plans/${encodeURIComponent(planId)}`, request);
    return data.plan;
  }

  async deletePlan(planId: string): Promise<void> {
    await this.del(`/plans/${encodeURIComponent(planId)}`);
  }

  async reprocessPlan(planId: string, templateContent?: string): Promise<PlanConfiguration> {
    const data = await this.post<{ plan: PlanConfiguration }>(
      `/plans/${encodeURIComponent(planId)}/reprocess`,
      templateContent ? { templateContent } : {},
    );
    return data.plan;
  }

  async getCapabilitySet(planId: string): Promise<CapabilitySet> {
    return this.get<CapabilitySet>(`/plans/${encodeURIComponent(planId)}/capability-set`);
  }

  async listPlanNames(): Promise<string[]> {
    const data = await this.get<PlanNamesResponse>('/plans/names');
    return data.planNames;
  }
}

export const infrastructurePlanningClient = new InfrastructurePlanningClient();
