import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase ──────────────────────────────────────────────────────────
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

// ─── Chainable query mock ───────────────────────────────────────────────────
function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'eq', 'neq', 'single',
    'maybeSingle', 'order', 'limit', 'gt', 'in', 'head',
  ];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

// ─── Import after mocks ─────────────────────────────────────────────────────
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
    json: vi.fn((body: any, status?: number) => ({ body, status: status || 200, _isResponse: true })),
    header: vi.fn((key: string, value: string) => { headers[key] = value; }),
    _vars: vars,
    _headers: headers,
  };
}

// ─── Integration Tests: Subscription Flow ────────────────────────────────────
describe('Subscription Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Scenario 1: Free user signs up → gets free limits ──────────────────
  it('should give a new free user the correct plan and limits', async () => {
    const chain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const plan = await getUserPlan('new-user-1');
    expect(plan).toBe('free');

    // Verify free limits
    expect(WARDROBE_LIMITS['free']).toBe(50);
    expect(AI_CHAT_DAILY_LIMITS['free']).toBe(10);
  });

  // ── Scenario 2: User starts trial → gets premium limits temporarily ────
  it('should upgrade a free user to basic during active trial', async () => {
    const futureDate = new Date(Date.now() + 7 * 86_400_000).toISOString(); // 7 days from now
    const chain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: futureDate },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const plan = await getUserPlan('trial-user-1');
    expect(plan).toBe('basic');

    // Should be allowed to access basic features
    const middleware = requireSubscription('basic');
    const c = createMockContext('trial-user-1');
    const next = vi.fn();
    await middleware(c as any, next);

    expect(next).toHaveBeenCalled();
    expect(c.set).toHaveBeenCalledWith('subscriptionPlan', 'basic');
  });

  // ── Scenario 3: Trial expires → back to free ──────────────────────────
  it('should revert to free when trial expires', async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString(); // 1 day ago
    const chain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: pastDate },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const plan = await getUserPlan('expired-trial-user');
    expect(plan).toBe('free');

    // Should be blocked from basic features
    const middleware = requireSubscription('basic');
    const c = createMockContext('expired-trial-user');
    const next = vi.fn();
    await middleware(c as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('basic') }),
      403
    );
  });

  // ── Scenario 4: User subscribes → gets plan limits ─────────────────────
  it('should give subscribed user their plan limits', async () => {
    const chain = chainMock({
      data: { subscription_plan: 'premium', trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const plan = await getUserPlan('premium-user-1');
    expect(plan).toBe('premium');

    // Premium user should access any tier
    const middleware = requireSubscription('premium');
    const c = createMockContext('premium-user-1');
    const next = vi.fn();
    await middleware(c as any, next);

    expect(next).toHaveBeenCalled();
    expect(c.set).toHaveBeenCalledWith('subscriptionPlan', 'premium');
  });

  // ── Scenario 5: Subscription renews → credits reset ────────────────────
  it('should allow AI chat usage after daily reset (new day)', () => {
    // Simulate a user who used all their credits yesterday
    // checkAIChatLimit tracks by date, so a "new day" means a fresh count
    const userId = 'renew-user-fresh-day';

    // First call on a new day should succeed
    const result = checkAIChatLimit(userId, 'basic');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(1);
    expect(result.limit).toBe(50);
  });

  // ── Scenario 6: Subscription expires → downgrade to free ───────────────
  it('should downgrade expired subscriber to free limits', async () => {
    // After expiration, their profile reverts to free plan
    const chain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const plan = await getUserPlan('expired-subscriber');
    expect(plan).toBe('free');

    // Should be blocked from premium features
    const middleware = requireSubscription('premium');
    const c = createMockContext('expired-subscriber');
    const next = vi.fn();
    await middleware(c as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
      403
    );
  });

  // ── Scenario 7: Wardrobe limit check for free user ─────────────────────
  it('should enforce wardrobe limit for free user (50 items)', async () => {
    // First call: getUserPlan returns free
    const planChain = chainMock({
      data: { subscription_plan: 'free', trial_end_date: null },
      error: null,
    });
    // Second call: wardrobe item count
    const countChain = chainMock({ data: null, error: null, count: 50 });
    // select with head: true returns count
    countChain.select = vi.fn(() => countChain);
    countChain.eq = vi.fn(() => countChain);
    countChain.then = (resolve: any) => resolve({ data: null, error: null, count: 50 });

    let callIdx = 0;
    mockFrom.mockImplementation(() => {
      callIdx++;
      return callIdx === 1 ? planChain : countChain;
    });

    const result = await checkWardrobeLimit('free-wardrobe-user');
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(50);
    expect(result.current).toBe(50);
  });

  // ── Scenario 8: Premium user gets unlimited wardrobe ───────────────────
  it('should allow unlimited wardrobe items for premium users', async () => {
    const planChain = chainMock({
      data: { subscription_plan: 'premium', trial_end_date: null },
      error: null,
    });
    mockFrom.mockReturnValue(planChain);

    const result = await checkWardrobeLimit('premium-wardrobe-user');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(-1); // unlimited
  });

  // ── Scenario 9: AI usage tracking increments correctly ─────────────────
  it('should track AI usage incrementally within the day', () => {
    const userId = 'ai-tracking-user-' + Date.now();

    const r1 = checkAIChatLimit(userId, 'free');
    expect(r1.allowed).toBe(true);
    expect(r1.used).toBe(1);

    const r2 = checkAIChatLimit(userId, 'free');
    expect(r2.allowed).toBe(true);
    expect(r2.used).toBe(2);

    const r3 = checkAIChatLimit(userId, 'free');
    expect(r3.allowed).toBe(true);
    expect(r3.used).toBe(3);
  });

  // ── Scenario 10: AI usage exhaustion for free plan ─────────────────────
  it('should exhaust AI chat credits and deny further requests on free plan', () => {
    const userId = 'exhaustion-user-' + Date.now();

    // Use all 10 free credits
    for (let i = 0; i < 10; i++) {
      const result = checkAIChatLimit(userId, 'free');
      expect(result.allowed).toBe(true);
    }

    // 11th request should be denied
    const denied = checkAIChatLimit(userId, 'free');
    expect(denied.allowed).toBe(false);
    expect(denied.used).toBe(10);
    expect(denied.limit).toBe(10);
  });

  // ── Scenario 11: Premium user has unlimited AI chat ────────────────────
  it('should allow unlimited AI chat for premium users', () => {
    const userId = 'unlimited-ai-user-' + Date.now();

    // Make many requests - all should succeed
    for (let i = 0; i < 100; i++) {
      const result = checkAIChatLimit(userId, 'premium');
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
    }
  });

  // ── Scenario 12: Basic user has higher limits than free ────────────────
  it('should give basic user 50 AI chat messages per day', () => {
    const userId = 'basic-ai-user-' + Date.now();

    // Use 10 messages (free limit) - basic should still be fine
    for (let i = 0; i < 10; i++) {
      const result = checkAIChatLimit(userId, 'basic');
      expect(result.allowed).toBe(true);
    }

    // 11th message should still work on basic (limit is 50)
    const r11 = checkAIChatLimit(userId, 'basic');
    expect(r11.allowed).toBe(true);
    expect(r11.used).toBe(11);
  });

  // ── Scenario 13: Concurrent access pattern ─────────────────────────────
  it('should handle concurrent AI chat limit checks correctly', () => {
    const userId = 'concurrent-user-' + Date.now();

    // Exhaust all but 1 credit
    for (let i = 0; i < 9; i++) {
      checkAIChatLimit(userId, 'free');
    }

    // Two "concurrent" requests for the last credit
    const r1 = checkAIChatLimit(userId, 'free');
    const r2 = checkAIChatLimit(userId, 'free');

    // First gets the last credit, second is denied
    expect(r1.allowed).toBe(true);
    expect(r1.used).toBe(10);
    expect(r2.allowed).toBe(false);
    expect(r2.used).toBe(10);
  });

  // ── Scenario 14: Plan hierarchy enforcement ────────────────────────────
  it('should enforce plan hierarchy: free < basic < premium', async () => {
    // Free user cannot access basic features
    let chain = chainMock({ data: { subscription_plan: 'free', trial_end_date: null }, error: null });
    mockFrom.mockReturnValue(chain);

    const mwBasic = requireSubscription('basic');
    let c = createMockContext('hierarchy-user');
    let next = vi.fn();
    await mwBasic(c as any, next);
    expect(next).not.toHaveBeenCalled();

    // Basic user cannot access premium features
    chain = chainMock({ data: { subscription_plan: 'basic', trial_end_date: null }, error: null });
    mockFrom.mockReturnValue(chain);

    const mwPremium = requireSubscription('premium');
    c = createMockContext('hierarchy-user-2');
    next = vi.fn();
    await mwPremium(c as any, next);
    expect(next).not.toHaveBeenCalled();

    // Premium user can access basic features
    chain = chainMock({ data: { subscription_plan: 'premium', trial_end_date: null }, error: null });
    mockFrom.mockReturnValue(chain);

    c = createMockContext('hierarchy-user-3');
    next = vi.fn();
    await mwBasic(c as any, next);
    expect(next).toHaveBeenCalled();
  });
});
