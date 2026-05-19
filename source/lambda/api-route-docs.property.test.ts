/**
 * Property Test: API Route Documentation Completeness
 *
 * **Validates: Requirements 2.2**
 *
 * For any route registered in `api-lambda-main.ts` (via `registerRoute` or
 * `registerParameterizedRoute`), the `docs/API.md` file SHALL contain an entry
 * documenting that route's HTTP method and path.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface RegisteredRoute {
  method: string;
  path: string;
  type: 'exact' | 'parameterized';
}

/**
 * Parse api-lambda-main.ts to extract all registered routes.
 * Matches both `registerRoute('METHOD', '/path', handler)` and
 * `registerParameterizedRoute('METHOD', '/path/:param', handler)`.
 */
function extractRegisteredRoutes(sourceFilePath: string): RegisteredRoute[] {
  const content = fs.readFileSync(sourceFilePath, 'utf-8');
  const routes: RegisteredRoute[] = [];

  // Match registerRoute(HttpMethod.METHOD, '/path', handler)
  // and registerRoute('METHOD', '/path', handler)
  const exactRouteRegex = /registerRoute\(\s*(?:HttpMethod\.)?(\w+)\s*,\s*'([^']+)'\s*,/g;
  let match: RegExpExecArray | null;

  while ((match = exactRouteRegex.exec(content)) !== null) {
    routes.push({
      method: match[1],
      path: match[2],
      type: 'exact',
    });
  }

  // Match registerParameterizedRoute(HttpMethod.METHOD, '/path/:param', handler)
  // and registerParameterizedRoute('METHOD', '/path/:param', handler)
  const paramRouteRegex = /registerParameterizedRoute\(\s*(?:HttpMethod\.)?(\w+)\s*,\s*'([^']+)'\s*,/g;

  while ((match = paramRouteRegex.exec(content)) !== null) {
    routes.push({
      method: match[1],
      path: match[2],
      type: 'parameterized',
    });
  }

  return routes;
}

describe('Property 1: API route documentation completeness', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const sourceFilePath = path.join(repoRoot, 'source/lambda/api-lambda-main.ts');
  const apiDocPath = path.join(repoRoot, 'docs/API.md');

  const registeredRoutes = extractRegisteredRoutes(sourceFilePath);
  const apiDocContent = fs.readFileSync(apiDocPath, 'utf-8');

  it('should have extracted at least one route from api-lambda-main.ts', () => {
    expect(registeredRoutes.length).toBeGreaterThan(0);
  });

  /**
   * **Validates: Requirements 2.2**
   *
   * Property: For every route registered in api-lambda-main.ts, the docs/API.md
   * file contains an entry with that route's HTTP method and path.
   */
  it('every registered route appears in docs/API.md', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...registeredRoutes),
        (route: RegisteredRoute) => {
          // The API doc should contain the method somewhere near the path.
          // We check that both the method and path appear in the document,
          // and specifically that the path appears in the route table or
          // as a heading (e.g., "#### GET /stacks" or "| GET | `/stacks`")
          const methodInDoc = apiDocContent.includes(route.method);
          const pathInDoc = apiDocContent.includes(route.path);

          // More specific check: the route table uses "| METHOD | `path`" format
          // or the route heading uses "#### METHOD path" format
          const routeTableEntry = apiDocContent.includes(`| ${route.method}`) && apiDocContent.includes(route.path);
          const routeHeading = apiDocContent.includes(`${route.method} ${route.path}`);

          const isDocumented = methodInDoc && pathInDoc && (routeTableEntry || routeHeading);

          if (!isDocumented) {
            throw new Error(
              `Route ${route.method} ${route.path} (${route.type}) is registered in api-lambda-main.ts but not documented in docs/API.md`,
            );
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all registered routes are documented (exhaustive check)', () => {
    const undocumentedRoutes: string[] = [];

    for (const route of registeredRoutes) {
      const methodInDoc = apiDocContent.includes(route.method);
      const pathInDoc = apiDocContent.includes(route.path);
      const routeTableEntry = apiDocContent.includes(`| ${route.method}`) && apiDocContent.includes(route.path);
      const routeHeading = apiDocContent.includes(`${route.method} ${route.path}`);

      const isDocumented = methodInDoc && pathInDoc && (routeTableEntry || routeHeading);

      if (!isDocumented) {
        undocumentedRoutes.push(`${route.method} ${route.path} (${route.type})`);
      }
    }

    expect(undocumentedRoutes, `Undocumented routes found:\n${undocumentedRoutes.join('\n')}`).toHaveLength(0);
  });
});
