import { s3Client } from './s3-client';

/**
 * Base class for API clients that communicate with the backend API Gateway.
 * Handles URL resolution (cached from api-config.json) and standard error handling.
 */
export class BaseApiClient {
  private cachedBaseUrl: string | null = null;

  protected async getApiBaseUrl(): Promise<string> {
    if (this.cachedBaseUrl) return this.cachedBaseUrl;
    const config = await s3Client.fetchJson<{ apiBaseUrl: string }>('/api-config.json');
    this.cachedBaseUrl = config.apiBaseUrl;
    return this.cachedBaseUrl;
  }

  /**
   * Perform a fetch request and throw on non-OK responses.
   * Extracts the error message from the response body if available.
   */
  protected async request<T>(path: string, options?: RequestInit): Promise<T> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}${path}`, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = (body as Record<string, unknown>).message ?? `Request failed: ${res.status}`;
      throw new Error(String(message));
    }
    return res.json();
  }

  /** POST JSON to a path and return the parsed response. */
  protected async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** PUT JSON to a path and return the parsed response. */
  protected async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** DELETE a resource and return the parsed response. */
  protected async del<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  /** GET a resource and return the parsed response. */
  protected async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }
}
