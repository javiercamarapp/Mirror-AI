-- ============================================================================
-- Migration 005: App Store Readiness Fixes
-- Indexes, constraints, RLS, content moderation, and data integrity
-- ============================================================================

-- ============================================
-- 1. MISSING INDEXES (Performance)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_outfits_user_created ON outfits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_outfits_user_created ON daily_outfits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_user_created ON social_posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_user_expires ON stories(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_user_created ON purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscription_history(user_id, status);

-- GIN indexes for array columns (wardrobe filtering)
CREATE INDEX IF NOT EXISTS idx_wardrobe_season_gin ON wardrobe_items USING GIN(season);
CREATE INDEX IF NOT EXISTS idx_wardrobe_occasions_gin ON wardrobe_items USING GIN(occasions);
CREATE INDEX IF NOT EXISTS idx_wardrobe_tags_gin ON wardrobe_items USING GIN(tags);

-- Trigram index for user search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_user_profiles_fullname_trgm ON user_profiles USING GIST(full_name gist_trgm_ops);

-- ============================================
-- 2. NOT NULL CONSTRAINTS
-- ============================================
ALTER TABLE outfits ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE daily_outfits ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE social_posts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE stories ALTER COLUMN user_id SET NOT NULL;

-- ============================================
-- 3. MISSING UPDATED_AT TRIGGERS
-- ============================================
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_outfits BEFORE UPDATE ON outfits FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_posts BEFORE UPDATE ON social_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_stories BEFORE UPDATE ON stories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 4. SELF-REFERRAL PREVENTION
-- ============================================
ALTER TABLE user_profiles ADD CONSTRAINT no_self_referral CHECK (referred_by IS NULL OR referred_by != id);

-- ============================================
-- 5. BIDIRECTIONAL FRIENDSHIP UNIQUENESS
-- Using a function-based approach since we can't ALTER existing constraint easily
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_friendship_pair
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

-- ============================================
-- 6. CONTENT MODERATION TABLES
-- ============================================
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('post', 'comment', 'story', 'user')),
  content_id UUID NOT NULL,
  reported_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('sexual_content', 'harassment', 'spam', 'hate_speech', 'violence', 'misinformation', 'other')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'action_taken', 'dismissed')),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_status ON content_reports(status, created_at DESC);
CREATE INDEX idx_reports_content ON content_reports(content_type, content_id);

-- User blocks table
CREATE TABLE IF NOT EXISTS user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);

CREATE INDEX idx_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX idx_blocks_blocked ON user_blocks(blocked_id);

-- RLS for content_reports
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create reports" ON content_reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Users can view own reports" ON content_reports FOR SELECT USING (auth.uid() = reporter_id);

-- RLS for user_blocks
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own blocks" ON user_blocks FOR ALL USING (auth.uid() = blocker_id);

-- ============================================
-- 7. AVATAR RENDERS RLS (was missing)
-- Note: RLS was already enabled and policy created in 003_monetization_avatar.sql,
-- but we ensure it here for safety.
-- ============================================
ALTER TABLE avatar_renders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users manage own renders" ON avatar_renders FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 8. ADD transaction_id TO PURCHASES (for idempotency)
-- Note: transaction_id column already exists from 003 with UNIQUE constraint.
-- We add a partial unique index as a safety measure for non-null values.
-- ============================================
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS transaction_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_transaction_unique ON purchases(transaction_id) WHERE transaction_id IS NOT NULL;

-- ============================================
-- 9. SUBSCRIPTION EXPIRY FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION expire_subscriptions()
RETURNS void AS $$
BEGIN
  -- Mark expired subscriptions
  UPDATE subscription_history SET status = 'expired'
  WHERE status = 'active' AND expires_at < NOW();

  -- Downgrade users with no active subscription
  UPDATE user_profiles SET subscription_plan = 'free', vton_credits = LEAST(vton_credits, 3)
  WHERE subscription_plan != 'free'
  AND id NOT IN (
    SELECT user_id FROM subscription_history WHERE status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 10. ATOMIC CREDIT DECREMENT FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION decrement_credits(p_user_id UUID, p_amount INT DEFAULT 1)
RETURNS INT AS $$
DECLARE
  new_credits INT;
BEGIN
  UPDATE user_profiles
  SET vton_credits = GREATEST(vton_credits - p_amount, 0)
  WHERE id = p_user_id AND vton_credits >= p_amount
  RETURNING vton_credits INTO new_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  RETURN new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
