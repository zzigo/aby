import type { Asset, CommitIngest, IngestPreview, Segment, SegmentCreate } from '@zztt/aby-domain';

export interface AbySdkOptions {
  baseUrl: string;
  token?: string | (() => Promise<string>);
  fetch?: typeof globalThis.fetch;
}

export class AbySdkError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'AbySdkError';
  }
}

export class AbySdk {
  readonly #baseUrl: string;
  readonly #token?: string | (() => Promise<string>);
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: AbySdkOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = typeof this.#token === 'function' ? await this.#token() : this.#token;
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });
    const body = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new AbySdkError(response.status, body.error?.code ?? 'request_failed', body.error?.message ?? response.statusText);
    return body as T;
  }

  health(): Promise<{ name: 'aby'; status: 'ok'; version: string; dependencies: Record<string, boolean> }> {
    return this.#request('/api/health');
  }

  previewFixture(): Promise<{ preview: IngestPreview }> {
    return this.#request('/api/ingest/preview', { method: 'POST', body: JSON.stringify({ fixture: true }) });
  }

  commit(input: CommitIngest): Promise<{ asset: Asset }> {
    return this.#request('/api/ingest/commit', { method: 'POST', body: JSON.stringify(input) });
  }

  createSegment(input: SegmentCreate): Promise<{ segment: Segment }> {
    return this.#request('/api/segments', { method: 'POST', body: JSON.stringify(input) });
  }

  playback(assetId: string): Promise<{ url: string; expiresAt: string }> {
    return this.#request(`/api/assets/${encodeURIComponent(assetId)}/playback`);
  }
}

