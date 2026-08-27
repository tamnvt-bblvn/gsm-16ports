/**
 * POST JSON with a bounded retry, so a single Discord rate-limit hit or
 * transient network blip doesn't silently drop a time-sensitive OTP
 * notification. Handles Discord's 429 by honoring the `retry_after` it
 * returns instead of guessing a delay.
 */
export interface WebhookPostOptions {
  url: string;
  body: unknown;
  timeoutMs: number;
  /** Total attempts including the first. Defaults to 3. */
  maxAttempts?: number;
  /** Called after every failed attempt so callers can log with their own logger. */
  onAttemptFailed: (reason: string, attempt: number, maxAttempts: number) => void;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 10_000;

export interface WebhookPostResult {
  ok: boolean;
  /** Reason for the last failed attempt; present only when ok is false. */
  reason?: string;
}

export async function postWebhookWithRetry(
  options: WebhookPostOptions,
): Promise<WebhookPostResult> {
  const { url, body, timeoutMs, onAttemptFailed } = options;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let delayMs = 0;
  let lastReason = 'unknown error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.ok) {
        return { ok: true };
      }

      if (response.status === 429) {
        const retryAfterMs = await readRetryAfterMs(response);
        delayMs = Math.min(retryAfterMs ?? 2000, MAX_BACKOFF_MS);
        lastReason = `rate_limited status=429 retry_in=${delayMs}ms`;
      } else {
        delayMs = Math.min(800 * attempt, MAX_BACKOFF_MS);
        lastReason = `status=${response.status}`;
      }
      onAttemptFailed(lastReason, attempt, maxAttempts);
    } catch (error) {
      delayMs = Math.min(800 * attempt, MAX_BACKOFF_MS);
      lastReason = error instanceof Error ? error.message : 'request failed';
      onAttemptFailed(lastReason, attempt, maxAttempts);
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, reason: lastReason };
}

async function readRetryAfterMs(response: Response): Promise<number | null> {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }
  }

  try {
    const data = (await response.json()) as { retry_after?: number };
    if (typeof data.retry_after === 'number') {
      return data.retry_after * 1000;
    }
  } catch {
    // Body wasn't JSON (or already consumed) — fall through to null.
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
