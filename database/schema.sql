-- =============================================================
-- FitMatcher – FINAL CLEAN SCHEMA
-- JCE Bridal Boutique E-Commerce
-- =============================================================

-- EXTENSIONS
create extension if not exists "pgcrypto";
create extension if not exists "citext";


-- =============================================================
-- USERS
-- =============================================================

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  first_name text not null,
  last_name text not null,
  phone text,
  password_hash text not null,
  role text not null default 'customer' check (role in ('customer','admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- =============================================================
-- USER ADDRESSES
-- =============================================================

create table public.user_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  label text,
  recipient_name text not null,
  line1 text not null,
  line2 text,
  city text not null,
  province text,
  postal_code text,
  country text not null default 'PH',
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_user_addresses_user_id on public.user_addresses(user_id);


-- =============================================================
-- OTP
-- =============================================================

create table public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  purpose text not null check (purpose in ('login','signup','password_reset')),
  code_hash text not null,
  attempts int not null default 0,
  max_attempts int not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_otp_email_purpose on public.otp_codes(email, purpose);


-- =============================================================
-- CATEGORIES
-- =============================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);


-- =============================================================
-- SUPPLIERS (MUST COME BEFORE GOWNS)
-- =============================================================

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);


create table public.supplier_size_metrics (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  size_label text not null,
  bust_min numeric(5,2),
  bust_max numeric(5,2),
  waist_min numeric(5,2),
  waist_max numeric(5,2),
  hip_min numeric(5,2),
  hip_max numeric(5,2),
  unique (supplier_id, size_label)
);


-- =============================================================
-- GOWNS
-- =============================================================

create table public.gowns (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  sku text not null unique,
  name text not null,
  description text,
  color text,
  silhouette text,
  fabric text,
  neckline text,
  embellishment text,
  size_chart jsonb,
  sale_price numeric(12,2) not null check (sale_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_gowns_category on public.gowns(category_id);
create index idx_gowns_active on public.gowns(is_active);


-- =============================================================
-- GOWN IMAGES
-- =============================================================

create table public.gown_images (
  id uuid primary key default gen_random_uuid(),
  gown_id uuid not null references public.gowns(id) on delete cascade,
  image_url text not null,
  alt text,
  sort_order int not null default 0,
  is_primary boolean not null default false,
  is_tryon_asset boolean not null default false
);

create index idx_gown_images_gown on public.gown_images(gown_id);


-- =============================================================
-- INVENTORY
-- =============================================================

create table public.gown_inventory (
  id uuid primary key default gen_random_uuid(),
  gown_id uuid not null references public.gowns(id) on delete cascade,
  size_label text not null,
  stock_qty int not null default 0 check (stock_qty >= 0),
  reserved_qty int not null default 0 check (reserved_qty >= 0),
  unique (gown_id, size_label)
);


-- =============================================================
-- ORDERS
-- =============================================================

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid references public.users(id) on delete set null,
  customer_email citext not null,
  customer_name text not null,
  customer_phone text,

  status text not null default 'placed'
    check (status in ('placed','pending_payment','paid','processing','ready','shipped','completed','cancelled','refunded')),

  payment_method text not null check (payment_method in ('gcash','bdo','cash')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','pending','paid','failed','refunded')),

  delivery_method text not null default 'pickup'
    check (delivery_method in ('pickup','lalamove')),
  delivery_address text,

  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0,
  shipping_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null check (total >= 0),

  notes text,
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_orders_user_id on public.orders(user_id);
create index idx_orders_email on public.orders(customer_email);


-- =============================================================
-- ORDER ITEMS
-- =============================================================

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  gown_id uuid references public.gowns(id) on delete set null,
  gown_name text not null,
  size_label text,
  quantity int not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);

create index idx_order_items_order on public.order_items(order_id);


-- =============================================================
-- PAYMENTS
-- =============================================================

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  method text not null check (method in ('gcash','bdo','cash')),
  amount numeric(12,2) not null check (amount >= 0),
  reference_no text,
  proof_image_url text,
  paid_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','verified','rejected','refunded')),
  created_at timestamptz not null default now()
);


-- =============================================================
-- FAVORITES
-- =============================================================

create table public.favorites (
  user_id uuid not null references public.users(id) on delete cascade,
  gown_id uuid not null references public.gowns(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, gown_id)
);


-- =============================================================
-- USER MEASUREMENTS (SIZE RECOMMENDER)
-- =============================================================

create table public.user_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  height_cm numeric(5,1),
  weight_kg numeric(5,1),
  bust_cm numeric(5,1),
  waist_cm numeric(5,1),
  hips_cm numeric(5,1),
  source text not null default 'manual'
    check (source in ('camera','manual','tape')),
  measured_at timestamptz not null default now()
);


-- =============================================================
-- STYLE PREFERENCES
-- =============================================================

create table public.user_style_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  body_type text,
  skin_tone text,
  style_tags jsonb not null default '[]',
  preferred_silhouettes jsonb not null default '[]',
  preferred_colors jsonb not null default '[]',
  updated_at timestamptz not null default now()
);


-- =============================================================
-- AR FIT PROFILES
-- =============================================================

create table public.ar_fit_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);


-- =============================================================
-- AUTO updated_at TRIGGER
-- =============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_users_updated
before update on public.users
for each row execute function set_updated_at();

create trigger trg_gowns_updated
before update on public.gowns
for each row execute function set_updated_at();

create trigger trg_orders_updated
before update on public.orders
for each row execute function set_updated_at();