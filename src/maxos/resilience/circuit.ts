import { KernelError } from './errors';

export type CircuitState = 'closed' | 'half-open' | 'open';

export type CircuitConfig = {
  cooldownMs: number;
  failureThreshold: number;
};

export type CircuitHooks = {
  onStateChange?: (state: CircuitState) => void;
};

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private currentState: CircuitState = 'closed';

  constructor(
    private readonly config: CircuitConfig,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): CircuitState {
    return this.currentState;
  }

  async execute<T>(operation: () => Promise<T>, hooks: CircuitHooks = {}): Promise<T> {
    let isProbe = false;
    if (this.currentState === 'half-open') {
      throw new KernelError('Kernel circuit probe is already in progress', 'CIRCUIT_OPEN', 503, false);
    }
    if (this.currentState === 'open') {
      if (this.now() - this.openedAt < this.config.cooldownMs) {
        throw new KernelError('Kernel circuit is open', 'CIRCUIT_OPEN', 503, false);
      }
      isProbe = true;
      this.transition('half-open', hooks);
    }
    try {
      const result = await operation();
      if (isProbe) {
        this.failures = 0;
        this.transition('closed', hooks);
      } else if (this.currentState === 'closed') {
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures += 1;
      if (isProbe || this.failures >= this.config.failureThreshold) {
        this.openedAt = this.now();
        this.transition('open', hooks);
      }
      throw error;
    }
  }

  private transition(state: CircuitState, hooks: CircuitHooks): void {
    if (this.currentState === state) return;
    this.currentState = state;
    hooks.onStateChange?.(state);
  }
}
