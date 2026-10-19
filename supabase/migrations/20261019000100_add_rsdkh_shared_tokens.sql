-- Shared-token budget for Netmedic RSDKH only.
-- Safe to run more than once and does not change usage data for other app_id values.

create table if not exists public.rsdkh_shared_token_config (
  app_id text primary key check (app_id = 'netmedic-rsdkh'),
  total_pulse numeric(18, 6) not null default 0 check (total_pulse >= 0),
  active_from date not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.rsdkh_character_rate_history (
  id uuid primary key default gen_random_uuid(),
  app_id text not null check (app_id = 'netmedic-rsdkh'),
  input_price_per_million numeric(18, 6) not null check (input_price_per_million >= 0),
  output_price_per_million numeric(18, 6) not null check (output_price_per_million >= 0),
  effective_from timestamptz not null,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists rsdkh_character_rate_effective_idx
  on public.rsdkh_character_rate_history (app_id, effective_from desc);

alter table public.rsdkh_shared_token_config enable row level security;
alter table public.rsdkh_character_rate_history enable row level security;

insert into public.rsdkh_shared_token_config (app_id, total_pulse, active_from)
values ('netmedic-rsdkh', 0, (now() at time zone 'Asia/Makassar')::date)
on conflict (app_id) do nothing;

create or replace function public.rsdkh_shared_token_summary()
returns table (
  app_id text,
  input_chars bigint,
  output_chars bigint,
  call_count bigint,
  total_cost numeric,
  total_pulse numeric,
  shared_token numeric,
  active_from date,
  input_price_per_million numeric,
  output_price_per_million numeric,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with config as (
    select *
    from public.rsdkh_shared_token_config
    where app_id = 'netmedic-rsdkh'
    limit 1
  ),
  usage_with_rate as (
    select
      coalesce(log.input_chars, 0)::bigint as input_chars,
      coalesce(log.output_chars, 0)::bigint as output_chars,
      coalesce(current_rate.input_price_per_million, first_rate.input_price_per_million, 0)::numeric as input_rate,
      coalesce(current_rate.output_price_per_million, first_rate.output_price_per_million, 0)::numeric as output_rate
    from public.app_usage_logs log
    cross join config
    left join lateral (
      select rate.input_price_per_million, rate.output_price_per_million
      from public.rsdkh_character_rate_history rate
      where rate.app_id = config.app_id
        and rate.effective_from <= log.created_at
      order by rate.effective_from desc
      limit 1
    ) current_rate on true
    left join lateral (
      select rate.input_price_per_million, rate.output_price_per_million
      from public.rsdkh_character_rate_history rate
      where rate.app_id = config.app_id
      order by rate.effective_from asc
      limit 1
    ) first_rate on current_rate.input_price_per_million is null
    where log.app_id = config.app_id
      and log.event_type = 'api_call'
      and log.success = true
      and log.created_at >= (config.active_from::timestamp at time zone 'Asia/Makassar')
  ),
  totals as (
    select
      coalesce(sum(input_chars), 0)::bigint as input_chars,
      coalesce(sum(output_chars), 0)::bigint as output_chars,
      count(*)::bigint as call_count,
      coalesce(sum((input_chars::numeric * input_rate + output_chars::numeric * output_rate) / 1000000), 0)::numeric as total_cost
    from usage_with_rate
  ),
  latest_rate as (
    select rate.input_price_per_million, rate.output_price_per_million
    from public.rsdkh_character_rate_history rate
    where rate.app_id = 'netmedic-rsdkh'
    order by rate.effective_from desc
    limit 1
  )
  select
    config.app_id,
    totals.input_chars,
    totals.output_chars,
    totals.call_count,
    round(totals.total_cost, 6),
    config.total_pulse,
    round(config.total_pulse - totals.total_cost, 6),
    config.active_from,
    coalesce(latest_rate.input_price_per_million, 0),
    coalesce(latest_rate.output_price_per_million, 0),
    config.updated_at
  from config
  cross join totals
  left join latest_rate on true;
$$;

revoke all on function public.rsdkh_shared_token_summary() from public, anon, authenticated;
grant execute on function public.rsdkh_shared_token_summary() to service_role;
