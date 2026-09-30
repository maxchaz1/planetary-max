export type RetryPolicy = {
  baseDelayMs: number;
  maxAttempts: number;
  maxDelayMs?: number;
};

export type RetryOptions = {
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  shouldRetry: (error: unknown) => boolean;
  sleep?: (delayMs: number) => Promise<void>;
};

const defaultSleep = (delayMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function retry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 1;
  for (;;) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= policy.maxAttempts || !options.shouldRetry(error)) throw error;
      const delayMs = Math.min(policy.baseDelayMs * (2 ** (attempt - 1)), policy.maxDelayMs ?? 30_000);
      options.onRetry?.(attempt, delayMs, error);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}
