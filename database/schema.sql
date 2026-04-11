-- =============================================================
-- FitMatcher – PostgreSQL Schema v3
-- JCE Bridal Boutique E-Commerce
-- =============================================================

-- ----------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS "citext";   -- case-insensitive emails


-- ================================================================
-- 1. USERS
-- ================================================================

CREATE TABLE public.users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT      NOT NULL UNIQUE,
  first_name    TEXT        NOT NULL,
  last_name     TEXT        NOT NULL,
  phone         TEXT,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- 2. USER ADDRESS BOOK
-- ================================================================

CREATE TABLE public.user_addresses (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  label          TEXT,                    -- e.g. Home, Office
  recipient_name TEXT        NOT NULL,
  line1          TEXT        NOT NULL,
  line2          TEXT,
  city           TEXT        NOT NULL,
  province       TEXT,
  postal_code    TEXT,
  country        TEXT        NOT NULL DEFAULT 'PH',
  phone          TEXT,
  is_default     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_addresses_user_id ON public.user_addresses (user_id);


-- ================================================================
-- 3. OTP CODES
-- ================================================================

CREATE TABLE public.otp_codes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        CITEXT      NOT NULL,
  purpose      TEXT        NOT NULL CHECK (purpose IN ('login', 'signup', 'password_reset')),
  code_hash    TEXT        NOT NULL,  -- never store plain OTP
  attempts     INT         NOT NULL DEFAULT 0,
  max_attempts INT         NOT NULL DEFAULT 5,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_email_purpose ON public.otp_codes (email, purpose);
CREATE INDEX idx_otp_expires_at    ON public.otp_codes (expires_at);


-- ================================================================
-- 4. CATEGORIES
-- ================================================================

CREATE TABLE public.categories (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT        NOT NULL UNIQUE,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- 5. SUPPLIERS
--    Moved above gowns — gowns references this table.
-- ================================================================

CREATE TABLE public.suppliers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL UNIQUE,
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes         TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- 6. SUPPLIER SIZE METRICS
--    Each supplier has their own sizing system.
--    Size recommender matches user measurements against
--    the min/max ranges here, not the label.
-- ================================================================

CREATE TABLE public.supplier_size_metrics (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID         NOT NULL REFERENCES public.suppliers (id) ON DELETE CASCADE,
  size_label  TEXT         NOT NULL,  -- e.g. XS, S, M, L, 42, Free Size
  bust_min    NUMERIC(5,2),
  bust_max    NUMERIC(5,2),
  waist_min   NUMERIC(5,2),
  waist_max   NUMERIC(5,2),
  hip_min     NUMERIC(5,2),
  hip_max     NUMERIC(5,2),
  UNIQUE (supplier_id, size_label)
);


-- ================================================================
-- 7. GOWNS
-- ================================================================

CREATE TABLE public.gowns (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID          REFERENCES public.suppliers (id) ON DELETE SET NULL,
  category_id UUID          REFERENCES public.categories (id) ON DELETE SET NULL,
  sku         TEXT          NOT NULL UNIQUE,
  name        TEXT          NOT NULL,
  description TEXT,
  color         TEXT,
  silhouette    TEXT,
  fabric        TEXT,
  neckline      TEXT,
  embellishment TEXT,
  size_chart    JSONB,
  sale_price  NUMERIC(12,2) NOT NULL CHECK (sale_price >= 0),
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gowns_category ON public.gowns (category_id);
CREATE INDEX idx_gowns_active   ON public.gowns (is_active);


-- ================================================================
-- 8. GOWN IMAGES
--    is_tryon_asset flags the clean cutout used for AR overlay.
-- ================================================================

CREATE TABLE public.gown_images (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  gown_id        UUID    NOT NULL REFERENCES public.gowns (id) ON DELETE CASCADE,
  image_url      TEXT    NOT NULL,
  alt            TEXT,
  sort_order     INT     NOT NULL DEFAULT 0,
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  is_tryon_asset BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_gown_images_gown ON public.gown_images (gown_id);


-- ================================================================
-- 9. GOWN INVENTORY
-- ================================================================

CREATE TABLE public.gown_inventory (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gown_id      UUID NOT NULL REFERENCES public.gowns (id) ON DELETE CASCADE,
  size_label   TEXT NOT NULL,
  stock_qty    INT  NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty INT  NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  UNIQUE (gown_id, size_label)
);


-- ================================================================
-- 10. ORDERS
-- ================================================================

CREATE TABLE public.orders (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number   TEXT          NOT NULL UNIQUE,  -- e.g. JCE-20260409-0001
  user_id        UUID          REFERENCES public.users (id) ON DELETE SET NULL,
  customer_email CITEXT        NOT NULL,
  customer_name  TEXT          NOT NULL,
  customer_phone TEXT,
  status         TEXT          NOT NULL DEFAULT 'placed'
                   CHECK (status IN (
                     'placed', 'pending_payment', 'paid', 'processing',
                     'ready', 'shipped', 'completed', 'cancelled', 'refunded'
                   )),
  payment_method TEXT          NOT NULL CHECK (payment_method IN ('gcash', 'bdo', 'cash')),
  payment_status TEXT          NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
  subtotal       NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  shipping_fee   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  total          NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  notes          TEXT,
  placed_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id ON public.orders (user_id);
CREATE INDEX idx_orders_email   ON public.orders (customer_email);
CREATE INDEX idx_orders_status  ON public.orders (status);


-- ================================================================
-- 11. ORDER ITEMS
-- ================================================================

CREATE TABLE public.order_items (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID          NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  gown_id    UUID          REFERENCES public.gowns (id) ON DELETE SET NULL,
  gown_name  TEXT          NOT NULL,           -- snapshot at purchase time
  size_label TEXT,
  quantity   INT           NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX idx_order_items_order ON public.order_items (order_id);


-- ================================================================
-- 12. PAYMENTS
-- ================================================================

CREATE TABLE public.payments (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID          NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  method          TEXT          NOT NULL CHECK (method IN ('gcash', 'bdo', 'cash')),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  reference_no    TEXT,
  proof_image_url TEXT,
  paid_at         TIMESTAMPTZ,
  status          TEXT          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'verified', 'rejected', 'refunded')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_order ON public.payments (order_id);


-- ================================================================
-- 13. FAVORITES
-- ================================================================

CREATE TABLE public.favorites (
  user_id    UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  gown_id    UUID        NOT NULL REFERENCES public.gowns (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, gown_id)
);


-- ================================================================
-- 14. USER MEASUREMENTS  (size recommender)
--     source: camera = estimated by size recommender,
--             manual = typed by user,
--             tape   = measured by staff
-- ================================================================

CREATE TABLE public.user_measurements (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL UNIQUE REFERENCES public.users (id) ON DELETE CASCADE,
  height_cm   NUMERIC(5,1),
  weight_kg   NUMERIC(5,1),
  bust_cm     NUMERIC(5,1),
  waist_cm    NUMERIC(5,1),
  hips_cm     NUMERIC(5,1),
  source      TEXT        NOT NULL DEFAULT 'manual'
                CHECK (source IN ('camera', 'manual', 'tape')),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- 15. USER STYLE PREFERENCES  (style recommender)
-- ================================================================

CREATE TABLE public.user_style_preferences (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL UNIQUE REFERENCES public.users (id) ON DELETE CASCADE,
  body_type             TEXT,                          -- e.g. hourglass, pear, rectangle
  skin_tone             TEXT,                          -- e.g. fair, medium, deep
  style_tags            JSONB       NOT NULL DEFAULT '[]',
  preferred_silhouettes JSONB       NOT NULL DEFAULT '[]',
  preferred_colors      JSONB       NOT NULL DEFAULT '[]',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- 16. AR FIT PROFILES  (virtual try-on)
-- ================================================================

CREATE TABLE public.ar_fit_profiles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL UNIQUE REFERENCES public.users (id) ON DELETE CASCADE,
  profile    JSONB       NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- TRIGGERS — keep updated_at current automatically
-- ================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_gowns_updated_at
  BEFORE UPDATE ON public.gowns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_style_prefs_updated_at
  BEFORE UPDATE ON public.user_style_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ar_profiles_updated_at
  BEFORE UPDATE ON public.ar_fit_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();