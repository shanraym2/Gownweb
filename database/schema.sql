-- =============================================================
-- JCE Bridal Boutique — Canonical Schema
-- Matches live DB as of dump (PostgreSQL 18.3)
-- =============================================================
-- Run order matters — tables with FK dependencies come after
-- the tables they reference.
-- =============================================================

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "citext"   WITH SCHEMA public;


-- =============================================================
-- FUNCTION: auto-update updated_at on row change
-- =============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- =============================================================
-- USERS
-- =============================================================

CREATE TABLE public.users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext      NOT NULL UNIQUE,
  first_name    text        NOT NULL,
  last_name     text        NOT NULL,
  phone         text,
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'customer'
                            CHECK (role IN ('customer', 'staff', 'admin')),
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- DEVICE TOKENS  (trust-this-device after OTP)
-- =============================================================

CREATE TABLE public.device_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_tokens_hash    ON public.device_tokens(token_hash);
CREATE INDEX idx_device_tokens_user_id ON public.device_tokens(user_id);


-- =============================================================
-- USER ADDRESSES
-- =============================================================

CREATE TABLE public.user_addresses (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label          text,
  recipient_name text        NOT NULL,
  line1          text        NOT NULL,
  line2          text,
  city           text        NOT NULL,
  province       text,
  postal_code    text,
  country        text        NOT NULL DEFAULT 'PH',
  phone          text,
  is_default     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_addresses_user_id ON public.user_addresses(user_id);


-- =============================================================
-- OTP CODES
-- =============================================================

CREATE TABLE public.otp_codes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext      NOT NULL,
  purpose      text        NOT NULL
               CHECK (purpose IN ('login', 'signup', 'password_reset')),
  code_hash    text        NOT NULL,
  attempts     int         NOT NULL DEFAULT 0,
  max_attempts int         NOT NULL DEFAULT 5,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_email_purpose ON public.otp_codes(email, purpose);
CREATE INDEX idx_otp_expires_at    ON public.otp_codes(expires_at);


-- =============================================================
-- CATEGORIES
-- =============================================================

CREATE TABLE public.categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text        NOT NULL UNIQUE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- =============================================================
-- SUPPLIERS
-- =============================================================

CREATE TABLE public.suppliers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL UNIQUE,
  contact_name  text,
  contact_email text,
  contact_phone text,
  notes         text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.supplier_size_metrics (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid        NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  size_label  text        NOT NULL,
  bust_min    numeric(5,2),
  bust_max    numeric(5,2),
  waist_min   numeric(5,2),
  waist_max   numeric(5,2),
  hip_min     numeric(5,2),
  hip_max     numeric(5,2),
  UNIQUE (supplier_id, size_label)
);


-- =============================================================
-- GOWNS
-- =============================================================

CREATE TABLE public.gowns (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       uuid         REFERENCES public.suppliers(id)  ON DELETE SET NULL,
  category_id       uuid         REFERENCES public.categories(id) ON DELETE SET NULL,
  sku               text         NOT NULL UNIQUE,
  name              text         NOT NULL,
  description       text,
  color             text,
  silhouette        text,
  fabric            text,
  neckline          text,
  embellishment     text,
  size_chart        jsonb,
  sale_price        numeric(12,2) NOT NULL CHECK (sale_price >= 0),
  is_active         boolean       NOT NULL DEFAULT true,
  -- Product type displayed in admin UI
  type              text          NOT NULL DEFAULT 'Gowns',
  -- Optional calibration hints for the Virtual Try-On overlay.
  -- Fields: necklineY (0–0.3), waistY (0.2–0.7), hemY (0.7–1),
  --         shoulderPad (1–2.5), skirtFlare (1–2).
  -- NULL = use frontend defaults.
  tryon_calibration jsonb         DEFAULT NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_gowns_category ON public.gowns(category_id);
CREATE INDEX idx_gowns_active   ON public.gowns(is_active);

CREATE TRIGGER trg_gowns_updated_at
  BEFORE UPDATE ON public.gowns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- GOWN IMAGES
-- =============================================================

CREATE TABLE public.gown_images (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  gown_id        uuid    NOT NULL REFERENCES public.gowns(id) ON DELETE CASCADE,
  image_url      text    NOT NULL,
  alt            text,
  sort_order     int     NOT NULL DEFAULT 0,
  is_primary     boolean NOT NULL DEFAULT false,
  -- When true, this image is used exclusively for the Virtual Try-On overlay
  -- (ideally a transparent PNG of the isolated gown).
  is_tryon_asset boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_gown_images_gown  ON public.gown_images(gown_id);
-- Partial index — only indexes the (typically one) try-on asset per gown
CREATE INDEX idx_gown_images_tryon ON public.gown_images(gown_id)
  WHERE is_tryon_asset = true;


-- =============================================================
-- GOWN INVENTORY
-- =============================================================

CREATE TABLE public.gown_inventory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gown_id     uuid NOT NULL REFERENCES public.gowns(id) ON DELETE CASCADE,
  size_label  text NOT NULL,
  stock_qty   int  NOT NULL DEFAULT 0 CHECK (stock_qty   >= 0),
  reserved_qty int NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  UNIQUE (gown_id, size_label)
);

-- =============================================================
-- GOWN INVENTORY LOG  (stock adjustment history)
-- =============================================================

CREATE TABLE public.gown_inventory_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  gown_id    uuid        NOT NULL REFERENCES public.gowns(id)  ON DELETE CASCADE,
  size_label text        NOT NULL,
  old_stock  int         NOT NULL,
  new_stock  int         NOT NULL,
  -- Computed delta — never write this column directly
  delta      int         GENERATED ALWAYS AS (new_stock - old_stock) STORED,
  changed_by uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_log_gown
  ON public.gown_inventory_log(gown_id, created_at DESC);


-- =============================================================
-- ORDERS
-- =============================================================

-- Sequence replaces the MAX() query approach — eliminates race condition
-- when two orders are placed simultaneously.
-- Usage: SELECT nextval('order_seq') AS n  →  JCE-YYYYMMDD-{n padded to 4}
CREATE SEQUENCE IF NOT EXISTS public.order_seq
  START 1 INCREMENT 1 MINVALUE 1 NO MAXVALUE CACHE 1;

CREATE TABLE public.orders (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     text         NOT NULL UNIQUE,
  user_id          uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  customer_email   citext       NOT NULL,
  customer_name    text         NOT NULL,
  customer_phone   text,

  status           text         NOT NULL DEFAULT 'placed'
                   CHECK (status IN (
                     'placed', 'pending_payment', 'paid', 'processing',
                     'ready', 'shipped', 'completed', 'cancelled', 'refunded'
                   )),

  payment_method   text         NOT NULL
                   CHECK (payment_method IN ('gcash', 'bdo', 'cash')),

  payment_status   text         NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN (
                     'unpaid', 'pending', 'paid', 'failed', 'refunded'
                   )),

  delivery_method  text         NOT NULL DEFAULT 'pickup'
                   CHECK (delivery_method IN ('pickup', 'lalamove')),
  delivery_address text,

  subtotal         numeric(12,2) NOT NULL CHECK (subtotal      >= 0),
  discount_total   numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  shipping_fee     numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping_fee   >= 0),
  total            numeric(12,2) NOT NULL CHECK (total          >= 0),

  notes            text,
  placed_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_id ON public.orders(user_id);
CREATE INDEX idx_orders_email   ON public.orders(customer_email);
CREATE INDEX idx_orders_status  ON public.orders(status);

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- ORDER ITEMS
-- =============================================================

CREATE TABLE public.order_items (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid         NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  gown_id    uuid         REFERENCES public.gowns(id) ON DELETE SET NULL,
  gown_name  text         NOT NULL,
  size_label text,
  quantity   int          NOT NULL CHECK (quantity   > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(12,2) NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX idx_order_items_order ON public.order_items(order_id);


-- =============================================================
-- PAYMENTS
-- =============================================================

CREATE TABLE public.payments (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid         NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  method          text         NOT NULL CHECK (method IN ('gcash', 'bdo', 'cash')),
  amount          numeric(12,2) NOT NULL CHECK (amount >= 0),
  reference_no    text,
  -- NOTE: proof_image_url currently stores base64 data URLs.
  -- TODO: migrate to disk/object storage and store only the URL path.
  proof_image_url text,
  paid_at         timestamptz,
  status          text         NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'verified', 'rejected', 'refunded')),
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_order ON public.payments(order_id);


-- =============================================================
-- FAVORITES
-- =============================================================

CREATE TABLE public.favorites (
  user_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  gown_id    uuid        NOT NULL REFERENCES public.gowns(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gown_id)
);


-- =============================================================
-- USER MEASUREMENTS  (size recommender)
-- =============================================================

CREATE TABLE public.user_measurements (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  height_cm   numeric(5,1),
  weight_kg   numeric(5,1),
  bust_cm     numeric(5,1),
  waist_cm    numeric(5,1),
  hips_cm     numeric(5,1),
  source      text        NOT NULL DEFAULT 'manual'
              CHECK (source IN ('camera', 'manual', 'tape')),
  measured_at timestamptz NOT NULL DEFAULT now()
);


-- =============================================================
-- USER STYLE PREFERENCES
-- =============================================================

CREATE TABLE public.user_style_preferences (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  body_type            text,
  skin_tone            text,
  style_tags           jsonb       NOT NULL DEFAULT '[]',
  preferred_silhouettes jsonb      NOT NULL DEFAULT '[]',
  preferred_colors     jsonb       NOT NULL DEFAULT '[]',
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_style_prefs_updated_at
  BEFORE UPDATE ON public.user_style_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- AR FIT PROFILES
-- =============================================================

CREATE TABLE public.ar_fit_profiles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  profile    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_ar_profiles_updated_at
  BEFORE UPDATE ON public.ar_fit_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================
-- CMS: HERO SLIDES
-- =============================================================

CREATE TABLE public.cms_hero_slides (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url  text        NOT NULL,
  subtitle   text        NOT NULL DEFAULT '',
  heading    text        NOT NULL DEFAULT '',
  body       text        NOT NULL DEFAULT '',
  sort_order int         NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_cms_hero_updated
  BEFORE UPDATE ON public.cms_hero_slides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Default slides (matches original hardcoded hero carousel)
INSERT INTO public.cms_hero_slides (image_url, subtitle, heading, body, sort_order) VALUES
  ('/images/weds.jpg',   'DESIGNER COLLECTION', 'Your New\nDream Look.',
   'JCE Bridal Boutique is your destination for designer and comfortable wedding gowns for your special day.', 0),
  ('/images/image1.png', 'LUXURY GOWNS',        'Timeless\nElegance.',
   'From classic silhouettes to modern couture — discover the gown that was made for you.', 1),
  ('/images/image2.png', 'BRIDAL READY',         'Walk Down\nIn Style.',
   'Every stitch crafted with love. Every detail designed to make you shine on your most beautiful day.', 2)
ON CONFLICT DO NOTHING;


-- =============================================================
-- CMS: TESTIMONIALS
-- =============================================================

CREATE TABLE public.cms_testimonials (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_text  text        NOT NULL,
  author_name text        NOT NULL,
  image_url   text,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Default testimonial
INSERT INTO public.cms_testimonials (quote_text, author_name, image_url, sort_order) VALUES
  ('I have always had difficulties with buying clothes for every-day wear. Therefore, together with Linda, we decided to create our own brand.',
   'Karina Ayacocho', '/images/image2.png', 0)
ON CONFLICT DO NOTHING;


-- =============================================================
-- CMS: CONTENT BLOCKS  (About, Collection Spotlight, Contact, Footer, Theme)
-- =============================================================

CREATE TABLE public.cms_content_blocks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  section    text        NOT NULL UNIQUE
             CHECK (section IN (
               'about', 'collection-spotlight', 'contact', 'footer', 'theme-config'
             )),
  fields     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_cms_blocks_updated
  BEFORE UPDATE ON public.cms_content_blocks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Default content
INSERT INTO public.cms_content_blocks (section, fields) VALUES
  ('about', '{
    "eyebrow_label": "ABOUT US",
    "heading": "Comfort and Quality Come First.",
    "body_1": "JCE Bridal has always dreamed of comfortable women''s clothing that would look appropriate in any circumstances.",
    "body_2": "This is how the JCE Bridal brand appeared — it is a brand for women who like to feel confident, seductive, and stylish in any situation.",
    "image_url": "/images/aboutus.png"
  }'::jsonb),
  ('collection-spotlight', '{
    "eyebrow_label": "THE COLLECTION",
    "heading": "Handpicked Elegance"
  }'::jsonb),
  ('contact', '{
    "heading": "Get in Touch",
    "subheading": "We''d love to hear from you.",
    "address": "4I-19 Soler Wing 168 Mall Recto Mla, Manila, Philippines",
    "phone": "0917 843 2531",
    "email": "jceboutique@gmail.com",
    "hours": "Mon - Sat  10:00 AM - 7:00 PM\nPhilippine Standard Time",
    "facebook": "https://www.facebook.com/JCEbridalboutique",
    "instagram": "#",
    "map_embed_url": ""
  }'::jsonb),
  ('footer', '{
    "brand_name": "JCE Bridal.",
    "instagram": "#",
    "facebook": "#",
    "pinterest": "#",
    "copyright": "© 2026 JCE Bridal Boutique. All rights reserved."
  }'::jsonb),
  ('theme-config', '{
    "colors": { "navBg": "#1a1a2e", "primary": "#c8a96e" },
    "fonts":  { "body": "Jost, sans-serif" }
  }'::jsonb)
ON CONFLICT (section) DO NOTHING;


-- =============================================================
-- Migration: fix tryon-asset uniqueness + performance index
-- Apply BEFORE deploying the updated admin gowns route.
-- =============================================================

-- FIX #9 ─────────────────────────────────────────────────────
-- Add a unique partial index on gown_images so that each gown
-- can have at most ONE is_tryon_asset = TRUE row.
-- This makes the ON CONFLICT (gown_id, is_tryon_asset) WHERE
-- is_tryon_asset = TRUE clause in the PUT route work correctly.
--
-- IMPORTANT: if any gown already has duplicate tryon rows,
-- deduplicate first:
--
--   DELETE FROM gown_images
--   WHERE id NOT IN (
--     SELECT DISTINCT ON (gown_id) id
--     FROM gown_images
--     WHERE is_tryon_asset = TRUE
--     ORDER BY gown_id, sort_order, id
--   )
--   AND is_tryon_asset = TRUE;
--
-- Then create the index:

CREATE UNIQUE INDEX IF NOT EXISTS uidx_gown_images_tryon_asset
  ON public.gown_images (gown_id)
  WHERE is_tryon_asset = TRUE;

-- FIX: Performance index on gowns.updated_at ─────────────────
-- The admin GET query uses ORDER BY g.updated_at DESC.
-- Without an index this is a full sequential scan.

CREATE INDEX IF NOT EXISTS idx_gowns_updated_at
  ON public.gowns (updated_at DESC);

  -- =============================================================
-- Migration: fix tryon-asset uniqueness + performance index
-- Apply BEFORE deploying the updated admin gowns route.
-- =============================================================

-- FIX #9 ─────────────────────────────────────────────────────
-- Add is_tryon_back column to gown_images for back-view try-on asset.
-- Run this first so the route can insert/query it.

ALTER TABLE public.gown_images
  ADD COLUMN IF NOT EXISTS is_tryon_back boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_gown_images_tryon_back ON public.gown_images(gown_id)
  WHERE is_tryon_back = TRUE;

-- Unique partial index for front tryon asset (one per gown)
-- First deduplicate if needed:
--
--   DELETE FROM gown_images
--   WHERE id NOT IN (
--     SELECT DISTINCT ON (gown_id) id
--     FROM gown_images
--     WHERE is_tryon_asset = TRUE
--     ORDER BY gown_id, sort_order, id
--   )
--   AND is_tryon_asset = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_gown_images_tryon_asset
  ON public.gown_images (gown_id)
  WHERE is_tryon_asset = TRUE;

-- Performance index on gowns.updated_at
CREATE INDEX IF NOT EXISTS idx_gowns_updated_at
  ON public.gowns (updated_at DESC);

  -- =============================================================
-- Migration: order_status_log
-- Tracks every order status change with timestamp + optional note.
-- Apply this before deploying the updated admin orders PATCH handler.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.order_status_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status     text        NOT NULL,
  note       text,
  changed_by uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_log_order
  ON public.order_status_log(order_id, changed_at DESC);

-- Backfill: seed a "placed" event for all existing orders using placed_at.
-- Run once after creating the table.
INSERT INTO public.order_status_log (order_id, status, changed_at)
SELECT id, 'placed', placed_at
FROM   public.orders
ON CONFLICT DO NOTHING;

-- Backfill: seed a "paid" event for paid orders using the payments.paid_at timestamp.
INSERT INTO public.order_status_log (order_id, status, changed_at)
SELECT o.id, 'paid', COALESCE(p.paid_at, o.updated_at)
FROM   public.orders  o
JOIN   public.payments p ON p.order_id = o.id
WHERE  o.status IN ('paid','processing','ready','shipped','completed')
  AND  p.status = 'verified'
ON CONFLICT DO NOTHING;
