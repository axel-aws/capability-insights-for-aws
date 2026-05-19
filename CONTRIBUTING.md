# Contributing Guidelines

Thank you for your interest in contributing to our project. Whether it's a bug report, new feature, correction, or additional
documentation, we greatly value feedback and contributions from our community.

Please read through this document before submitting any issues or pull requests to ensure we have all the necessary
information to effectively respond to your bug report or contribution.

## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, please check existing open, or recently closed, issues to make sure somebody else hasn't already
reported the issue. Please try to include as much information as you can. Details like these are incredibly useful:

- A reproducible test case or series of steps
- The version of our code being used
- Any modifications you've made relevant to the bug
- Anything unusual about your environment or deployment

## Contributing via Pull Requests

Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the **`development`** branch (not `main`).
2. You check existing open, and recently merged, pull requests to make sure someone else hasn't addressed the problem already.
3. You open an issue to discuss any significant work - we would hate for your time to be wasted.

### Branching Strategy

This project uses a two-branch workflow:

- **`development`** — the active development branch. All pull requests should target this branch.
- **`main`** — the stable release branch. Only updated when we cut a release by merging `development` into `main`.

> **⚠️ Do not open pull requests against `main`.** PRs targeting `main` will be closed and asked to retarget `development`.

To send us a pull request, please:

1. Fork the repository.
2. Create your feature branch from **`development`** (`git checkout -b my-feature development`).
3. Modify the source; please focus on the specific change you are contributing. If you also reformat all the code, it will be hard for us to focus on your change.
4. Ensure local tests pass.
5. Commit to your fork using clear commit messages.
6. Open a pull request **targeting the `development` branch**, answering any default questions in the pull request interface.
7. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

GitHub provides additional document on [forking a repository](https://help.github.com/articles/fork-a-repo/) and
[creating a pull request](https://help.github.com/articles/creating-a-pull-request/).

## Contributing a New Feature

This section walks you through adding a new feature end-to-end. The project uses **npm workspaces** to organize code into four packages:

| Workspace                     | Path                | Purpose                                                          |
| ----------------------------- | ------------------- | ---------------------------------------------------------------- |
| `@capability-insights/shared` | `source/shared`     | TypeScript interfaces and types shared across Lambda and website |
| `@capability-insights/lambda` | `source/lambda`     | API Lambda route handlers and helper Lambdas                     |
| `source/constructs`           | `source/constructs` | CDK infrastructure (stacks, constructs)                          |
| `source/website`              | `source/website`    | React frontend built with Cloudscape Design System               |

When you change a type in `source/shared/types/`, both `source/lambda` and `source/website` see the update immediately — npm workspaces symlinks the shared package into each consumer's `node_modules`. No separate publish step is needed. Just run `npm install` at the repo root if you add a new file to `source/shared`.

### Feature Checklist

Follow these steps in order. We'll use **Infrastructure Planning** (`/plans` routes, `infrastructure-planning-client.ts`, `infrastructure-planning-page.tsx`) as a concrete example throughout.

---

**1. Define shared types**

Create or extend TypeScript interfaces in `source/shared/types/` that describe the data your feature exchanges between the backend and frontend. Group related types in a subdirectory (e.g., `source/shared/types/infrastructure-planning/`). Export them from an `index.ts` barrel file so consumers can import cleanly.

_Example_: `source/shared/types/infrastructure-planning/` defines `Plan`, `PlanSummary`, `CapabilitySet`, and related interfaces used by both the Lambda routes and the frontend client.

---

**2. Implement the service layer**

Create a new route file in `source/lambda/routes/` (e.g., `plan-routes.ts`). Each route handler is an async function that receives an `APIGatewayProxyEvent` (and optionally extracted path params) and returns an `APIGatewayProxyResult`. Use the `ErrorResponse` class from `source/lambda/constants/errors.ts` for consistent error responses, and `corsHeaders` from `source/lambda/types/api.ts` for response headers.

_Example_: `source/lambda/routes/plan-routes.ts` exports `createPlanRoute`, `listPlansRoute`, `getPlanRoute`, `updatePlanRoute`, `deletePlanRoute`, `reprocessPlanRoute`, and `getCapabilitySetRoute`.

---

**3. Create the route handler**

Inside your route file, implement the business logic. For routes that interact with AWS services, use the AWS SDK v3 clients. Keep route handlers focused — if logic is complex, extract helper functions into a `services/` or `util/` subdirectory. Each handler should validate input, perform the operation, and return a JSON response with appropriate status codes.

_Example_: `createPlanRoute` validates the request body, invokes the GitHub analysis service, stores results in S3, and returns the new plan with a `201` status code.

---

**4. Register the route in `api-lambda-main.ts`**

Open `source/lambda/api-lambda-main.ts` and register your route handlers. Use `registerRoute(method, path, handler)` for static paths and `registerParameterizedRoute(method, pathTemplate, handler)` for paths with parameters (e.g., `/plans/:planId`). Import your handler at the top of the file and add the registration call in the appropriate section.

_Example_:

```typescript
import { createPlanRoute, listPlansRoute, getPlanRoute, ... } from './routes/plan-routes';

registerRoute(HttpMethod.POST, '/plans', createPlanRoute);
registerRoute(HttpMethod.GET, '/plans', listPlansRoute);
registerParameterizedRoute(HttpMethod.GET, '/plans/:planId', getPlanRoute);
registerParameterizedRoute(HttpMethod.PUT, '/plans/:planId', updatePlanRoute);
```

---

**5. Add a frontend API client method**

Create a client file in `source/website/app/clients/` (e.g., `infrastructure-planning-client.ts`). This module wraps `fetch()` calls to your new API routes and returns typed responses using the shared interfaces from step 1. Keep the client thin — it handles serialization, error mapping, and base URL construction, but no business logic.

_Example_: `infrastructure-planning-client.ts` exports `createPlan()`, `listPlans()`, `getPlan(planId)`, `updatePlan(planId, body)`, `deletePlan(planId)`, etc. Each method calls the corresponding API route and returns the typed response.

---

**6. Build the page component**

Create a page directory under `source/website/app/pages/` (e.g., `pages/infrastructure-planning/`). Use Cloudscape Design System components for layout (`ContentLayout`, `Container`, `Table`, `Form`, etc.). Pages typically have a list page, a detail page, and a create/edit wizard. Use React hooks for data fetching and state management.

_Example_: `source/website/app/pages/infrastructure-planning/` contains `infrastructure-planning-page.tsx` (list view), `plan-detail-page.tsx` (detail view), and `create-plan-wizard.tsx` (creation flow).

---

**7. Add a navigation entry**

Two files need updating:

1. **Routes** — Add your page routes to `source/website/app/routes.ts` using the `route()` helper from React Router.
2. **Side navigation** — Add a link to `source/website/app/components/app-shell/app-shell.tsx` in the `SideNavigation` items array.

_Example_:

```typescript
// routes.ts
route('infrastructure-planning', 'pages/infrastructure-planning/infrastructure-planning-page.tsx'),
route('infrastructure-planning/create', 'pages/infrastructure-planning/create-plan-wizard.tsx'),
route('infrastructure-planning/:planId', 'pages/infrastructure-planning/plan-detail-page.tsx'),
```

```typescript
// app-shell.tsx — SideNavigation items
{ type: 'link', text: PAGE_INFRASTRUCTURE_PLANNING, href: '/infrastructure-planning' },
```

---

**8. Add tests**

This project uses **Vitest** as the test runner and **fast-check** for property-based testing. Follow the **co-location pattern**: place test files next to the source file they test, using the `.test.ts` (or `.test.tsx`) suffix.

| What to test    | Where                                                  | Pattern                                                       |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Route handlers  | `source/lambda/routes/my-route.test.ts`                | Unit test with mocked AWS SDK clients (`aws-sdk-client-mock`) |
| Property tests  | `source/lambda/routes/my-route.property.test.ts`       | Use `fast-check` to verify invariants across generated inputs |
| Frontend client | `source/website/app/clients/my-client.test.ts`         | Mock `fetch`, verify request/response mapping                 |
| Page components | `source/website/app/pages/my-feature/my-page.test.tsx` | Render with test data, verify Cloudscape components render    |

Run tests for a single workspace:

```bash
npm run test --workspace=source/lambda
npm run test --workspace=source/website
```

Run all tests from the repo root:

```bash
npm test
```

**Property-based testing tip**: Use `fast-check` to generate random valid inputs and assert that invariants hold. For example, a route that accepts a JSON body should never crash regardless of the body shape — you can generate arbitrary JSON objects and assert the response is always a valid `APIGatewayProxyResult`.

---

### Quick Reference: Policy Enforcer Example

The **Policy Enforcer** feature follows the same pattern and is another good reference:

- Shared types: `source/shared/types/policy-enforcer/`
- Route handlers: `source/lambda/routes/policy-routes.ts`, `policy-parts-routes.ts`
- Route registration: `api-lambda-main.ts` (search for "Policy Enforcer routes")
- Frontend client: `source/website/app/clients/policy-enforcer-client.ts`
- Pages: `source/website/app/pages/policy-enforcer/`
- Navigation: `routes.ts` and `app-shell.tsx`
- Tests: co-located `.test.ts` files in each directory

## Finding contributions to work on

Looking at the existing issues is a great way to find something to contribute on. As our projects, by default, use the default GitHub issue labels (enhancement/bug/duplicate/help wanted/invalid/question/wontfix), looking at any 'help wanted' issues is a great place to start.

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Security issue notifications

If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public github issue.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing. We will ask you to confirm the licensing of your contribution.
