create table if not exists public.app_product_catalog (
  id uuid primary key default gen_random_uuid(),
  app_id text not null,
  product_name text not null,
  normalized_name text not null,
  product_code text,
  source text not null default 'shared' check (source in ('bundled', 'shared')),
  active boolean not null default true,
  created_by text not null,
  deleted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (app_id, normalized_name)
);

create index if not exists app_product_catalog_app_active_idx
  on public.app_product_catalog (app_id, active, product_name);

alter table public.app_product_catalog enable row level security;

comment on table public.app_product_catalog is
  'Tambahan dan tombstone katalog produk per aplikasi; hanya diakses melalui Edge Function service role.';
