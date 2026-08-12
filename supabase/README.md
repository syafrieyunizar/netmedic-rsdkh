# Magic SOAP Admin API

The extension uses the existing shared Supabase Edge Function `knowledge-admin` with:

```text
app_id: magic-soap
```

The function already routes configuration, user sessions, and AI generation by `app_id`, so no function source change is required for this application.

## Database Setup

Apply `migrations/20260812000300_add_magic_soap_admin_ai.sql` to the same Supabase project used by the related medical extensions. The migration is idempotent and creates an empty Gemini slot without overwriting an existing API key.

After deployment, open **Pengaturan AI > Konfigurasi khusus admin**, enter the main admin credentials, then validate and save the provider key. Registered users can select **API admin** and log in without seeing the provider key.

## Security Boundary

- The shared function is deployed with `verify_jwt = false`; the extension therefore stores no Supabase anon key.
- Generate still requires a valid device-bound user session, while configuration and user management require the main admin credentials.
- Provider API keys stay in Supabase and are used only inside the Edge Function.
- Main admin credentials and user passwords are never persisted by the extension.
- Personal BYOK remains separate and is stored only in `chrome.storage.local`.
