-- ============================================================================
-- Migration 008: Production Hardening
-- Fix race conditions, add missing indexes, RLS policies, atomic operations,
-- soft delete functions, data retention logging, and wardrobe stats view.
-- ============================================================================

-- ============================================
-- A) ATOMIC CREDIT OPERATIONS WITH ROW LOCKING
-- ============================================

-- Improve decrement_credits with FOR UPDATE row locking and idempotency
CREATE OR REPLACE FUNCTION decrement_credits(
  p_user_id UUID,
  p_amount INT DEFAULT 1,
  p_request_id TEXT DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  current_credits INT;
  new_credits INT;
BEGIN
  -- Idempotency: if a request_id was already processed, return current credits
  IF p_request_id IS NOT NULL THEN
    SELECT vton_credits INTO current_credits
    FROM user_profiles
    WHERE id = p_user_id;

    -- Check if this request_id was already used in vton_usage
    IF EXISTS (
      SELECT 1 FROM vton_usage WHERE request_id = p_request_id
    ) THEN
      RETURN current_credits;
    END IF;
  END IF;

  -- Lock the row to prevent concurrent modifications
  SELECT vton_credits INTO current_credits
  FROM user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF current_credits IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF current_credits < p_amount THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  new_credits := current_credits - p_amount;

  UPDATE user_profiles
  SET vton_credits = new_credits
  WHERE id = p_user_id;

  RETURN new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic credit increment for webhook safety (renewals, credit purchases)
CREATE OR REPLACE FUNCTION increment_credits_atomic(
  p_user_id UUID,
  p_amount INT,
  p_request_id TEXT DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  new_credits INT;
BEGIN
  -- Idempotency: if a request_id was already processed, return current credits
  IF p_request_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM subscription_history WHERE transaction_id = p_request_id
    ) OR EXISTS (
      SELECT 1 FROM purchases WHERE transaction_id = p_request_id
    ) THEN
      SELECT vton_credits INTO new_credits
      FROM user_profiles
      WHERE id = p_user_id;
      RETURN new_credits;
    END IF;
  END IF;

  -- Lock the row and increment
  UPDATE user_profiles
  SET vton_credits = vton_credits + p_amount
  WHERE id = p_user_id
  RETURNING vton_credits INTO new_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add request_id column to vton_usage for idempotency tracking
ALTER TABLE vton_usage ADD COLUMN IF NOT EXISTS request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vton_usage_request_id
  ON vton_usage(request_id) WHERE request_id IS NOT NULL;


-- ============================================
-- B) ATOMIC COUNTER FUNCTIONS
-- ============================================

-- Generic increment_counter function with FOR UPDATE locking
CREATE OR REPLACE FUNCTION increment_counter(
  p_table TEXT,
  p_column TEXT,
  p_row_id UUID,
  p_delta INT DEFAULT 1
)
RETURNS INT AS $$
DECLARE
  new_val INT;
  query TEXT;
BEGIN
  -- Validate table/column to prevent SQL injection
  IF p_table NOT IN ('social_posts', 'stories', 'post_comments') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table;
  END IF;

  IF p_column NOT IN ('likes_count', 'comments_count', 'views_count') THEN
    RAISE EXCEPTION 'Invalid column: %', p_column;
  END IF;

  -- Lock the row, update, and return new value
  query := format(
    'UPDATE %I SET %I = GREATEST(COALESCE(%I, 0) + $1, 0) WHERE id = $2 RETURNING %I',
    p_table, p_column, p_column, p_column
  );

  EXECUTE query INTO new_val USING p_delta, p_row_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Row not found in %.id = %', p_table, p_row_id;
  END IF;

  RETURN new_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Convenience wrappers for specific counters
CREATE OR REPLACE FUNCTION increment_story_views(p_story_id UUID)
RETURNS INT AS $$
BEGIN
  RETURN increment_counter('stories', 'views_count', p_story_id, 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_post_likes(p_post_id UUID, p_delta INT DEFAULT 1)
RETURNS INT AS $$
BEGIN
  RETURN increment_counter('social_posts', 'likes_count', p_post_id, p_delta);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_post_comments(p_post_id UUID, p_delta INT DEFAULT 1)
RETURNS INT AS $$
BEGIN
  RETURN increment_counter('social_posts', 'comments_count', p_post_id, p_delta);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- C) MISSING INDEXES
-- ============================================

-- Story views by viewer with recency ordering
CREATE INDEX IF NOT EXISTS idx_story_views_viewer
  ON story_views(viewer_id, created_at DESC);

-- Active comments on a post (excluding soft-deleted)
-- Note: idx_comments_post_active may already exist from 007 but IF NOT EXISTS is safe
CREATE INDEX IF NOT EXISTS idx_post_comments_post_active
  ON post_comments(post_id, created_at) WHERE deleted_at IS NULL;

-- Public posts by user (excluding soft-deleted)
CREATE INDEX IF NOT EXISTS idx_social_posts_user_public
  ON social_posts(user_id, is_public) WHERE deleted_at IS NULL;

-- Bidirectional friendship lookups
CREATE INDEX IF NOT EXISTS idx_friendships_bidirectional
  ON friendships(addressee_id, requester_id, status);


-- ============================================
-- D) MISSING RLS POLICIES
-- ============================================

-- analytics_events: admin-only read
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Admin read analytics_events" ON analytics_events;
  CREATE POLICY "Admin read analytics_events" ON analytics_events
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid()
        AND moderation_status = 'active'
        AND id = ANY(string_to_array(current_setting('app.admin_ids', true), ',')::uuid[])
      )
    );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- moderation_actions: admin-only
ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manage moderation_actions" ON moderation_actions;
CREATE POLICY "Admin manage moderation_actions" ON moderation_actions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND moderation_status = 'active'
      AND id = ANY(string_to_array(current_setting('app.admin_ids', true), ',')::uuid[])
    )
  );


-- ============================================
-- E) SUBSCRIPTION IDEMPOTENCY
-- ============================================

-- Unique index on transaction_id to prevent duplicate webhook processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_history_txn_id
  ON subscription_history(transaction_id) WHERE transaction_id IS NOT NULL;


-- ============================================
-- F) DATA RETENTION WITH LOGGING
-- ============================================

-- Cleanup log table
CREATE TABLE IF NOT EXISTS cleanup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ DEFAULT NOW(),
  analytics_deleted INT DEFAULT 0,
  stories_deleted INT DEFAULT 0,
  rate_limits_cleaned BOOLEAN DEFAULT FALSE,
  posts_purged INT DEFAULT 0,
  comments_purged INT DEFAULT 0,
  duration_ms INT DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_cleanup_log_run ON cleanup_log(run_at DESC);

-- Replace cleanup_old_data with logged version
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS UUID AS $$
DECLARE
  log_id UUID;
  v_analytics INT;
  v_stories INT;
  v_posts INT;
  v_comments INT;
  v_start TIMESTAMPTZ;
BEGIN
  v_start := clock_timestamp();
  log_id := gen_random_uuid();

  -- Delete analytics events older than 90 days
  DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_analytics = ROW_COUNT;

  -- Delete expired stories and their views (older than 48h past expiry)
  DELETE FROM story_views WHERE story_id IN (
    SELECT id FROM stories WHERE expires_at < NOW() - INTERVAL '48 hours'
  );
  DELETE FROM stories WHERE expires_at < NOW() - INTERVAL '48 hours';
  GET DIAGNOSTICS v_stories = ROW_COUNT;

  -- Clean old rate limit entries
  PERFORM clean_rate_limits();

  -- Purge soft-deleted records older than 30 days
  DELETE FROM social_posts WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_posts = ROW_COUNT;

  DELETE FROM post_comments WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_comments = ROW_COUNT;

  -- Log the cleanup run
  INSERT INTO cleanup_log (id, analytics_deleted, stories_deleted, rate_limits_cleaned, posts_purged, comments_purged, duration_ms)
  VALUES (
    log_id,
    v_analytics,
    v_stories,
    TRUE,
    v_posts,
    v_comments,
    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT
  );

  RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- G) SOFT DELETE FUNCTIONS
-- ============================================

-- Soft delete a post (sets deleted_at instead of hard deleting)
CREATE OR REPLACE FUNCTION soft_delete_post(p_post_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  UPDATE social_posts
  SET deleted_at = NOW()
  WHERE id = p_post_id
    AND user_id = p_user_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  RETURN v_found > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Soft delete a comment (sets deleted_at instead of hard deleting)
CREATE OR REPLACE FUNCTION soft_delete_comment(p_comment_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  UPDATE post_comments
  SET deleted_at = NOW()
  WHERE id = p_comment_id
    AND user_id = p_user_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  RETURN v_found > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- H) WARDROBE STATS MATERIALIZED VIEW
-- ============================================

CREATE MATERIALIZED VIEW IF NOT EXISTS wardrobe_user_stats AS
SELECT
  user_id,
  COUNT(*) AS total_items,
  COUNT(*) FILTER (WHERE category IS NOT NULL) AS categorized_items,
  jsonb_object_agg(
    COALESCE(category, 'uncategorized'),
    cat_count
  ) AS category_counts,
  jsonb_object_agg(
    COALESCE(color, 'unknown'),
    color_count
  ) FILTER (WHERE color IS NOT NULL) AS color_counts,
  jsonb_object_agg(
    COALESCE(season, 'all-season'),
    season_count
  ) FILTER (WHERE season IS NOT NULL) AS season_counts
FROM (
  SELECT
    user_id,
    category,
    color,
    season,
    COUNT(*) OVER (PARTITION BY user_id, category) AS cat_count,
    COUNT(*) OVER (PARTITION BY user_id, color) AS color_count,
    COUNT(*) OVER (PARTITION BY user_id, season) AS season_count,
    ROW_NUMBER() OVER (PARTITION BY user_id, category ORDER BY created_at) AS cat_rn,
    ROW_NUMBER() OVER (PARTITION BY user_id, color ORDER BY created_at) AS color_rn,
    ROW_NUMBER() OVER (PARTITION BY user_id, season ORDER BY created_at) AS season_rn
  FROM wardrobe_items
) sub
WHERE cat_rn = 1
GROUP BY user_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wardrobe_user_stats_user
  ON wardrobe_user_stats(user_id);

-- Refresh function for the materialized view
CREATE OR REPLACE FUNCTION refresh_wardrobe_user_stats()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY wardrobe_user_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
