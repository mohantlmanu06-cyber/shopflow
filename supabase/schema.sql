create extension if not exists "pgcrypto";
create extension if not exists "vector";

create type public.user_role as enum ('customer', 'shopkeeper', 'admin');
create type public.order_status as enum ('new_order', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'rejected');
create type public.fulfillment_type as enum ('pickup', 'delivery');
create type public.request_status as enum ('open', 'in_review', 'approved', 'rejected', 'resolved');

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'customer',
  full_name text not null,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  category text not null,
  address text not null,
  latitude numeric(10, 7) not null,
  longitude numeric(10, 7) not null,
  contact_phone text not null,
  opening_hours jsonb not null default '{}'::jsonb,
  delivery_radius_km numeric(5, 2) not null default 2.5,
  verified boolean not null default false,
  trust_score numeric(5, 2) not null default 70,
  rating numeric(3, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  category text not null,
  description text,
  image_url text,
  embedding vector(1536),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.inventory (
  product_id uuid primary key references public.products (id) on delete cascade,
  price_inr numeric(10, 2) not null check (price_inr >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 10,
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users (id),
  shop_id uuid not null references public.shops (id),
  status public.order_status not null default 'new_order',
  fulfillment public.fulfillment_type not null,
  total_inr numeric(10, 2) not null check (total_inr >= 0),
  delivery_address text,
  eta_minutes integer,
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity integer not null check (quantity > 0),
  unit_price_inr numeric(10, 2) not null check (unit_price_inr >= 0)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users (id),
  shop_id uuid references public.shops (id) on delete cascade,
  product_id uuid references public.products (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table public.wishlist (
  customer_id uuid not null references public.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, shop_id)
);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users (id),
  order_id uuid references public.orders (id),
  status public.request_status not null default 'open',
  reason text not null,
  admin_notes text,
  created_at timestamptz not null default now()
);

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users (id),
  order_id uuid not null references public.orders (id),
  amount_inr numeric(10, 2) not null check (amount_inr >= 0),
  status public.request_status not null default 'open',
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.analytics (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops (id) on delete cascade,
  metric_name text not null,
  metric_value numeric(14, 2) not null,
  period_start date not null,
  period_end date not null
);

alter table public.users enable row level security;
alter table public.shops enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews enable row level security;
alter table public.wishlist enable row level security;
alter table public.complaints enable row level security;
alter table public.refund_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.analytics enable row level security;

create policy "users can read own profile" on public.users for select using (id = auth.uid());
create policy "admins can read users" on public.users for select using ((auth.jwt() ->> 'role') = 'admin');

create policy "public can read verified shops" on public.shops for select using (verified = true);
create policy "shopkeepers manage own shops" on public.shops for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "admins manage shops" on public.shops for all using ((auth.jwt() ->> 'role') = 'admin');

create policy "public can read active products" on public.products for select using (active = true);
create policy "shopkeepers manage own products" on public.products for all
using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()))
with check (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));

create policy "public can read inventory" on public.inventory for select using (true);
create policy "shopkeepers manage own inventory" on public.inventory for all
using (exists (select 1 from public.products p join public.shops s on s.id = p.shop_id where p.id = product_id and s.owner_id = auth.uid()));

create policy "customers read own orders" on public.orders for select using (customer_id = auth.uid());
create policy "customers create own orders" on public.orders for insert with check (customer_id = auth.uid());
create policy "shopkeepers read shop orders" on public.orders for select
using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));
create policy "shopkeepers update shop orders" on public.orders for update
using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));
create policy "admins manage orders" on public.orders for all using ((auth.jwt() ->> 'role') = 'admin');

create policy "order item visibility follows order" on public.order_items for select
using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or exists (select 1 from public.shops s where s.id = o.shop_id and s.owner_id = auth.uid()) or (auth.jwt() ->> 'role') = 'admin')));

create policy "customers manage own wishlist" on public.wishlist for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy "customers create reviews" on public.reviews for insert with check (customer_id = auth.uid());
create policy "public reads reviews" on public.reviews for select using (true);
create policy "customers manage own complaints" on public.complaints for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy "customers manage own refunds" on public.refund_requests for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy "admins manage support queues" on public.complaints for all using ((auth.jwt() ->> 'role') = 'admin');
create policy "admins manage refunds" on public.refund_requests for all using ((auth.jwt() ->> 'role') = 'admin');
create policy "users read own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "shopkeepers read own analytics" on public.analytics for select
using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));
create policy "admins read analytics" on public.analytics for select using ((auth.jwt() ->> 'role') = 'admin');
