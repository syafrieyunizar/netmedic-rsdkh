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

Deploy the updated shared `knowledge-admin` Edge Function from the `resume-medis-reviewer` repository after applying the catalog migration. Both migrations are idempotent.

After deployment, open **Pengaturan AI > Konfigurasi khusus admin**, enter the main admin credentials, then validate and save the provider key. Registered users can select **API admin** and log in without seeing the provider key.

## Security Boundary

- The shared function is deployed with `verify_jwt = false`; the extension therefore stores no Supabase anon key.
- Generate still requires a valid device-bound user session, while configuration and user management require the main admin credentials.
- Provider API keys stay in Supabase and are used only inside the Edge Function.
- Main admin credentials and user passwords are never persisted by the extension.
- Personal BYOK remains separate and is stored only in `chrome.storage.local`.
- Shared catalog additions require a valid registered-user session; deletions require main admin credentials.
- Catalog rows are isolated to `app_id: netmedic-rsdkh`; aliases remain local to each browser profile.
