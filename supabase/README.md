# Netmedic RSDKH Admin API

The extension uses the shared Supabase Edge Function `knowledge-admin`. Its canonical source, migrations, tests, and deployment instructions live at:

`https://github.com/syafrieyunizar/shared-knowledge-admin`

This repository contains the application client and historical migration snapshots only. Do not deploy or maintain the shared function from this repository.

The application uses:

```text
app_id: netmedic-rsdkh
```

The function routes configuration, user sessions, AI generation, and the shared product catalog by `app_id`. Catalog actions are accepted only for `netmedic-rsdkh`.

## Database Setup

Apply migrations and deploy `knowledge-admin` only from the canonical `shared-knowledge-admin` repository. Keep the exact `app_id: netmedic-rsdkh` boundary and smoke-test the RSDKH catalog, AI response, and shared-token summary after a shared deployment.

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
- Shared-token cost counts successful `api_call` logs for `netmedic-rsdkh` only, freezes after the inclusive end date configured by the admin, and never blocks AI when zero, negative, or expired.
