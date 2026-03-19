import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// ─── Import after mocks ────────────────────────────────────────────────────
const { CircuitBreaker } = await import('../../services/circuit-breaker.js');

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('CircuitBreaker', () => {
  let breaker: InstanceType<typeof CircuitBreaker>;

  beforeEach(() => {
    vi.clearAllMocks();
    breaker = new CircuitBreaker({
      name: 'test-service',
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });
  });

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should remain CLOSED on successful calls', async () => {
    const result = await breaker.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should stay CLOSED when failures are below threshold', async () => {
    // 2 failures (threshold is 3)
    for (let i = 0; i < 2; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should open after reaching failure threshold', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(breaker.getState()).toBe('OPEN');
  });

  it('should reject requests immediately when OPEN', async () => {
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(breaker.getState()).toBe('OPEN');

    // Next request should be rejected without calling the function
    const fn = vi.fn();
    await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker');
    expect(fn).not.toHaveBeenCalled();
  });

  it('should include breaker name in the rejection error message', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    await expect(breaker.execute(() => Promise.resolve('x'))).rejects.toThrow('test-service');
  });

  it('should transition to HALF_OPEN after reset timeout expires', async () => {
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(breaker.getState()).toBe('OPEN');

    // Fast-forward past the reset timeout
    vi.useFakeTimers();
    vi.advanceTimersByTime(1100);

    // The next execute call should transition to HALF_OPEN and try the function
    const result = await breaker.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    // After a successful HALF_OPEN call, state should go back to CLOSED
    expect(breaker.getState()).toBe('CLOSED');

    vi.useRealTimers();
  });

  it('should return to OPEN on failed HALF_OPEN request', async () => {
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    // Fast-forward past the reset timeout
    vi.useFakeTimers();
    vi.advanceTimersByTime(1100);

    // HALF_OPEN attempt fails
    await breaker.execute(() => Promise.reject(new Error('still broken'))).catch(() => {});
    expect(breaker.getState()).toBe('OPEN');

    vi.useRealTimers();
  });

  it('should close on successful HALF_OPEN request', async () => {
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    vi.useFakeTimers();
    vi.advanceTimersByTime(1100);

    // HALF_OPEN attempt succeeds
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.getState()).toBe('CLOSED');

    // Should now accept requests normally
    const result = await breaker.execute(() => Promise.resolve('normal'));
    expect(result).toBe('normal');

    vi.useRealTimers();
  });

  it('should reset state via reset()', async () => {
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(breaker.getState()).toBe('OPEN');

    breaker.reset();
    expect(breaker.getState()).toBe('CLOSED');

    // Should accept requests again
    const result = await breaker.execute(() => Promise.resolve('after-reset'));
    expect(result).toBe('after-reset');
  });

  it('should have independent instances', async () => {
    const breaker2 = new CircuitBreaker({
      name: 'other-service',
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });

    // Open breaker1
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(breaker.getState()).toBe('OPEN');

    // breaker2 should still be closed
    expect(breaker2.getState()).toBe('CLOSED');
    const result = await breaker2.execute(() => Promise.resolve('independent'));
    expect(result).toBe('independent');
  });

  it('should reset failure count on a successful call', async () => {
    // 2 failures
    await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

    // 1 success resets the count
    await breaker.execute(() => Promise.resolve('ok'));

    // 2 more failures should NOT open (threshold is 3, and count was reset)
    await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should propagate the original error from the function', async () => {
    const originalError = new Error('specific DB error');
    await expect(breaker.execute(() => Promise.reject(originalError)))
      .rejects.toBe(originalError);
  });

  it('should return the value from the executed function', async () => {
    const complexResult = { data: [1, 2, 3], status: 'ok' };
    const result = await breaker.execute(() => Promise.resolve(complexResult));
    expect(result).toEqual(complexResult);
  });
});
