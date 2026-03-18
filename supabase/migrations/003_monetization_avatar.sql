-- ─── 003: Monetization & Avatar System ────────────────────────────────────────

-- Purchases (IAP receipts)
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  transaction_id TEXT UNIQUE,
  receipt_data TEXT,
  platform TEXT DEFAULT 'ios',
  amount NUMERIC,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'refunded', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscription history
CREATE TABLE IF NOT EXISTS subscription_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'basic', 'premium')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  receipt_data TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User avatars (premium feature)
CREATE TABLE IF NOT EXISTS user_avatars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  base_image_url TEXT,
  style TEXT DEFAULT 'realistic' CHECK (style IN ('realistic', 'anime', 'cartoon', '3d', 'fashion_sketch')),
  skin_tone TEXT,
  hair_style TEXT,
  body_type TEXT,
  customizations JSONB DEFAULT '{}'::jsonb,
  is_premium BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Avatar outfit renders (cached VTON results for avatar)
CREATE TABLE IF NOT EXISTS avatar_renders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  avatar_id UUID REFERENCES user_avatars(id) ON DELETE CASCADE,
  outfit_item_ids UUID[],
  render_url TEXT NOT NULL,
  style TEXT DEFAULT 'realistic',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Credit packs purchase options
CREATE TABLE IF NOT EXISTS credit_packs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  price_usd NUMERIC NOT NULL,
  product_id TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true
);

-- Seed credit packs
INSERT INTO credit_packs (name, credits, price_usd, product_id) VALUES
  ('5 Credits', 5, 1.99, 'com.mirrorai.credits.5'),
  ('15 Credits', 15, 4.99, 'com.mirrorai.credits.15'),
  ('50 Credits', 50, 14.99, 'com.mirrorai.credits.50')
ON CONFLICT (product_id) DO NOTHING;

-- ─── RLS Policies ────────────────────────────────────────────────────────────

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_avatars ENABLE ROW LEVEL SECURITY;
ALTER TABLE avatar_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own purchases" ON purchases
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own subscriptions" ON subscription_history
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own avatar" ON user_avatars
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own renders" ON avatar_renders
  FOR ALL USING (auth.uid() = user_id);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_transaction ON purchases(transaction_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscription_history(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscription_history(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_avatar_renders_user ON avatar_renders(user_id);
CREATE INDEX IF NOT EXISTS idx_avatar_renders_avatar ON avatar_renders(avatar_id);

-- ─── Auto-update timestamp trigger for user_avatars ──────────────────────────

CREATE TRIGGER set_avatar_updated_at
  BEFORE UPDATE ON user_avatars
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
