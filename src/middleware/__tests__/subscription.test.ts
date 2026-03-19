import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase ─────────────────────────────────────────────────────────
const mockFrom = vi.fn();

vi.mock('../../services/supabase.js', () => ({
  supabaseAdmin: {
    from: mockFrom,
  },
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// ─── Chainable query mock ──────────────────────────────────────────────────
function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'single', 'maybeSingle', 'order', 'limit', 'gt', 'in'];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

// ─── Import after mocks ────────────────────────────────────────────────────
const {
  requireSubscription,
  getUserPlan,
  checkWardrobeLimit,
  checkAIChatLimit,
  WARDROBE_LIMITS,
  AI_CHAT_DAILY_LIMITS,
} = await import('../../middleware/subscription.js');

// Helper: create a minimal Hono-like context
function createMockContext(userId: string) {
  const headers: Record<string, string> = {};
  const vars: Record<string, any> = { userId };
  return {
    get: vi.fn((key: string) => vars[key]),
    set: vi.fn((key: string, value: any) => { vars[key] = value; }),
    json: vi.fn((body: any, status?: number) => {
      return { body, status: status || 200, _isResponse: true };
    }),
    header: vi.fn((key: string, value: string) => { headers[key] = value; }),
    _vars: vars,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('requireSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow premium user accessing basic-tier feature', async () => {
    const chain = chainMock({
      data: { subscription_plan: 'premium', trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('basic');
    const c = createMockContext('user-1');
    const next = vi.fn();

    await middleware(c as any, next);
    expect(next).toHaveBeenCalled();
    expect(c.set).toHaveBeenCalledWith('subscriptionPlan', 'premium');
  });

  it('should allow basic user accessing basic-tier feature', async () => {
    const chain = chainMock({
      data: { subscription_plan: 'basic', trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('basic');
    const c = createMockContext('user-2');
    const next = vi.fn();

    await middleware(c as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject free user accessing basic-tier feature', async () => {
    const chain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('basic');
    const c = createMockContext('user-3');
    const next = vi.fn();

    const result = await middleware(c as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('basic') }),
      403
    );
  });

  it('should reject free user accessing premium-tier feature', async () => {
    const chain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('premium');
    const c = createMockContext('user-4');
    const next = vi.fn();

    await middleware(c as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('premium') }),
      403
    );
  });

  it('should treat active trial user as basic plan', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const chain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: futureDate },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('basic');
    const c = createMockContext('user-5');
    const next = vi.fn();

    await middleware(c as any, next);
    expect(next).toHaveBeenCalled();
    expect(c.set).toHaveBeenCalledWith('subscriptionPlan', 'basic');
  });

  it('should not upgrade premium user during trial', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const chain = chainMock({
      data: { subscription_plan: 'premium', trial_end_date: futureDate },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('basic');
    const c = createMockContext('user-6');
    const next = vi.fn();

    await middleware(c as any, next);
    expect(next).toHaveBeenCalled();
    expect(c.set).toHaveBeenCalledWith('subscriptionPlan', 'premium');
  });

  it('should treat expired trial user as free', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const chain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: pastDate },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('basic');
    const c = createMockContext('user-7');
    const next = vi.fn();

    await middleware(c as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
      403
    );
  });

  it('should return 404 when profile is not found', async () => {
    const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('basic');
    const c = createMockContext('user-missing');
    const next = vi.fn();

    await middleware(c as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'User profile not found' }),
      404
    );
  });

  it('should return 404 on database error', async () => {
    const chain = chainMock({ data: null, error: { message: 'DB down' } });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('basic');
    const c = createMockContext('user-err');
    const next = vi.fn();

    await middleware(c as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'User profile not found' }),
      404
    );
  });

  it('should default to free when subscription_plan is null', async () => {
    const chain = chainMock({
      data: { subscription_plan: null, trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const middleware = requireSubscription('basic');
    const c = createMockContext('user-null-plan');
    const next = vi.fn();

    await middleware(c as any, next);
    expect(next).not.toHaveBeenCalled();
    // defaults to free, which is below basic
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
      403
    );
  });
});

describe('getUserPlan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return plan from profile', async () => {
    const chain = chainMock({
      data: { subscription_plan: 'premium', trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const plan = await getUserPlan('user-x');
    expect(plan).toBe('premium');
  });

  it('should return free when profile not found', async () => {
    const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
    mockFrom.mockReturnValue(chain);

    const plan = await getUserPlan('no-user');
    expect(plan).toBe('free');
  });

  it('should upgrade free to basic during active trial', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const chain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: futureDate },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const plan = await getUserPlan('trial-user');
    expect(plan).toBe('basic');
  });
});

describe('checkAIChatLimit', () => {
  it('should allow first request within daily limit', () => {
    const result = checkAIChatLimit('chat-user-1', 'free');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(1);
    expect(result.limit).toBe(10);
  });

  it('should return unlimited for premium plan', () => {
    const result = checkAIChatLimit('chat-premium-1', 'premium');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(-1);
  });

  it('should deny when daily limit exceeded', () => {
    const userId = 'chat-user-limit-test';
    // Exhaust the free limit (10)
    for (let i = 0; i < 10; i++) {
      checkAIChatLimit(userId, 'free');
    }
    const result = checkAIChatLimit(userId, 'free');
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(10);
  });

  it('should have correct limits per plan', () => {
    expect(AI_CHAT_DAILY_LIMITS['free']).toBe(10);
    expect(AI_CHAT_DAILY_LIMITS['basic']).toBe(50);
    expect(AI_CHAT_DAILY_LIMITS['premium']).toBe(-1);
  });
});

describe('WARDROBE_LIMITS', () => {
  it('should have correct limits per plan', () => {
    expect(WARDROBE_LIMITS['free']).toBe(50);
    expect(WARDROBE_LIMITS['basic']).toBe(200);
    expect(WARDROBE_LIMITS['premium']).toBe(-1);
  });
});
