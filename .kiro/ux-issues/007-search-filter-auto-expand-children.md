# Filtered services don't auto-expand to show child features

**Severity:** Medium
**Category:** Feature Request
**Page:** / (Capabilities by Region)
**Component:** source/website/app/pages/capability-by-region.tsx

## Problem

When filtering to a specific service (e.g., selecting "Name = Amazon Simple Storage Service (S3)" from the filter suggestions), the result shows "Services and features (1)" and the service row remains collapsed. The user must manually click "Expand all" to see the 30+ child features underneath S3.

This creates two problems:
1. The "(1)" counter is misleading. It implies you only got 1 result, when in reality you have 1 service with 30+ features. Users may think the filter is too restrictive.
2. If you explicitly filtered to a single service, you almost certainly want to see its features. Requiring a second click to expand defeats the purpose of filtering.

## Screenshot

See artifacts/s3_expanded_filtered.png (shows the expanded state users expect to see immediately)

## Fix Instructions

1. In the table component logic, after applying a PropertyFilter that results in a small number of matched services (e.g., 5 or fewer), automatically set the expanded state for all matched rows to `true`

2. Update the header counter to show both the service count and feature count when features exist:
   - Current: "Services and features (1)"
   - Improved: "Services and features (1 service, 30 features)" or "1 service with 30 features"

3. Implementation approach:
   - In the collection hooks or table state, after filter application, check `filteredItems.length`
   - If `filteredItems.length <= 5`, set `expandedItems` to include all filtered item IDs
   - If `filteredItems.length > 5`, keep the existing collapsed default behavior
   - This avoids performance issues from auto-expanding 160 services

4. Ensure the "Collapse all" / "Expand all" toggle still works as manual override

**Acceptance Criteria:**
- [ ] Filtering to 5 or fewer services automatically expands them to show child features
- [ ] The header counter communicates total features visible, not just parent service count
- [ ] Users see the full picture immediately after filtering without needing a second click
- [ ] Filtering to many results (>5 services) keeps the default collapsed behavior
- [ ] Manual "Expand all" / "Collapse all" still works as expected
