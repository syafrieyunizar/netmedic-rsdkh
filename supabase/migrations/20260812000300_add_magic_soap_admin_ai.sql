-- Add admin API key slot for app_id: magic-soap.
-- Safe to run more than once. Existing API keys/config are not overwritten.

insert into public.admin_ai_config (id, app_id, provider, api_key, model)
select 'magic-soap', 'magic-soap', 'gemini', '', 'gemini-2.0-flash'
where not exists (
  select 1
  from public.admin_ai_config
  where app_id = 'magic-soap'
);

insert into public.admin_ai_providers (
  app_id,
  provider,
  provider_label,
  base_url,
  api_key,
  model,
  active,
  gemini_fallback_model
)
select
  'magic-soap',
  'gemini',
  'Gemini',
  null,
  '',
  'gemini-2.0-flash',
  true,
  'gemini-2.0-flash'
where not exists (
  select 1
  from public.admin_ai_providers
  where app_id = 'magic-soap'
    and active = true
)
and not exists (
  select 1
  from public.admin_ai_providers
  where app_id = 'magic-soap'
    and provider = 'gemini'
);
