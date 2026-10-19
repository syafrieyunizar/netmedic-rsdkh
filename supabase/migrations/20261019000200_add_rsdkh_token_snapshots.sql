-- Publish one deterministic RSDKH shared-token snapshot every three hours in WITA.
-- Safe to run repeatedly and scoped to app_id netmedic-rsdkh through its dedicated tables.

begin;

drop function if exists public.rsdkh_shared_token_summary();

create function public.rsdkh_shared_token_summary()
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
  snapshot_at timestamptz,
  expires_at timestamptz,
  recent_daily_cost numeric,
  estimated_depletion_at timestamptz,
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
  local_clock as (
    select now() at time zone 'Asia/Makassar' as local_now
  ),
  snapshot_clock as (
    select (
      date_trunc('hour', local_now)
      - make_interval(hours => extract(hour from local_now)::int % 3)
    ) at time zone 'Asia/Makassar' as snapshot_at
    from local_clock
  ),
  config_bounds as (
    select
      config.*,
      snapshot_clock.snapshot_at,
      config.active_from::timestamp at time zone 'Asia/Makassar' as active_at,
      (config.active_from + 28)::timestamp at time zone 'Asia/Makassar' as expires_at
    from config
    cross join snapshot_clock
  ),
  bounds as (
    select
      config_bounds.*,
      least(config_bounds.snapshot_at, config_bounds.expires_at) as usage_cutoff_at,
      least(
        date_trunc('day', config_bounds.snapshot_at at time zone 'Asia/Makassar') at time zone 'Asia/Makassar',
        config_bounds.expires_at
      ) as recent_end_at
    from config_bounds
  ),
  usage_with_rate as (
    select
      log.created_at,
      coalesce(log.input_chars, 0)::bigint as input_chars,
      coalesce(log.output_chars, 0)::bigint as output_chars,
      coalesce(current_rate.input_price_per_million, first_rate.input_price_per_million, 0)::numeric as input_rate,
      coalesce(current_rate.output_price_per_million, first_rate.output_price_per_million, 0)::numeric as output_rate
    from public.app_usage_logs log
    cross join bounds
    left join lateral (
      select rate.input_price_per_million, rate.output_price_per_million
      from public.rsdkh_character_rate_history rate
      where rate.app_id = bounds.app_id
        and rate.effective_from <= log.created_at
      order by rate.effective_from desc
      limit 1
    ) current_rate on true
    left join lateral (
      select rate.input_price_per_million, rate.output_price_per_million
      from public.rsdkh_character_rate_history rate
      where rate.app_id = bounds.app_id
      order by rate.effective_from asc
      limit 1
    ) first_rate on current_rate.input_price_per_million is null
    where log.app_id = bounds.app_id
      and log.event_type = 'api_call'
      and log.success = true
      and log.created_at >= bounds.active_at
      and log.created_at < bounds.usage_cutoff_at
  ),
  totals as (
    select
      coalesce(sum(input_chars), 0)::bigint as input_chars,
      coalesce(sum(output_chars), 0)::bigint as output_chars,
      count(*)::bigint as call_count,
      coalesce(sum((input_chars::numeric * input_rate + output_chars::numeric * output_rate) / 1000000), 0)::numeric as total_cost
    from usage_with_rate
  ),
  recent_window as (
    select
      greatest(bounds.active_at, bounds.recent_end_at - interval '7 days') as recent_start_at,
      bounds.recent_end_at,
      greatest(
        extract(epoch from (bounds.recent_end_at - greatest(bounds.active_at, bounds.recent_end_at - interval '7 days'))) / 86400,
        0
      )::numeric as recent_days
    from bounds
  ),
  recent_totals as (
    select
      recent_window.recent_days,
      coalesce(sum((usage.input_chars::numeric * usage.input_rate + usage.output_chars::numeric * usage.output_rate) / 1000000), 0)::numeric as recent_cost
    from recent_window
    left join usage_with_rate usage
      on usage.created_at >= recent_window.recent_start_at
      and usage.created_at < recent_window.recent_end_at
    group by recent_window.recent_days
  ),
  latest_rate as (
    select rate.input_price_per_million, rate.output_price_per_million
    from public.rsdkh_character_rate_history rate
    where rate.app_id = 'netmedic-rsdkh'
    order by rate.effective_from desc
    limit 1
  ),
  balance as (
    select
      bounds.*,
      totals.input_chars,
      totals.output_chars,
      totals.call_count,
      totals.total_cost,
      bounds.total_pulse - totals.total_cost as shared_token,
      case
        when recent_totals.recent_days >= 1 and recent_totals.recent_cost > 0
          then recent_totals.recent_cost / recent_totals.recent_days
        else 0
      end as recent_daily_cost
    from bounds
    cross join totals
    cross join recent_totals
  )
  select
    balance.app_id,
    balance.input_chars,
    balance.output_chars,
    balance.call_count,
    round(balance.total_cost, 6),
    balance.total_pulse,
    round(balance.shared_token, 6),
    balance.active_from,
    coalesce(latest_rate.input_price_per_million, 0),
    coalesce(latest_rate.output_price_per_million, 0),
    balance.snapshot_at,
    balance.expires_at,
    round(balance.recent_daily_cost, 6),
    case
      when balance.shared_token > 0
        and balance.recent_daily_cost > 0
        and balance.snapshot_at < balance.expires_at
        then balance.snapshot_at
          + ((balance.shared_token / balance.recent_daily_cost)::double precision * interval '1 day')
      else null
    end,
    balance.updated_at
  from balance
  left join latest_rate on true;
$$;

revoke all on function public.rsdkh_shared_token_summary() from public, anon, authenticated;
grant execute on function public.rsdkh_shared_token_summary() to service_role;

commit;
