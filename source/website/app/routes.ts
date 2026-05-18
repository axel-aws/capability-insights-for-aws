import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('pages/capability-by-region.tsx'),
  route('settings', 'pages/settings.tsx'),
  route('policy-enforcer', 'pages/policy-enforcer/policy-enforcer-page.tsx'),
  route('policy-enforcer/create', 'pages/policy-enforcer/create-policy-wizard.tsx'),
  route('policy-enforcer/:policyId/edit', 'pages/policy-enforcer/edit-policy-page.tsx'),
  route('policy-enforcer/:policyId', 'pages/policy-enforcer/policy-detail-page.tsx'),
  route('infrastructure-planning', 'pages/infrastructure-planning/infrastructure-planning-page.tsx'),
  route('infrastructure-planning/create', 'pages/infrastructure-planning/create-plan-wizard.tsx'),
  route('infrastructure-planning/:planId', 'pages/infrastructure-planning/plan-detail-page.tsx'),
] satisfies RouteConfig;
