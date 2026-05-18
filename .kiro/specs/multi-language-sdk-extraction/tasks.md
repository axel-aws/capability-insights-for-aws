# Implementation Plan: Multi-Language SDK Extraction

## Overview

This plan implements Java, Python, and TypeScript/JavaScript SDK parsers for the repository analyzer, following the same architectural pattern as the existing Go parser (`parseResourceGoFile`). Each parser is a standalone module with regex-based extraction, PascalCase normalization, and sorted/deduplicated output. The repository analyzer is updated with multi-language file classification, exclusion rules, concurrent fetching, timeout handling, and partial result support.

## Tasks

- [x] 1. Implement Java SDK Parser
  - [x] 1.1 Create `source/lambda/services/infrastructure-planning/parsers/java-sdk-parser.ts`
    - Implement `parseJavaFile(content: string): string[]` function
    - Regex pattern: `/(?:\w*Client)\.(\w+)\(/g` to capture method names on variables/classes ending with `Client`
    - Implement `camelToPascal` normalization (uppercase first letter)
    - Implement exclusion list: `create`, `builder`, `build`, `close`, `serviceClientConfiguration`, `serviceName`, `waiter`, and methods < 3 characters
    - Return sorted, deduplicated array of PascalCase operation names
    - Handle empty/whitespace input by returning `[]`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 7.1, 7.4, 7.5_

  - [x] 1.2 Write property tests for Java SDK parser
    - Create `source/lambda/services/infrastructure-planning/parsers/java-sdk-parser.property.test.ts`
    - **Property 1: Java SDK pattern extraction** — For any content with `I.M(` where I ends in `Client` and M is valid, normalized M appears in output
    - **Validates: Requirements 1.2, 1.3**
    - **Property 5: Normalization to PascalCase** — All output strings start with uppercase and contain only ASCII letters
    - **Validates: Requirements 6.1, 1.4**
    - **Property 6: Normalization idempotence** — Applying camelToPascal to already-PascalCase strings returns them unchanged
    - **Validates: Requirements 6.4**
    - **Property 8: Output format invariant** — Output is sorted, deduplicated, and all entries are valid PascalCase
    - **Validates: Requirements 7.4, 1.6**
    - **Property 9: Parser determinism** — Same input always produces same output
    - **Validates: Requirements 7.6**
    - Use `fast-check` with minimum 100 iterations per property

  - [x] 1.3 Write unit tests for Java SDK parser
    - Create `source/lambda/services/infrastructure-planning/parsers/java-sdk-parser.test.ts`
    - Test real-world Java SDK v2 patterns (e.g., `s3Client.putObject(`, `DynamoDbClient.getItem(`)
    - Test exclusion list filtering (each excluded method)
    - Test edge cases: empty input, whitespace-only, no matches, very long lines
    - Test camelCase → PascalCase conversion examples
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 2. Implement Python SDK Parser
  - [x] 2.1 Create `source/lambda/services/infrastructure-planning/parsers/python-sdk-parser.ts`
    - Implement `parsePythonFile(content: string): string[]` function
    - Regex pattern: `/(?:\w*(?:client|resource)|conn|svc)\.(\w+)\(/g` to capture method names
    - Implement `snakeToPascal` normalization (split on `_`, capitalize each segment, join)
    - Implement exclusion list: `get_paginator`, `get_waiter`, `can_paginate`, `generate_presigned_url`, `generate_presigned_post`, methods starting with `_`, and methods < 3 characters after conversion
    - Return sorted, deduplicated array of PascalCase operation names
    - Handle empty/whitespace input by returning `[]`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 7.2, 7.4, 7.5_

  - [x] 2.2 Write property tests for Python SDK parser
    - Create `source/lambda/services/infrastructure-planning/parsers/python-sdk-parser.property.test.ts`
    - **Property 2: Python boto3 pattern extraction** — For any content with `I.M(` where I matches pattern and M is valid, normalized M appears in output
    - **Validates: Requirements 2.2, 2.3**
    - **Property 5: Normalization to PascalCase** — All output strings start with uppercase and contain only ASCII letters
    - **Validates: Requirements 6.1, 2.4**
    - **Property 6: Normalization idempotence** — Applying snakeToPascal to already-PascalCase strings returns them unchanged
    - **Validates: Requirements 6.4**
    - **Property 8: Output format invariant** — Output is sorted, deduplicated, and all entries are valid PascalCase
    - **Validates: Requirements 7.4, 2.6**
    - **Property 9: Parser determinism** — Same input always produces same output
    - **Validates: Requirements 7.6**
    - Use `fast-check` with minimum 100 iterations per property

  - [x] 2.3 Write unit tests for Python SDK parser
    - Create `source/lambda/services/infrastructure-planning/parsers/python-sdk-parser.test.ts`
    - Test real-world boto3 patterns (e.g., `s3_client.put_object(`, `conn.describe_instances(`)
    - Test resource patterns (e.g., `s3_resource.Object(`)
    - Test exclusion list filtering (each excluded method)
    - Test edge cases: empty input, whitespace-only, no matches, underscore-prefixed methods
    - Test snake_case → PascalCase conversion examples
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 3. Implement TypeScript/JavaScript SDK Parser
  - [x] 3.1 Create `source/lambda/services/infrastructure-planning/parsers/typescript-sdk-parser.ts`
    - Implement `parseTypeScriptFile(content: string): string[]` function
    - Regex for v3 Command pattern: `/new\s+([A-Z][a-zA-Z]+)Command\s*\(/g` to capture operation name
    - Regex for v2-style calls: `/(?:s3|dynamodb|dynamoDb|lambda|sqs|sns|ec2|iam|sts|cloudwatch|cloudformation|kinesis|stepfunctions)(?:Client|client)?\.(\w+)\(/g`
    - Implement `stripCommandSuffix` for v3 names and `camelToPascal` for v2 names
    - Filter out: bare `Command` without prefix, `import`/`require` lines, type annotations, methods < 3 characters
    - Return sorted, deduplicated array of PascalCase operation names
    - Handle empty/whitespace input by returning `[]`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.3, 7.4, 7.5_

  - [x] 3.2 Write property tests for TypeScript/JavaScript SDK parser
    - Create `source/lambda/services/infrastructure-planning/parsers/typescript-sdk-parser.property.test.ts`
    - **Property 3: TypeScript v3 Command pattern extraction** — For any content with `new {Op}Command(` where Op is valid PascalCase ≥ 2 chars, Op appears in output
    - **Validates: Requirements 3.2, 3.3**
    - **Property 4: TypeScript v2-style extraction** — For any content with known service prefix variable calling a method, normalized method appears in output
    - **Validates: Requirements 3.4**
    - **Property 5: Normalization to PascalCase** — All output strings start with uppercase and contain only ASCII letters
    - **Validates: Requirements 6.1**
    - **Property 6: Normalization idempotence** — Applying normalization to already-PascalCase strings returns them unchanged
    - **Validates: Requirements 6.4**
    - **Property 8: Output format invariant** — Output is sorted, deduplicated, and all entries are valid PascalCase
    - **Validates: Requirements 7.4, 3.6**
    - **Property 9: Parser determinism** — Same input always produces same output
    - **Validates: Requirements 7.6**
    - Use `fast-check` with minimum 100 iterations per property

  - [x] 3.3 Write unit tests for TypeScript/JavaScript SDK parser
    - Create `source/lambda/services/infrastructure-planning/parsers/typescript-sdk-parser.test.ts`
    - Test v3 Command patterns (e.g., `new PutObjectCommand(`, `client.send(new GetItemCommand(`)
    - Test v2-style patterns (e.g., `s3Client.putObject(`, `dynamodb.getItem(`)
    - Test exclusion filtering (import lines, type annotations, bare Command)
    - Test edge cases: empty input, whitespace-only, no matches
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 4. Checkpoint - Verify all parsers pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update CapabilitySet type for partial result support
  - [x] 5.1 Update `source/shared/types/infrastructure-planning/plan-configuration.ts`
    - Add optional `partialResult` field to `CapabilitySet` interface with shape: `{ isPartial: boolean; filesProcessed: number; totalFilesIdentified: number; }`
    - Update the `apiOperations` JSDoc comment to reflect multi-language extraction (not just Go)
    - _Requirements: 5.3_

- [x] 6. Update Repository Analyzer with multi-language support
  - [x] 6.1 Add file classification and exclusion logic to `source/lambda/services/infrastructure-planning/parsers/repository-analyzer.ts`
    - Extend `classifyFile` function to return `'java' | 'python' | 'typescript'` in addition to existing types
    - Implement `shouldExcludeFile(path: string): boolean` function with test directory exclusions (`test`, `tests`, `__tests__`, `spec`) and vendor directory exclusions (`vendor`, `node_modules`, `.venv`, `site-packages`, `__pycache__`, `target/dependency`, `build/classes`)
    - Implement test file pattern exclusions (`*_test.*`, `*.test.*`, `*.spec.*`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7_

  - [x] 6.2 Add concurrent fetching with timeout handling to repository analyzer
    - Implement concurrency-limited file fetching (max 15 simultaneous requests)
    - Add elapsed time tracking with 50-second cutoff
    - Implement language priority ordering: Go → Java → Python → TypeScript/JavaScript
    - When timeout occurs, assemble partial CapabilitySet from results collected so far
    - Set `partialResult` flag with `filesProcessed` and `totalFilesIdentified` counts
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 6.3 Integrate new parsers into the repository analyzer processing loop
    - Import `parseJavaFile`, `parsePythonFile`, `parseTypeScriptFile` from their respective modules
    - Route classified files to appropriate parsers based on extension
    - Aggregate all extracted operations into a single `apiOperations` set
    - Deduplicate across all languages by comparing post-normalization PascalCase strings
    - Handle individual file fetch/parse failures gracefully (skip and continue)
    - _Requirements: 4.6, 6.2, 6.3, 7.7_

  - [x] 6.4 Write property tests for repository analyzer updates
    - Update or create `source/lambda/services/infrastructure-planning/parsers/repository-analyzer.property.test.ts`
    - **Property 7: Cross-language deduplication** — Operations normalizing to the same PascalCase string appear exactly once in output
    - **Validates: Requirements 6.3**
    - **Property 10: File classification by extension** — `.java` → java, `.py` → python, `.ts`/`.js` → typescript, `.go` → go
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - **Property 11: Test and vendor directory exclusion** — Paths with excluded segments return true; paths without return false
    - **Validates: Requirements 4.4, 4.5**
    - Use `fast-check` with minimum 100 iterations per property

  - [x] 6.5 Write unit tests for repository analyzer updates
    - Update `source/lambda/services/infrastructure-planning/parsers/repository-analyzer.test.ts`
    - Test file classification for each supported extension
    - Test exclusion rules with specific test/vendor directory paths
    - Test timeout behavior with mocked timing (verify cutoff at 50s)
    - Test partial result flag and counts when timeout occurs
    - Test language priority ordering (Go > Java > Python > TS/JS)
    - Test cross-language deduplication (same operation from multiple languages → single entry)
    - Test mixed-language repository aggregation
    - _Requirements: 4.1–4.7, 5.1–5.5, 6.2, 6.3_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (11 properties total)
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript, matching the existing codebase and design document
- All new parser modules follow the same pattern as the existing `parseResourceGoFile` in `classic-resource-parser.ts`
- The `fast-check` library is already available in devDependencies for property-based testing

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "2.3", "3.2", "3.3"] },
    { "id": 2, "tasks": ["6.1"] },
    { "id": 3, "tasks": ["6.2"] },
    { "id": 4, "tasks": ["6.3"] },
    { "id": 5, "tasks": ["6.4", "6.5"] }
  ]
}
```
