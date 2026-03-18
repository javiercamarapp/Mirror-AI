-- ============================================================================
-- Migration 006: Phase 2+ Improvements
-- Trial support, hidden posts, analytics, rate limits, device tokens,
-- referrals, achievements, partial indexes
-- ============================================================================

-- ============================================
-- 1. TRIAL SUPPORT
-- ============================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'es';

-- ============================================
-- 2. HIDDEN POSTS (user hides post from feed)
-- ============================================
CREATE TABLE IF NOT EXISTS hidden_posts (
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

ALTER TABLE hidden_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own hidden posts" ON hidden_posts FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 3. DEVICE TOKENS (Push Notifications)
-- ============================================
CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own tokens" ON device_tokens FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 4. ANALYTICS EVENTS
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event, created_at DESC);

-- ============================================
-- 5. REFERRALS TRACKING
-- ============================================
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  referrer_reward_given BOOLEAN DEFAULT FALSE,
  referred_reward_given BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referred_id),
  CHECK(referrer_id != referred_id)
);

-- ============================================
-- 6. ACHIEVEMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);

ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own achievements" ON achievements FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- 7. RATE LIMITS TABLE (persistent rate limiting)
-- ============================================
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL
);

-- Clean up function for expired rate limit entries
CREATE OR REPLACE FUNCTION clean_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE reset_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. PARTIAL INDEXES (Performance)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_wardrobe_favorites ON wardrobe_items(user_id) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_stories_active ON stories(user_id, created_at) WHERE expires_at > NOW();
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscription_history(user_id) WHERE status = 'active';

-- ============================================
-- 9. MATERIALIZED VIEW FOR RANKINGS
-- ============================================
CREATE MATERIALIZED VIEW IF NOT EXISTS user_rankings AS
SELECT
  user_id,
  ROUND(AVG(score)::numeric, 1) as avg_score,
  COUNT(*) as outfit_count
FROM daily_outfits
WHERE score IS NOT NULL
GROUP BY user_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_rankings_user ON user_rankings(user_id);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_rankings()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_rankings;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 10. DELETE USER DATA FUNCTION (atomic)
-- ============================================
CREATE OR REPLACE FUNCTION delete_user_data(p_user_id UUID)
RETURNS void AS $$
BEGIN
  DELETE FROM story_views WHERE user_id = p_user_id;
  DELETE FROM stories WHERE user_id = p_user_id;
  DELETE FROM post_comments WHERE user_id = p_user_id;
  DELETE FROM post_likes WHERE user_id = p_user_id;
  DELETE FROM social_posts WHERE user_id = p_user_id;
  DELETE FROM daily_outfits WHERE user_id = p_user_id;
  DELETE FROM outfits WHERE user_id = p_user_id;
  DELETE FROM vton_usage WHERE user_id = p_user_id;
  DELETE FROM avatar_renders WHERE user_id = p_user_id;
  DELETE FROM user_avatars WHERE user_id = p_user_id;
  DELETE FROM notifications WHERE user_id = p_user_id;
  DELETE FROM friendships WHERE requester_id = p_user_id OR addressee_id = p_user_id;
  DELETE FROM wardrobe_items WHERE user_id = p_user_id;
  DELETE FROM user_avatar_data WHERE user_id = p_user_id;
  DELETE FROM onboarding_data WHERE user_id = p_user_id;
  DELETE FROM hidden_posts WHERE user_id = p_user_id;
  DELETE FROM device_tokens WHERE user_id = p_user_id;
  DELETE FROM analytics_events WHERE user_id = p_user_id;
  DELETE FROM referrals WHERE referrer_id = p_user_id OR referred_id = p_user_id;
  DELETE FROM achievements WHERE user_id = p_user_id;
  DELETE FROM content_reports WHERE reporter_id = p_user_id;
  DELETE FROM user_blocks WHERE blocker_id = p_user_id OR blocked_id = p_user_id;
  DELETE FROM subscription_history WHERE user_id = p_user_id;
  DELETE FROM purchases WHERE user_id = p_user_id;
  DELETE FROM user_profiles WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 11. ADD image_thumb_url TO wardrobe_items
-- ============================================
ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS image_thumb_url TEXT;

-- ============================================
-- 12. ADD transaction_id TO subscription_history
-- ============================================
ALTER TABLE subscription_history ADD COLUMN IF NOT EXISTS transaction_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_history_transaction
  ON subscription_history(transaction_id) WHERE transaction_id IS NOT NULL;
