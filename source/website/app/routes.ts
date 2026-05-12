import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('pages/capability-by-region.tsx'),
  route('settings', 'pages/settings.tsx'),
  route('policy-enforcer', 'pages/policy-enforcer/policy-enforcer-page.tsx'),
  route('policy-enforcer/create', 'pages/policy-enforcer/create-policy-wizard.tsx'),
] satisfies RouteConfig;
