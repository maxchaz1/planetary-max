import { KernelError, SubstrateError } from './errors';

export type TimeoutOptions<TError extends Error> = {
  createError: () => TError;
  timeoutMs: number;
};

export async function withTimeout<T, TError extends Error>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions<TError>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = options.createError();
      reject(error);
      controller.abort(error);
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), expired]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function kernelTimeout(timeoutMs: number): KernelError {
  return new KernelError(`Kernel request exceeded ${timeoutMs}ms`, 'KERNEL_TIMEOUT', 503, true);
}

export function substrateTimeout(timeoutMs: number): SubstrateError {
  return new SubstrateError(`Substrate operation exceeded ${timeoutMs}ms`, 'SUBSTRATE_TIMEOUT', 503, true);
}

export function parsePositiveInteger(value: string, name: string, maximum = 300_000): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new TypeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}
