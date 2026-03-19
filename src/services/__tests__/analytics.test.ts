import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock dependencies ──────────────────────────────────────────────────────

const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockFrom = vi.fn(() => ({ insert: mockInsert }));

vi.mock('../supabase.js', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-analytics-uuid'),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
const { trackEvent, AnalyticsEvents } = await import('../analytics.js');

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Analytics Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ data: null, error: null });
  });

  describe('trackEvent', () => {
    it('should track an event with valid parameters', async () => {
      await trackEvent('user-1', 'outfit_generated');

      expect(mockFrom).toHaveBeenCalledWith('analytics_events');
      expect(mockInsert).toHaveBeenCalledWith({
        id: 'mock-analytics-uuid',
        user_id: 'user-1',
        event: 'outfit_generated',
        properties: {},
      });
    });

    it('should track an event with metadata/properties', async () => {
      const props = { occasion: 'casual', items_count: 3 };
      await trackEvent('user-1', 'outfit_generated', props);

      expect(mockInsert).toHaveBeenCalledWith({
        id: 'mock-analytics-uuid',
        user_id: 'user-1',
        event: 'outfit_generated',
        properties: props,
      });
    });

    it('should allow null userId for anonymous events', async () => {
      await trackEvent(null, 'subscription_viewed');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: null })
      );
    });

    it('should default properties to empty object when not provided', async () => {
      await trackEvent('user-1', 'post_created');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ properties: {} })
      );
    });

    it('should not throw when Supabase insert fails (error handling)', async () => {
      mockInsert.mockRejectedValue(new Error('Supabase connection failed'));

      // Should not throw — analytics failures are swallowed
      await expect(trackEvent('user-1', 'post_created')).resolves.toBeUndefined();
    });

    it('should log the error when Supabase insert fails', async () => {
      const { logger } = await import('../logger.js');
      mockInsert.mockRejectedValue(new Error('DB error'));

      await trackEvent('user-1', 'post_created');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'post_created' }),
        expect.stringContaining('Failed to track analytics event')
      );
    });
  });

  describe('AnalyticsEvents constants', () => {
    it('should define all expected event type categories', () => {
      // Onboarding
      expect(AnalyticsEvents.ONBOARDING_STARTED).toBe('onboarding_started');
      expect(AnalyticsEvents.ONBOARDING_COMPLETED).toBe('onboarding_completed');

      // Wardrobe
      expect(AnalyticsEvents.WARDROBE_ITEM_ADDED).toBe('wardrobe_item_added');
      expect(AnalyticsEvents.WARDROBE_ITEM_DELETED).toBe('wardrobe_item_deleted');

      // Outfits
      expect(AnalyticsEvents.OUTFIT_GENERATED).toBe('outfit_generated');
      expect(AnalyticsEvents.OUTFIT_SAVED).toBe('outfit_saved');

      // Social
      expect(AnalyticsEvents.POST_CREATED).toBe('post_created');
      expect(AnalyticsEvents.POST_LIKED).toBe('post_liked');

      // Auth
      expect(AnalyticsEvents.USER_SIGNED_UP).toBe('user_signed_up');
      expect(AnalyticsEvents.USER_SIGNED_IN).toBe('user_signed_in');
    });

    it('should have unique values for all event types', () => {
      const values = Object.values(AnalyticsEvents);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it('should have string values for all event types', () => {
      for (const value of Object.values(AnalyticsEvents)) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });
});
