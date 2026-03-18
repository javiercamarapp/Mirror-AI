-- ============================================================================
-- Mirror-AI: Fixes & Improvements Migration
-- Description: Schema fixes, missing columns, renamed columns, new indexes,
--              constraints, and RLS policies
-- ============================================================================

-- ============================================================================
-- 1. Add body_photo_url to user_profiles
-- ============================================================================
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS body_photo_url TEXT;

-- ============================================================================
-- 2. Add status column to subscription_history
-- ============================================================================
ALTER TABLE subscription_history
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'cancelled'));

-- ============================================================================
-- 3. Add product_id to subscription_history
-- ============================================================================
ALTER TABLE subscription_history
  ADD COLUMN IF NOT EXISTS product_id TEXT;

-- ============================================================================
-- 4. Add type column to purchases
-- ============================================================================
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS type TEXT
    CHECK (type IN ('credit_pack', 'subscription'));

-- ============================================================================
-- 5. Rename outfit_item_ids to item_ids in avatar_renders
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'avatar_renders' AND column_name = 'outfit_item_ids'
  ) THEN
    ALTER TABLE avatar_renders RENAME COLUMN outfit_item_ids TO item_ids;
  END IF;
END $$;

-- ============================================================================
-- 6. Enable RLS on credit_packs with SELECT policy for authenticated users
-- ============================================================================
ALTER TABLE credit_packs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'credit_packs' AND policyname = 'Authenticated users can view credit packs'
  ) THEN
    CREATE POLICY "Authenticated users can view credit packs"
      ON credit_packs FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- ============================================================================
-- 7. Add missing indexes for common query patterns
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_vton_garment ON vton_usage(garment_item_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON post_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON post_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_story_views_user ON story_views(viewer_id);

-- ============================================================================
-- 8. Add NOT NULL constraint on user_profiles.username
--    First backfill any NULLs with empty string, then set NOT NULL + default
-- ============================================================================
UPDATE user_profiles SET username = '' WHERE username IS NULL;

ALTER TABLE user_profiles
  ALTER COLUMN username SET DEFAULT '';

ALTER TABLE user_profiles
  ALTER COLUMN username SET NOT NULL;

-- Also update handle_new_user() to provide a default username
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, email, full_name, avatar_url, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
    ''
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 9. Add CHECK constraint on outfits.item_ids to ensure not empty
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'outfits' AND constraint_name = 'outfits_item_ids_not_empty'
  ) THEN
    ALTER TABLE outfits
      ADD CONSTRAINT outfits_item_ids_not_empty CHECK (array_length(item_ids, 1) > 0);
  END IF;
END $$;

-- ============================================================================
-- 10. Add is_public to wardrobe_items for privacy control
-- ============================================================================
ALTER TABLE wardrobe_items
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;
