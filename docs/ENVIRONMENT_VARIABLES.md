# Environment Variables

Lampung Maju Hub validates runtime configuration with Zod. Vercel is the supported production provider. Configure values in **Vercel Project > Settings > Environment Variables**, scope each value to the intended Vercel environment, and redeploy after changes.

Do not copy the marked replacement values from `.env.example` into staging or production. The startup contract rejects missing values, non-HTTPS public URLs, obvious placeholders, mismatched VAPID public keys, and `LMH_DEV_RETURN_LINK=set`.

## Environment Matrix

| Variable | Development | Test | Staging | Production | Browser-visible |
| --- | --- | --- | --- | --- | --- |
| `APP_ENV` | `development` | `test` | `staging` | `production` | No |
| `APP_VERSION` | Optional local label | Optional test label | Required deployment identifier | Required deployment identifier | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional/build placeholder | Optional/build placeholder | Required HTTPS | Required HTTPS | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional/build placeholder | Optional/build placeholder | Required | Required | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Optional | Required | Required | No |
| `RESEND_API_KEY` | Optional | Optional | Required | Required | No |
| `VAPID_PUBLIC_KEY` | Optional | Optional | Required | Required | No |
| `VAPID_PRIVATE_KEY` | Optional | Optional | Required | Required | No |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Optional | Optional | Required; must match `VAPID_PUBLIC_KEY` | Required; must match `VAPID_PUBLIC_KEY` | Yes |
| `CRON_SECRET` | Optional | Optional | Required | Required | No |
| `RESEND_FROM` | Optional/defaults may apply | Optional | Required | Required | No |
| `NEXT_PUBLIC_PUBLIC_URL` | Optional/build placeholder | Optional/build placeholder | Required HTTPS | Required HTTPS | Yes |
| `GEMINI_API_KEY` | Optional | Optional | Required | Required | No |
| `GEMINI_MODEL` | Optional/defaults may apply | Optional | Required | Required | No |
| `GEMINI_EMBEDDING_MODEL` | Optional/defaults may apply | Optional | Required | Required | No |
| `LMH_DEV_RETURN_LINK` | May be `set` only for deliberate local debugging | Unset | Must not be `set` | Must not be `set` | No |

## Vercel Setup

1. Create separate values for Preview/staging and Production. Do not share service-role, cron, Resend, Gemini, or VAPID private secrets between environments.
2. Set `APP_ENV=staging` when Vercel supplies `VERCEL_ENV=preview`, and `APP_ENV=production` when Vercel supplies `VERCEL_ENV=production`. Startup fails if `APP_ENV` is missing, misspelled, or inconsistent.
3. Set `APP_VERSION` to an immutable release or commit identifier, for example the Vercel commit SHA supplied by deployment automation.
4. Confirm both public VAPID variables contain the same public key. Keep `VAPID_PRIVATE_KEY` server-only.
5. Redeploy, then verify `/api/health/live` and `/api/health/ready`.

Only `src/lib/env/client.ts` may be imported by client code. It uses static `process.env.NEXT_PUBLIC_*` references so Next.js can inline public values. Never add a server secret to that module or to a health response.

Local `next build` remains possible with replacement values because startup validation is skipped only during Next's `phase-production-build`. Outside that phase every runtime parses the environment contract. Vercel runtime detection additionally fails closed when `APP_ENV` is absent or inconsistent with `VERCEL_ENV`.
