export type ProviderErrorKind =
  | 'rate_limit'
  | 'auth'
  | 'quota'
  | 'not_found'
  | 'bad_request'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unknown';

export class ProviderHttpError extends Error {
  readonly provider: string;
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly retryAfterSec?: number;
  readonly body?: string;

  constructor(opts: {
    provider: string;
    kind: ProviderErrorKind;
    message: string;
    status?: number;
    retryAfterSec?: number;
    body?: string;
  }) {
    super(opts.message);
    this.name = 'ProviderHttpError';
    this.provider = opts.provider;
    this.kind = opts.kind;
    this.status = opts.status;
    this.retryAfterSec = opts.retryAfterSec;
    this.body = opts.body;
  }

  /** Compact string for pipeline DB / Nest logs. */
  toLogString(): string {
    const parts = [
      `[${this.provider}]`,
      `kind=${this.kind}`,
      this.status != null ? `status=${this.status}` : null,
      this.retryAfterSec != null ? `retryAfter=${this.retryAfterSec}s` : null,
      this.message,
    ].filter(Boolean);
    return parts.join(' ');
  }
}

export function classifyHttpStatus(status: number, body: string): ProviderErrorKind {
  const lower = body.toLowerCase();
  if (status === 429 || lower.includes('rate limit') || lower.includes('rate_limit')) {
    return 'rate_limit';
  }
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'bad_request';
  if (
    status === 402 ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota') ||
    lower.includes('billing')
  ) {
    return 'quota';
  }
  if (status >= 500) return 'server';
  return 'unknown';
}

export function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber)) return asNumber;
  const when = Date.parse(header);
  if (!Number.isNaN(when)) {
    return Math.max(0, Math.ceil((when - Date.now()) / 1000));
  }
  return undefined;
}

export function classifyFetchFailure(err: unknown): ProviderHttpError {
  const raw = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && 'cause' in err
      ? String((err as Error & { cause?: unknown }).cause ?? '')
      : '';
  const combined = `${raw} ${cause}`.toLowerCase();

  let kind: ProviderErrorKind = 'network';
  if (combined.includes('abort') || combined.includes('timeout')) {
    kind = 'timeout';
  }

  return new ProviderHttpError({
    provider: 'network',
    kind,
    message:
      kind === 'timeout'
        ? `Request timed out (${raw})`
        : `Network/fetch failed (${raw}${cause ? `; cause=${cause}` : ''}). Not a rate-limit response — check connectivity/DNS/TLS.`,
  });
}

export async function throwForHttpError(
  provider: string,
  response: Response,
  operation: string,
): Promise<never> {
  const body = await response.text();
  const kind = classifyHttpStatus(response.status, body);
  const retryAfterSec = parseRetryAfter(response);

  const kindHint =
    kind === 'rate_limit'
      ? 'RATE LIMITED by provider'
      : kind === 'quota'
        ? 'QUOTA/BILLING issue'
        : kind === 'auth'
          ? 'AUTH/API key rejected'
          : kind === 'server'
            ? 'PROVIDER SERVER error'
            : 'PROVIDER error';

  throw new ProviderHttpError({
    provider,
    kind,
    status: response.status,
    retryAfterSec,
    body: body.slice(0, 800),
    message: `${kindHint} on ${operation}: HTTP ${response.status}${
      retryAfterSec != null ? ` (retry after ${retryAfterSec}s)` : ''
    } — ${body.slice(0, 400)}`,
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry transient failures (rate limit, network, 5xx).
 */
export async function withProviderRetries<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 4;
  const baseDelayMs = opts?.baseDelayMs ?? 1500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const providerErr =
        err instanceof ProviderHttpError
          ? err
          : err instanceof Error && err.message.includes('fetch failed')
            ? classifyFetchFailure(err)
            : null;

      const retryable =
        providerErr &&
        (providerErr.kind === 'rate_limit' ||
          providerErr.kind === 'network' ||
          providerErr.kind === 'timeout' ||
          providerErr.kind === 'server');

      if (!retryable || attempt === maxAttempts) {
        if (providerErr && !(err instanceof ProviderHttpError)) {
          throw providerErr;
        }
        throw err;
      }

      const delayMs =
        providerErr.retryAfterSec != null
          ? providerErr.retryAfterSec * 1000
          : baseDelayMs * 2 ** (attempt - 1);

      // eslint-disable-next-line no-console
      console.warn(
        `[${label}] attempt ${attempt}/${maxAttempts} failed (${providerErr.kind}) — retrying in ${Math.round(delayMs)}ms`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export function formatPipelineError(err: unknown): string {
  if (err instanceof ProviderHttpError) {
    return err.toLogString();
  }
  if (err instanceof Error) {
    if (/fetch failed|econnreset|enotfound|etimedout|socket/i.test(err.message)) {
      return classifyFetchFailure(err).toLogString();
    }
    return err.message;
  }
  return String(err);
}
