import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase ──────────────────────────────────────────────────────────
const mockSupabase = {
  from: vi.fn(),
};

function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in',
    'single', 'maybeSingle', 'order', 'limit', 'range',
  ];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

vi.mock('../supabase.js', () => ({
  supabaseAdmin: mockSupabase,
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
const {
  getSubscriptionInfo,
  getEffectivePlan,
  meetsMinimumTier,
  getPlanLimits,
  canAccessFeature,
  PLAN_LIMITS,
  PLAN_RANK,
  invalidateSubscriptionCache,
  invalidateAllSubscriptionCaches,
  getRemainingCredits,
} = await import('../subscriptionService.js');

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Subscription Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear cache before each test
    invalidateAllSubscriptionCaches();
  });

  // ── getSubscriptionInfo ───────────────────────────────────────────────────

  describe('getSubscriptionInfo', () => {
    it('should return free plan for user with no subscription', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'free', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const info = await getSubscriptionInfo('user-free');
      expect(info.plan).toBe('free');
      expect(info.status).toBe('free');
      expect(info.isTrialActive).toBe(false);
      expect(info.limits).toEqual(PLAN_LIMITS.free);
    });

    it('should return basic plan for subscribed basic user', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'basic', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const info = await getSubscriptionInfo('user-basic');
      expect(info.plan).toBe('basic');
      expect(info.status).toBe('active');
      expect(info.limits).toEqual(PLAN_LIMITS.basic);
    });

    it('should return premium plan for subscribed premium user', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'premium', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const info = await getSubscriptionInfo('user-premium');
      expect(info.plan).toBe('premium');
      expect(info.status).toBe('active');
      expect(info.limits).toEqual(PLAN_LIMITS.premium);
    });

    it('should elevate free user to basic during active trial', async () => {
      const futureDate = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const chain = chainMock({
        data: { subscription_plan: 'free', trial_end_date: futureDate },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const info = await getSubscriptionInfo('user-trial');
      expect(info.plan).toBe('basic');
      expect(info.status).toBe('trial');
      expect(info.isTrialActive).toBe(true);
      expect(info.trialEndDate).toBe(futureDate);
      expect(info.limits).toEqual(PLAN_LIMITS.basic);
    });

    it('should not elevate premium user during trial', async () => {
      const futureDate = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const chain = chainMock({
        data: { subscription_plan: 'premium', trial_end_date: futureDate },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const info = await getSubscriptionInfo('user-premium-trial');
      expect(info.plan).toBe('premium');
      expect(info.status).toBe('trial');
      expect(info.isTrialActive).toBe(true);
    });

    it('should return expired status for free user with expired trial', async () => {
      const pastDate = new Date(Date.now() - 86_400_000).toISOString();
      const chain = chainMock({
        data: { subscription_plan: 'free', trial_end_date: pastDate },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const info = await getSubscriptionInfo('user-expired-trial');
      expect(info.plan).toBe('free');
      expect(info.status).toBe('expired');
      expect(info.isTrialActive).toBe(false);
    });

    it('should return free plan when profile is missing', async () => {
      const chain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const info = await getSubscriptionInfo('nonexistent-user');
      expect(info.plan).toBe('free');
      expect(info.status).toBe('free');
      expect(info.limits).toEqual(PLAN_LIMITS.free);
    });

    it('should cache results and not re-query within TTL', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'basic', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      await getSubscriptionInfo('cached-user');
      await getSubscriptionInfo('cached-user');

      // Should only query once due to caching
      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    });

    it('should re-query after cache invalidation', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'basic', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      await getSubscriptionInfo('invalidate-user');
      invalidateSubscriptionCache('invalidate-user');
      await getSubscriptionInfo('invalidate-user');

      expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    });
  });

  // ── getEffectivePlan ──────────────────────────────────────────────────────

  describe('getEffectivePlan', () => {
    it('should return the effective plan with trial elevation', async () => {
      const futureDate = new Date(Date.now() + 86_400_000).toISOString();
      const chain = chainMock({
        data: { subscription_plan: 'free', trial_end_date: futureDate },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const plan = await getEffectivePlan('trial-user');
      expect(plan).toBe('basic');
    });

    it('should return free for user without subscription', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'free', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const plan = await getEffectivePlan('free-user');
      expect(plan).toBe('free');
    });
  });

  // ── meetsMinimumTier ──────────────────────────────────────────────────────

  describe('meetsMinimumTier', () => {
    it('should confirm free user meets free tier', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'free', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const result = await meetsMinimumTier('user-1', 'free');
      expect(result.meets).toBe(true);
      expect(result.effectivePlan).toBe('free');
    });

    it('should deny free user for basic tier', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'free', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const result = await meetsMinimumTier('user-1', 'basic');
      expect(result.meets).toBe(false);
    });

    it('should deny basic user for premium tier', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'basic', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const result = await meetsMinimumTier('user-1', 'premium');
      expect(result.meets).toBe(false);
    });

    it('should confirm premium user meets basic tier', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'premium', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const result = await meetsMinimumTier('user-1', 'basic');
      expect(result.meets).toBe(true);
      expect(result.effectivePlan).toBe('premium');
    });

    it('should confirm premium user meets premium tier', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'premium', trial_end_date: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const result = await meetsMinimumTier('user-1', 'premium');
      expect(result.meets).toBe(true);
    });
  });

  // ── Plan limits correctness ───────────────────────────────────────────────

  describe('plan limits correctness', () => {
    it('should have correct free plan limits', () => {
      const limits = getPlanLimits('free');
      expect(limits.wardrobe_limit).toBe(50);
      expect(limits.vton_credits_monthly).toBe(3);
      expect(limits.ai_chats_daily).toBe(10);
    });

    it('should have correct basic plan limits', () => {
      const limits = getPlanLimits('basic');
      expect(limits.wardrobe_limit).toBe(200);
      expect(limits.vton_credits_monthly).toBe(15);
      expect(limits.ai_chats_daily).toBe(50);
    });

    it('should have correct premium plan limits (unlimited = -1)', () => {
      const limits = getPlanLimits('premium');
      expect(limits.wardrobe_limit).toBe(-1);
      expect(limits.vton_credits_monthly).toBe(50);
      expect(limits.ai_chats_daily).toBe(-1);
    });

    it('should have correct plan rank ordering', () => {
      expect(PLAN_RANK['free']).toBeLessThan(PLAN_RANK['basic']!);
      expect(PLAN_RANK['basic']).toBeLessThan(PLAN_RANK['premium']!);
    });
  });

  // ── canAccessFeature ──────────────────────────────────────────────────────

  describe('canAccessFeature', () => {
    it('should deny free user from vton feature', () => {
      expect(canAccessFeature('free', 'vton')).toBe(false);
    });

    it('should allow basic user to access vton feature', () => {
      expect(canAccessFeature('basic', 'vton')).toBe(true);
    });

    it('should deny basic user from unlimited_wardrobe', () => {
      expect(canAccessFeature('basic', 'unlimited_wardrobe')).toBe(false);
    });

    it('should allow premium user to access all features', () => {
      expect(canAccessFeature('premium', 'unlimited_wardrobe')).toBe(true);
      expect(canAccessFeature('premium', 'vton')).toBe(true);
      expect(canAccessFeature('premium', 'unlimited_ai_chats')).toBe(true);
      expect(canAccessFeature('premium', 'premium_avatars')).toBe(true);
      expect(canAccessFeature('premium', 'priority_support')).toBe(true);
    });
  });

  // ── getRemainingCredits ───────────────────────────────────────────────────

  describe('getRemainingCredits', () => {
    it('should return credits from profile', async () => {
      const chain = chainMock({
        data: { vton_credits: 10 },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const credits = await getRemainingCredits('user-1');
      expect(credits).toBe(10);
    });

    it('should return 0 when profile has no credits', async () => {
      const chain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const credits = await getRemainingCredits('user-1');
      expect(credits).toBe(0);
    });
  });
});
