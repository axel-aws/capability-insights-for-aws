# Design Document: Secrets Manager PAT Storage

## Overview

This design migrates GitHub Personal Access Token (PAT) storage from plaintext in DynamoDB to AWS Secrets Manager. The change introduces a new `GitHubTokenStore` service class that encapsulates all Secrets Manager operations, a VPC endpoint so the API Lambda (running in a private subnet) can reach Secrets Manager, and IAM policy updates granting least-privilege access to both Lambda functions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CDK Stack                                 │
│                                                                  │
│  ┌──────────────┐   ┌──────────────────────┐                   │
│  │ CfnSecret    │   │ VPC Endpoint         │                   │
│  │ GitHubPAT-   │   │ secretsmanager       │                   │
│  │ {Region}     │   │ (private subnet)     │                   │
│  └──────┬───────┘   └──────────┬───────────┘                   │
│         │                      │                                 │
│  ┌──────┴──────────────────────┴───────────────────────┐        │
│  │              Secrets Manager Service                  │        │
│  └──────┬──────────────────────────────────┬───────────┘        │
│         │                                  │                     │
│  ┌──────┴───────────┐          ┌───────────┴──────────┐        │
│  │ API Lambda       │          │ Data-Fetch Lambda     │        │
│  │ (VPC private)    │          │ (no VPC)              │        │
│  │ Get/Put Secret   │          │ Get Secret            │        │
│  └──────────────────┘          └──────────────────────┘        │
│                                                                  │
│  ┌──────────────────┐                                           │
│  │ DynamoDB         │  ← No longer stores githubToken           │
│  │ PolicyConfig     │  ← Retains: toggles, dataSyncEnabled,    │
│  │                  │    updatedAt                               │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Token Write (PUT /syncSettings with token):** API Lambda → `GitHubTokenStore.putToken()` → Secrets Manager
2. **Token Presence Check (GET /syncSettings):** API Lambda → `GitHubTokenStore.hasToken()` → Secrets Manager → returns boolean
3. **Token Read (plan-routes / getGitHubPat):** API Lambda → `GitHubTokenStore.getToken()` → Secrets Manager → returns token string
4. **Token Read (data-fetch):** Data-Fetch Lambda → `GitHubTokenStore.getToken()` → Secrets Manager → passes token in overlay invocation payload
5. **Token Delete (PUT /syncSettings with overlay disabled):** API Lambda → `GitHubTokenStore.deleteToken()` → Secrets Manager

## Components

### 1. CDK Infrastructure (`capability-insights-stack.ts`)

#### New Resources

| Resource       | Type                          | Purpose                                                 |
| -------------- | ----------------------------- | ------------------------------------------------------- |
| `CfnSecret`    | `AWS::SecretsManager::Secret` | Stores the GitHub PAT encrypted at rest                 |
| VPC Endpoint   | `AWS::EC2::VPCEndpoint`       | Private connectivity from API Lambda to Secrets Manager |
| Security Group | `AWS::EC2::SecurityGroup`     | Controls inbound HTTPS to the VPC endpoint              |

#### Secret Definition

```typescript
const secretName = `${prefix}GitHubPAT`;
const githubPatSecret = new secretsmanager.CfnSecret(this, secretName, {
  name: cdk.Fn.sub(`${secretName}-\${AWS::Region}`),
  description: 'GitHub Personal Access Token for Terraform overlay',
});
githubPatSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
```

#### VPC Endpoint

```typescript
const secretsManagerSecurityGroup = new ec2.CfnSecurityGroup(this, `${prefix}SecretsManagerVpceSg`, {
  groupDescription: 'Security group for Secrets Manager VPC endpoint',
  vpcId: vpcIdParameter.valueAsString,
  securityGroupIngress: [
    {
      ipProtocol: 'tcp',
      fromPort: 443,
      toPort: 443,
      sourceSecurityGroupId: apiLambdaSecurityGroup.ref,
    },
  ],
});

new ec2.CfnVPCEndpoint(this, `${prefix}SecretsManagerVpcEndpoint`, {
  vpcId: vpcIdParameter.valueAsString,
  vpcEndpointType: 'Interface',
  serviceName: cdk.Fn.sub('com.amazonaws.${AWS::Region}.secretsmanager'),
  privateDnsEnabled: true,
  subnetIds: [privateSubnetIdParameter.valueAsString],
  securityGroupIds: [secretsManagerSecurityGroup.ref],
  tags: [{ key: 'Name', value: `${prefix}SecretsManagerVpcEndpoint` }],
});
```

#### IAM Policies

**API Lambda** — added policy:

```typescript
{
  policyName: 'SecretsManagerAccess',
  policyDocument: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue'],
        Resource: cdk.Fn.getAtt(githubPatSecret.logicalId, 'Id'),
      },
    ],
  },
}
```

**Data-Fetch Lambda** — added policy:

```typescript
{
  policyName: 'SecretsManagerReadAccess',
  policyDocument: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'secretsmanager:GetSecretValue',
        Resource: cdk.Fn.getAtt(githubPatSecret.logicalId, 'Id'),
      },
    ],
  },
}
```

#### Environment Variables

Both Lambda functions receive a new environment variable:

```typescript
GITHUB_TOKEN_SECRET_NAME: cdk.Fn.ref(githubPatSecret.logicalId),
```

### 2. GitHubTokenStore Service (`source/lambda/services/github-token-store.ts`)

New service class encapsulating all Secrets Manager interactions.

```typescript
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { logger } from '../util/logger';

export class GitHubTokenStore {
  private client: SecretsManagerClient;

  constructor(private secretName: string) {
    this.client = new SecretsManagerClient({});
  }

  /** Retrieve the stored GitHub PAT. Returns undefined if no value exists. */
  async getToken(): Promise<string | undefined> {
    try {
      const result = await this.client.send(new GetSecretValueCommand({ SecretId: this.secretName }));
      return result.SecretString || undefined;
    } catch (error: unknown) {
      if (error instanceof ResourceNotFoundException) {
        return undefined;
      }
      logger.error('Failed to retrieve GitHub token from Secrets Manager', {
        error: String(error),
      });
      throw error;
    }
  }

  /** Check whether a token value exists in Secrets Manager. */
  async hasToken(): Promise<boolean> {
    const token = await this.getToken();
    return token !== undefined && token.length > 0;
  }

  /** Store a GitHub PAT in Secrets Manager. */
  async putToken(token: string): Promise<void> {
    await this.client.send(
      new PutSecretValueCommand({
        SecretId: this.secretName,
        SecretString: token,
      }),
    );
    logger.info('Stored GitHub token in Secrets Manager');
  }

  /** Delete the secret value by writing an empty string. */
  async deleteToken(): Promise<void> {
    await this.client.send(
      new PutSecretValueCommand({
        SecretId: this.secretName,
        SecretString: '',
      }),
    );
    logger.info('Cleared GitHub token from Secrets Manager');
  }
}
```

### 3. Updated SyncSettingsStore (`source/lambda/services/sync-settings-store.ts`)

The `githubToken` field is removed from the interface and all DynamoDB operations.

```typescript
export interface SyncSettings {
  terraformOverlayEnabled: boolean;
  dataSyncEnabled: boolean;
  updatedAt: string;
}

export interface SyncSettingsResponse {
  terraformOverlayEnabled: boolean;
  hasToken: boolean;
  dataSyncEnabled: boolean;
  updatedAt: string;
}
```

The `updateSettings` method no longer accepts or writes `githubToken`. The `getSettings` method no longer reads or returns `githubToken`.

### 4. Updated Sync Settings Routes (`source/lambda/routes/sync-settings-routes.ts`)

#### GET /syncSettings

```typescript
export async function getSyncSettingsRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = getEnv(EnvironmentKey.POLICY_TABLE_NAME);
  const secretName = getEnv(EnvironmentKey.GITHUB_TOKEN_SECRET_NAME);

  const store = new SyncSettingsStore(tableName);
  const tokenStore = new GitHubTokenStore(secretName);

  const settings = await store.getSettings();
  const hasToken = await tokenStore.hasToken();

  return buildResponse(StatusCode.OK, {
    terraformOverlayEnabled: settings.terraformOverlayEnabled,
    hasToken,
    dataSyncEnabled: settings.dataSyncEnabled,
    updatedAt: settings.updatedAt,
  });
}
```

#### PUT /syncSettings

```typescript
export async function putSyncSettingsRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // ... validation ...

  const tokenStore = new GitHubTokenStore(secretName);

  // If enabling with a token provided, store it
  if (body.terraformOverlayEnabled && body.githubToken) {
    await tokenStore.putToken(body.githubToken);
  }

  // If enabling without a token, verify one exists
  if (body.terraformOverlayEnabled && !body.githubToken) {
    const exists = await tokenStore.hasToken();
    if (!exists) {
      return buildResponse(StatusCode.BAD_REQUEST, {
        error: 'GitHub token is required when enabling Terraform overlay',
      });
    }
  }

  // If disabling, clear the token
  if (!body.terraformOverlayEnabled) {
    await tokenStore.deleteToken();
  }

  // Update DynamoDB (without token)
  const updated = await store.updateSettings({
    terraformOverlayEnabled: body.terraformOverlayEnabled,
    dataSyncEnabled: body.dataSyncEnabled,
  });

  const hasToken = await tokenStore.hasToken();
  return buildResponse(StatusCode.OK, {
    terraformOverlayEnabled: updated.terraformOverlayEnabled,
    hasToken,
    dataSyncEnabled: updated.dataSyncEnabled,
    updatedAt: updated.updatedAt,
  });
}
```

### 5. Updated Plan Routes (`source/lambda/routes/plan-routes.ts`)

```typescript
async function getGitHubPat(): Promise<string> {
  const secretName = getEnv(EnvironmentKey.GITHUB_TOKEN_SECRET_NAME);
  const tokenStore = new GitHubTokenStore(secretName);
  const token = await tokenStore.getToken();
  if (!token) {
    throw new Error('GitHub token not configured. Add a token in Settings.');
  }
  return token;
}
```

### 6. Updated Data-Fetch Lambda (`source/lambda/data-fetch-lambda-main.ts`)

```typescript
// Replace DynamoDB token read with Secrets Manager
import { GitHubTokenStore } from './services/github-token-store';

// In the overlay section:
const secretName = getEnv(EnvironmentKey.GITHUB_TOKEN_SECRET_NAME);
const tokenStore = new GitHubTokenStore(secretName);
const settingsStore = new SyncSettingsStore(getEnv(EnvironmentKey.POLICY_TABLE_NAME));
const settings = await settingsStore.getSettings();

if (settings.terraformOverlayEnabled) {
  try {
    const githubToken = await tokenStore.getToken();
    if (githubToken) {
      shouldInvokeOverlay = true;
      // Pass token to overlay Lambda via payload
    }
  } catch (e) {
    logger.error('Failed to retrieve GitHub token from Secrets Manager', { error: String(e) });
    terraformOverlaySkipped = true;
  }
}
```

### 7. Environment Key Addition

```typescript
// In source/lambda/constants/environment.ts
export const EnvironmentKey = {
  // ... existing keys ...
  GITHUB_TOKEN_SECRET_NAME: 'GITHUB_TOKEN_SECRET_NAME',
} as const;
```

## Data Models

### Secrets Manager Secret

| Attribute      | Value                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| Name           | `{StackPrefix}GitHubPAT-{Region}` (e.g., `CapabilityInsightsGitHubPAT-us-east-1`) |
| Type           | Plaintext string (the PAT value)                                                  |
| Encryption     | AWS-managed KMS key (default)                                                     |
| Removal Policy | RETAIN                                                                            |

### DynamoDB PolicyConfiguration (Updated)

| Field                     | Type              | Notes                                    |
| ------------------------- | ----------------- | ---------------------------------------- |
| `policyId`                | String (PK)       | `SYNC_SETTINGS` for sync settings record |
| `terraformOverlayEnabled` | Boolean           | Whether overlay is active                |
| `dataSyncEnabled`         | Boolean           | Whether scheduled sync runs              |
| `updatedAt`               | String (ISO 8601) | Last modification timestamp              |
| ~~`githubToken`~~         | ~~String~~        | **REMOVED** — no longer stored here      |

## Error Handling

| Scenario                                            | Behavior                                          |
| --------------------------------------------------- | ------------------------------------------------- |
| Secrets Manager write fails on PUT /syncSettings    | Return HTTP 500 with error message                |
| Secrets Manager read fails on GET /syncSettings     | Return HTTP 500 with "Settings store unavailable" |
| No secret value when enabling overlay without token | Return HTTP 400 with "GitHub token is required"   |
| No secret value when getGitHubPat() is called       | Throw error "GitHub token not configured"         |
| Secrets Manager read fails in data-fetch Lambda     | Skip overlay invocation, log error, continue sync |
| Token validation fails (empty/whitespace)           | Return HTTP 400 with validation message           |

## Security Considerations

1. **Encryption at rest**: Secrets Manager encrypts the PAT using AWS KMS (default key).
2. **Least privilege**: API Lambda gets Get+Put; Data-Fetch Lambda gets Get only.
3. **No internet exposure**: VPC endpoint keeps Secrets Manager traffic within the VPC.
4. **No token in responses**: The `hasToken` boolean is the only token-related field in API responses.
5. **Removal policy RETAIN**: Secret persists through stack deletions to prevent accidental credential loss.

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Property 1: Token storage round-trip

_For any_ valid GitHub PAT string (non-empty, no leading/trailing whitespace), storing the token via `GitHubTokenStore.putToken()` and then retrieving it via `GitHubTokenStore.getToken()` SHALL return the exact same string.

**Validates: Requirements 4.1, 6.1, 7.1**

### Property 2: hasToken reflects secret state

_For any_ state of the Secrets Manager secret (value present with non-empty content, or value absent/empty), `GitHubTokenStore.hasToken()` SHALL return `true` if and only if a non-empty secret string exists.

**Validates: Requirements 5.1, 5.2**

### Property 3: Raw token never leaked in API responses

_For any_ stored GitHub PAT value and any GET /syncSettings response, the response body SHALL NOT contain the raw token string. The only token-related field in the response SHALL be the boolean `hasToken`.

**Validates: Requirements 5.3**

### Property 4: Token passthrough to overlay Lambda

_For any_ non-empty token value retrieved from Secrets Manager when overlay is enabled, the Data-Fetch Lambda SHALL include that exact token value in the `githubToken` field of the Terraform Overlay Lambda invocation payload.

**Validates: Requirements 7.2**

### Property 5: DynamoDB schema correctness

_For any_ call to `SyncSettingsStore.updateSettings()` or `SyncSettingsStore.getSettings()`, the DynamoDB item written SHALL contain `terraformOverlayEnabled`, `dataSyncEnabled`, and `updatedAt` fields, and SHALL NOT contain a `githubToken` field. Similarly, the returned settings object SHALL NOT include a `githubToken` property.

**Validates: Requirements 8.1, 8.2, 8.3**
