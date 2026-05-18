# Requirements Document

## Introduction

Multi-Language SDK Extraction extends the GitHub Repository Analyzer in the Infrastructure Planning feature to extract AWS SDK API operations from Java, Python, and TypeScript/JavaScript source files, in addition to the existing Go support. Currently, only Go SDK client method calls are captured when analyzing a repository. By adding support for these additional languages, the system maximizes the value of the API Operations page filter by capturing a more complete picture of AWS API usage across polyglot repositories.

The extracted operations follow the existing `service:OperationName` format and feed into the `CapabilitySet.apiOperations` field, which powers the plan filter on the API Operations tab.

## Glossary

- **Repository_Analyzer**: The component at `source/lambda/services/infrastructure-planning/parsers/repository-analyzer.ts` that analyzes GitHub repositories to extract AWS resource types and API operations from source files.
- **SDK_Parser**: A language-specific parser module that extracts AWS SDK API operation names from source file content using regex pattern matching.
- **Go_SDK_Parser**: The existing parser (reusing `parseResourceGoFile`) that matches patterns like `conn.Method(`, `client.Method(`, `svc.Method(` in Go source files.
- **Java_SDK_Parser**: A new parser that extracts AWS SDK for Java v2 client method calls from `.java` source files.
- **Python_SDK_Parser**: A new parser that extracts boto3 client and resource method calls from `.py` source files.
- **TypeScript_SDK_Parser**: A new parser that extracts AWS SDK for JavaScript/TypeScript v3 Command pattern calls from `.ts` and `.js` source files.
- **API_Operation**: A string in the format `service:OperationName` representing a single AWS API call (e.g., `s3:PutObject`, `dynamodb:GetItem`).
- **CapabilitySet**: The data structure containing extracted resource types, API operations, and service names from an Infrastructure Plan.
- **Service_Client_Pattern**: A language-specific code pattern that indicates an AWS SDK client is being used to call an API operation.

## Requirements

### Requirement 1: Java AWS SDK v2 API Extraction

**User Story:** As a dashboard user, I want the repository analyzer to extract AWS API operations from Java source files using the AWS SDK for Java v2, so that Java-based repositories contribute to the API Operations filter.

#### Acceptance Criteria

1. WHEN a `.java` file is found in the repository, THE Java_SDK_Parser SHALL scan the file content for AWS SDK for Java v2 client method call patterns.
2. WHEN a Java file contains a method call matching the pattern `{clientVariable}.{methodName}(`, where the client variable name ends with `Client` (e.g., `s3Client`, `dynamoDbClient`, `lambdaClient`), THE Java_SDK_Parser SHALL extract `methodName` as an API operation name.
3. WHEN a Java file contains a method call matching the pattern `{ClientClassName}.{methodName}(`, where the class name ends with `Client` (e.g., `S3Client.putObject(`, `DynamoDbClient.getItem(`), THE Java_SDK_Parser SHALL extract `methodName` as an API operation name.
4. THE Java_SDK_Parser SHALL convert extracted method names from camelCase to PascalCase for the operation name by uppercasing the first character of each camel-case segment (e.g., `putObject` becomes `PutObject`, `getItem` becomes `GetItem`, `createBucket` becomes `CreateBucket`).
5. THE Java_SDK_Parser SHALL filter out non-API utility methods by excluding exactly the following method names: `create`, `builder`, `build`, `close`, `serviceClientConfiguration`, `serviceName`, and `waiter`, as well as any method name shorter than 3 characters.
6. THE Java_SDK_Parser SHALL return a deduplicated list of extracted operation names sorted in ascending lexicographic order. IF all extracted operations are filtered out by the utility method exclusions or minimum length rule, THE Java_SDK_Parser SHALL return an empty list.
7. WHEN a Java file contains no matching SDK client method call patterns, THE Java_SDK_Parser SHALL return an empty list.
8. IF the input file content is empty or contains only whitespace, THEN THE Java_SDK_Parser SHALL return an empty list without throwing an error.

### Requirement 2: Python boto3 API Extraction

**User Story:** As a dashboard user, I want the repository analyzer to extract AWS API operations from Python source files using boto3, so that Python-based repositories contribute to the API Operations filter.

#### Acceptance Criteria

1. WHEN a `.py` file is found in the repository, THE Python_SDK_Parser SHALL scan the file content for boto3 client and resource method call patterns.
2. WHEN a Python file contains a method call matching the pattern `{identifier}.{method_name}(` where `{identifier}` is any Python identifier ending with `client` (e.g., `client`, `s3_client`, `my_client`) or is exactly `conn` or `svc`, THE Python_SDK_Parser SHALL extract `method_name` as an API operation name.
3. WHEN a Python file contains a method call matching the pattern `{identifier}.{method_name}(` where `{identifier}` is any Python identifier ending with `resource` (e.g., `resource`, `s3_resource`, `my_resource`), THE Python_SDK_Parser SHALL extract `method_name` as an API operation name.
4. THE Python_SDK_Parser SHALL convert extracted method names from snake_case to PascalCase for the operation name by capitalizing the first letter of each underscore-separated segment and removing underscores (e.g., `put_object` becomes `PutObject`, `get_item` becomes `GetItem`, `list_objects_v2` becomes `ListObjectsV2`).
5. THE Python_SDK_Parser SHALL filter out common non-API utility methods including `get_paginator`, `get_waiter`, `can_paginate`, `generate_presigned_url`, `generate_presigned_post`, and methods starting with underscore. Additionally, extracted method names SHOULD correspond to known AWS SDK operations for the target language; however, the parser SHALL NOT reject methods solely based on an allowlist — filtering is limited to the explicit exclusion list.
6. THE Python_SDK_Parser SHALL return a deduplicated list of extracted operation names sorted in ascending alphabetical order.
7. WHEN a Python file contains no matching boto3 method call patterns, THE Python_SDK_Parser SHALL return an empty list.
8. IF a Python file contains method names that are fewer than 3 characters after conversion, THEN THE Python_SDK_Parser SHALL exclude those method names from the result.

### Requirement 3: TypeScript/JavaScript AWS SDK v3 API Extraction

**User Story:** As a dashboard user, I want the repository analyzer to extract AWS API operations from TypeScript and JavaScript source files using the AWS SDK for JavaScript v3, so that TypeScript/JavaScript-based repositories contribute to the API Operations filter.

#### Acceptance Criteria

1. WHEN a `.ts` or `.js` file is found in the repository, THE TypeScript_SDK_Parser SHALL scan the file content for AWS SDK for JavaScript v3 Command pattern calls and v2-style SDK client method calls.
2. WHEN a TypeScript/JavaScript file contains a pattern matching `new {OperationName}Command(` where `OperationName` is one or more PascalCase words of at least 2 characters (e.g., `new PutObjectCommand(`, `new GetItemCommand(`), THE TypeScript_SDK_Parser SHALL extract `OperationName` as an API operation name. IF the operation name cannot be successfully parsed from the pattern, THE TypeScript_SDK_Parser SHALL skip that match and continue processing other patterns in the file.
3. WHEN a TypeScript/JavaScript file contains a pattern matching `client.send(new {OperationName}Command(`, THE TypeScript_SDK_Parser SHALL extract `OperationName` as an API operation name.
4. THE TypeScript_SDK_Parser SHALL detect v2-style calls matching `{clientVariable}.{methodName}(` where the variable name matches a known service prefix (`s3`, `dynamodb`, `dynamoDb`, `lambda`, `sqs`, `sns`, `ec2`, `iam`, `sts`, `cloudwatch`, `cloudformation`, `kinesis`, `stepfunctions`) optionally followed by a suffix of `Client` or `client` (e.g., `s3Client.putObject(`, `dynamodb.getItem(`).
5. THE TypeScript_SDK_Parser SHALL filter out the following non-API patterns: the word `Command` appearing without an operation name prefix, `import` and `require` statements, type annotations and interface declarations (lines containing `: typeof` or `as` type casts referencing Command classes), and method names shorter than 3 characters.
6. THE TypeScript_SDK_Parser SHALL return a deduplicated list of extracted operation names sorted in ascending alphabetical order.
7. WHEN a TypeScript/JavaScript file contains no matching SDK patterns, THE TypeScript_SDK_Parser SHALL return an empty list.

### Requirement 4: Repository Analyzer Multi-Language File Classification

**User Story:** As a developer, I want the repository analyzer to classify and route Java, Python, and TypeScript/JavaScript files to their respective parsers, so that all supported languages are processed during repository analysis.

#### Acceptance Criteria

1. WHEN the repository file tree is retrieved, THE Repository_Analyzer SHALL classify files with `.java` extension as Java SDK source files.
2. WHEN the repository file tree is retrieved, THE Repository_Analyzer SHALL classify files with `.py` extension as Python SDK source files.
3. WHEN the repository file tree is retrieved, THE Repository_Analyzer SHALL classify files with `.ts` or `.js` extension as TypeScript/JavaScript SDK source files.
4. THE Repository_Analyzer SHALL first classify all files by extension to determine their language type, THEN apply exclusion rules. Files whose path contains any directory segment exactly matching one of: `test`, `tests`, `__tests__`, `spec`, or whose filename matches the patterns `*_test.*`, `*.test.*`, or `*.spec.*` SHALL be excluded from processing. This exclusion SHALL take precedence over extension-based classification (a `.java` file inside a `test/` directory at any depth SHALL be skipped even though it was classified as Java).
5. THE Repository_Analyzer SHALL skip files whose path contains any directory segment exactly matching one of: `vendor`, `node_modules`, `.venv`, `site-packages`, `__pycache__`, `target/dependency`, `build/classes`. This is an exhaustive list; files in unlisted directories SHALL be processed normally.
6. THE Repository_Analyzer SHALL process files from all supported languages (Go, Java, Python, TypeScript/JavaScript) in a single analysis pass and aggregate all extracted API operations into the same `CapabilitySet.apiOperations` field.
7. WHEN a file's extension does not match any supported language (`.go`, `.java`, `.py`, `.ts`, `.js`) and is not a CloudFormation template or Terraform file, THE Repository_Analyzer SHALL skip the file without error. IF a file has a supported extension (e.g., `.java`) but is identified as a CloudFormation template or Terraform configuration based on content inspection, THE Repository_Analyzer SHALL treat it as CloudFormation/Terraform and skip SDK extraction for that file.

### Requirement 5: Performance Within Lambda Timeout

**User Story:** As a developer, I want the multi-language extraction to complete within the Lambda timeout, so that repository analysis remains reliable for large repositories.

#### Acceptance Criteria

1. THE Repository_Analyzer SHALL process all supported file types within the existing 60-second Lambda timeout for repositories containing up to 10,000 source files.
2. WHEN the number of files to process exceeds 500 files, THE Repository_Analyzer SHALL prioritize files by language in the following order: Go, Java, Python, TypeScript/JavaScript, and SHALL stop processing additional files if the elapsed time exceeds 50 seconds (leaving a 10-second buffer for response handling).
3. IF the analysis is terminated early due to timeout constraints, THEN THE Repository_Analyzer SHALL return a partial CapabilitySet containing all operations extracted before the cutoff, SHALL include a boolean flag indicating the result is partial along with the count of files processed and total files identified, and SHALL NOT return an error.
4. THE Repository_Analyzer SHALL fetch file contents concurrently with a maximum concurrency of 15 simultaneous requests to avoid GitHub API rate limiting and maximize throughput within the timeout window.
5. IF the elapsed processing time exceeds 50 seconds while a file is being fetched or parsed, THEN THE Repository_Analyzer SHALL abandon processing of remaining files and proceed directly to assembling the partial CapabilitySet from results collected so far.

### Requirement 6: Operation Name Normalization

**User Story:** As a developer, I want all extracted API operation names normalized to a consistent format regardless of source language, so that the API Operations filter works uniformly across languages.

#### Acceptance Criteria

1. THE SDK_Parser modules SHALL normalize all extracted operation names to PascalCase format by applying the following language-specific rules: Go names (already PascalCase) are kept unchanged, Java camelCase names have their first letter capitalized, Python snake_case names are split on underscores with each segment capitalized and joined, and TypeScript names have the `Command` suffix removed if present (e.g., `PutObject`, `GetItem`, `CreateBucket`).
2. WHEN a Go file yields operation name `CreateBucket`, a Java file yields `createBucket`, a Python file yields `create_bucket`, and a TypeScript file yields `CreateBucketCommand`, THE Repository_Analyzer SHALL produce a single deduplicated entry `CreateBucket` in the CapabilitySet.
3. THE Repository_Analyzer SHALL deduplicate API operations across all languages by comparing post-normalization PascalCase strings for equality, ensuring that the same logical operation extracted from multiple languages appears only once in the final CapabilitySet.
4. THE SDK_Parser modules SHALL ensure that applying the normalization function to any already-normalized PascalCase operation name (containing only ASCII letters, each word segment starting with an uppercase letter) produces the same string unchanged (idempotence property). This guarantee applies only to inputs already in valid PascalCase format; arbitrary inputs may not be idempotent.
5. IF an extracted operation name contains only non-alphabetic characters or results in an empty string after normalization, THEN THE SDK_Parser modules SHALL discard that name and not include it in the CapabilitySet.

### Requirement 7: Parser Module Architecture

**User Story:** As a developer, I want each language parser to be a separate, testable module, so that parsers can be maintained and extended independently.

#### Acceptance Criteria

1. THE Java_SDK_Parser SHALL be implemented as a standalone module at `source/lambda/services/infrastructure-planning/parsers/java-sdk-parser.ts` exporting a `parseJavaFile(content: string): string[]` function.
2. THE Python_SDK_Parser SHALL be implemented as a standalone module at `source/lambda/services/infrastructure-planning/parsers/python-sdk-parser.ts` exporting a `parsePythonFile(content: string): string[]` function.
3. THE TypeScript_SDK_Parser SHALL be implemented as a standalone module at `source/lambda/services/infrastructure-planning/parsers/typescript-sdk-parser.ts` exporting a `parseTypeScriptFile(content: string): string[]` function.
4. EACH SDK_Parser module SHALL accept a file content string of up to 1MB as input and return an array of unique PascalCase operation name strings sorted in lexicographic ascending order (case-sensitive Unicode code point order).
5. IF the input string is empty, contains only whitespace characters, or contains no recognizable SDK client method call patterns, THEN THE SDK_Parser module SHALL return an empty array without throwing an error.
6. FOR ALL valid source file content strings (any string of up to 1MB that does not cause the module to throw), parsing SHALL produce a stable (deterministic) output such that invoking the same parser function twice with identical input always yields the same array in the same order.
7. EACH SDK_Parser module SHALL have no import dependencies on other SDK_Parser modules, ensuring each parser can be independently imported, tested, and maintained without requiring the presence of the other parsers.
