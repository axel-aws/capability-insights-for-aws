import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { logger } from '../util/logger';

/** Timeout in ms for Secrets Manager API calls. Prevents Lambda timeout if VPC endpoint is unreachable. */
const REQUEST_TIMEOUT_MS = 5000;

export class GitHubTokenStore {
  private client: SecretsManagerClient;

  constructor(private secretName: string) {
    this.client = new SecretsManagerClient({});
  }

  /** Retrieve the stored GitHub PAT. Returns undefined if no value exists. */
  async getToken(): Promise<string | undefined> {
    try {
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
      try {
        const result = await this.client.send(
          new GetSecretValueCommand({ SecretId: this.secretName }),
          { abortSignal: abortController.signal },
        );
        return result.SecretString || undefined;
      } finally {
        clearTimeout(timer);
      }
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
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
    try {
      await this.client.send(
        new PutSecretValueCommand({
          SecretId: this.secretName,
          SecretString: token,
        }),
        { abortSignal: abortController.signal },
      );
    } finally {
      clearTimeout(timer);
    }
    logger.info('Stored GitHub token in Secrets Manager');
  }

  /** Delete the secret value by writing an empty string. */
  async deleteToken(): Promise<void> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
    try {
      await this.client.send(
        new PutSecretValueCommand({
          SecretId: this.secretName,
          SecretString: '',
        }),
        { abortSignal: abortController.signal },
      );
    } finally {
      clearTimeout(timer);
    }
    logger.info('Cleared GitHub token from Secrets Manager');
  }
}
