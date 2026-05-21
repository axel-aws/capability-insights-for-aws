# Navigation overhaul: kill mezzanine, section the sidebar, add context

**Severity:** Medium
**Category:** Feature Request
**Page:** All pages (app shell)
**Component:** source/website/app/components/app-shell/app-shell.tsx

## Problem

The side navigation is a flat list of 4 items with no hierarchy or context:
- Capabilities by Region
- Policy Enforcer
- Infrastructure Planning
- Settings

A first-time user has no idea what these sections do, how they relate, or which one to start with. The navigation is also collapsed by default (hamburger menu), making the app's scope completely invisible until clicked.

Additionally, the TopNavigation mezzanine bar contains external links ("AWS Capabilities by Region", "Feedback") that add visual noise without earning their space. There's no user menu, no region selector, no notifications — nothing that justifies a mezzanine. The external links belong in the sidebar's external links section (which CloudScape's pattern explicitly supports).

Per CloudScape's [Side Navigation pattern](https://cloudscape.design/patterns/general/service-navigation/side-navigation/), the current structure is the "Simple" type — appropriate for services where all pages are hierarchically equal. But our app has three distinct *capabilities* (browse, plan, enforce) plus admin settings, which maps better to the **"Organized with sections"** pattern.

## Fix Instructions

### 1. Kill the mezzanine (TopNavigation utilities)

Remove all `utilities` from the `TopNavigation` component. Keep only the `identity` prop (app name + logo link to `/`). The TopNavigation becomes a minimal identity bar only:

```tsx
<TopNavigation
  identity={{
    href: '/',
    title: APP_NAME,
  }}
  // No utilities — external links move to sidebar
/>
```

### 2. Switch to "Organized with sections" navigation pattern

Replace the flat `items` array with a sectioned structure using CloudScape's `section` type. Each section header is non-clickable but provides grouping context:

```tsx
<SideNavigation
  header={{ href: '/', text: APP_NAME }}
  items={[
    {
      type: 'section',
      text: 'Explore',
      items: [
        { type: 'link', text: 'Capabilities by Region', href: '/' },
      ],
    },
    {
      type: 'section',
      text: 'Act',
      items: [
        { type: 'link', text: 'Infrastructure Planning', href: '/infrastructure-planning' },
        { type: 'link', text: 'Policy Enforcer', href: '/policy-enforcer' },
      ],
    },
    {
      type: 'section',
      text: 'Admin',
      items: [
        { type: 'link', text: 'Settings', href: '/settings' },
      ],
    },
    { type: 'divider' },
    {
      type: 'link',
      text: 'AWS Capabilities by Region',
      href: 'https://builder.aws.com/build/capabilities',
      external: true,
    },
    {
      type: 'link',
      text: 'GitHub',
      href: 'https://github.com/aws-samples/capability-insights-for-aws',
      external: true,
    },
    {
      type: 'link',
      text: 'Feedback',
      href: 'https://pulse.aws/survey/YNDERBWH?p=0',
      external: true,
    },
  ]}
/>
```

### 3. Update constants

In `source/website/app/constants/app.ts`, update:

```ts
export const FEEDBACK_EXTERNAL_URL = 'https://pulse.aws/survey/YNDERBWH?p=0';
export const GITHUB_REPO_URL = 'https://github.com/aws-samples/capability-insights-for-aws';
```

Remove `AWS_CAPABILITY_EXTERNAL` and `FEEDBACK_EXTERNAL` constants from the TopNavigation usage (they now live in the sidebar items array only).

### 4. Add `info` descriptions to nav items

CloudScape's SideNavigation link items support an `info` prop (ReactNode) for supplementary text. Use this to briefly communicate purpose:

```tsx
{ 
  type: 'link', 
  text: 'Infrastructure Planning', 
  href: '/infrastructure-planning',
  info: <Box color="text-body-secondary" fontSize="body-s">Where will my stack work?</Box>
},
{ 
  type: 'link', 
  text: 'Policy Enforcer', 
  href: '/policy-enforcer',
  info: <Box color="text-body-secondary" fontSize="body-s">Prevent unavailable API calls</Box>
},
```

### 5. Keep navigation open by default on wider viewports

Per CloudScape guidelines: "Keep the side navigation open by default for returning users." Change:

```tsx
const [navOpen, setNavOpen] = useState(false);
```

to:

```tsx
const [navOpen, setNavOpen] = useState(() => {
  const saved = localStorage.getItem('navOpen');
  return saved !== null ? saved === 'true' : window.innerWidth >= 1200;
});
```

### 6. Section naming rationale

| Section | Contains | User question it answers |
|---------|----------|--------------------------|
| **Explore** | Capabilities by Region | "What's available where?" |
| **Act** | Infrastructure Planning, Policy Enforcer | "What do I do with this data?" |
| **Admin** | Settings | "How do I configure this tool?" |

Alternative section names if "Explore/Act/Admin" feels too abstract:
- "Data" / "Tools" / "Configuration"
- "Availability" / "Planning & Governance" / "Settings"

### 7. CloudScape best practices applied

Per the [CloudScape Side Navigation pattern](https://cloudscape.design/patterns/general/service-navigation/side-navigation/):
- ✅ "Organize from general to specific, in order of usefulness"
- ✅ "Keep groupings to a minimum" (3 sections)
- ✅ "Section header is not a link but provides grouping"
- ✅ "Keep the side navigation open by default for returning users"
- ✅ External links below a divider at bottom of sidebar (not in mezzanine)
- ✅ TopNavigation reduced to identity-only (no utilities needed without user menu/region selector)

**Acceptance Criteria:**
- [ ] TopNavigation mezzanine has NO utility buttons (identity only)
- [ ] Side navigation uses the "Organized with sections" pattern with 3 groups (Explore, Act, Admin)
- [ ] Each section has a descriptive header (Explore, Act, Admin or similar)
- [ ] Infrastructure Planning and Policy Enforcer have brief `info` text explaining their purpose
- [ ] External links section (below divider) includes: AWS Capabilities by Region, GitHub, Feedback
- [ ] Feedback link points to https://pulse.aws/survey/YNDERBWH?p=0
- [ ] GitHub link points to https://github.com/aws-samples/capability-insights-for-aws
- [ ] Navigation is open by default on viewports >= 1200px
- [ ] Navigation state persists across page navigations (already works via React state)
- [ ] Breadcrumbs remain consistent with the new section structure
