# Magic SOAP Admin API

The extension uses the existing shared Supabase Edge Function `knowledge-admin` with:

```text
app_id: netmedic-rsdkh
```

The function routes configuration, user sessions, AI generation, and the shared product catalog by `app_id`. Catalog actions are accepted only for `netmedic-rsdkh`.

## Database Setup

Apply these migrations to the same Supabase project used by the related medical extensions:

- `migrations/20260812000300_add_magic_soap_admin_ai.sql`
- `migrations/20261006000100_add_shared_product_catalog.sql`
- `migrations/20261019000100_add_rsdkh_shared_tokens.sql`
- `migrations/20261019000200_add_rsdkh_token_snapshots.sql`

Deploy the updated shared `knowledge-admin` Edge Function from the `resume-medis-reviewer` repository after applying the migrations. The shared-token migration adds only RSDKH-specific objects and reads the existing `app_usage_logs` table without changing it.

After deployment, open **Pengaturan AI > Konfigurasi khusus admin**, enter the main admin credentials, then validate and save the provider key. Registered users can select **API admin** and log in without seeing the provider key.

## Security Boundary

- The shared function is deployed with `verify_jwt = false`; the extension therefore stores no Supabase anon key.
- Generate still requires a valid device-bound user session, while configuration and user management require the main admin credentials.
- Provider API keys stay in Supabase and are used only inside the Edge Function.
- Main admin credentials and user passwords are never persisted by the extension.
- Version 2.0 disables personal BYOK. Legacy local values are retained but never used for generation.
- Shared catalog additions require a valid registered-user session; deletions require main admin credentials.
- Catalog rows are isolated to `app_id: netmedic-rsdkh`; aliases remain local to each browser profile.
- The user shared-token endpoint requires a valid registered-user session and exposes the same three-hour WITA snapshot to every user. Rates and configuration controls still require main admin credentials.
- Shared-token cost counts successful `api_call` logs for `netmedic-rsdkh` only, freezes after the automatic 28-day period, and never blocks AI when zero, negative, or expired.
