# AGENTS.md — Netmedic RSDKH

Before changing shared Supabase behavior:

1. The canonical `knowledge-admin` source, migrations, tests, and deployment instructions are in `https://github.com/syafrieyunizar/shared-knowledge-admin`.
2. Do not deploy, maintain, or treat migration snapshots in this application repository as the shared backend source of truth.
3. Keep application-specific backend behavior guarded by the exact `app_id: netmedic-rsdkh`.
4. Make shared backend changes in the canonical repository first, run its contract checks, and smoke-test this application after deployment.
5. Never commit API keys, Supabase service-role keys, credentials, or patient data.
