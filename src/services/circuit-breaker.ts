import { logger } from './logger.js';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  name: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions) {
    this.options = options;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(
          `Circuit breaker "${this.options.name}" is OPEN. Service temporarily unavailable.`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'OPEN';
      logger.error(
        { breaker: this.options.name, failures: this.failureCount },
        `Circuit breaker "${this.options.name}" opened after ${this.failureCount} failures`
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

// Pre-configured circuit breakers for external services
export const geminiBreaker = new CircuitBreaker({
  name: 'gemini',
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
});

export const fashnBreaker = new CircuitBreaker({
  name: 'fashn',
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
});

export const fireworksBreaker = new CircuitBreaker({
  name: 'fireworks',
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
});
