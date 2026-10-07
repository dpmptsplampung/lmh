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
| `LLM_CHAT_PROVIDERS` | Optional | Optional | Optional | Optional | No |
| `LLM_DAILY_LIMIT` | Optional (default 200 per provider per day, WIB) | Optional | Optional | Optional | No |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `MISTRAL_API_KEY` | Optional | Optional | Optional | Optional | No |
| `LMH_DEV_RETURN_LINK` | May be `set` only for deliberate local debugging | Unset | Must not be `set` | Must not be `set` | No |

## Chat bot LLM chain

- Primary: Google SDK (`GEMINI_API_KEY`, `GEMINI_MODEL`). Fallback chain: `LLM_CHAT_PROVIDERS`, format `provider:model[@KEY_ENV],...` in priority order, e.g. `gemini:gemini-flash-latest,groq:llama-3.3-70b-versatile,openrouter:<model>,mistral:<model>`. Built-in providers: `gemini` (OpenAI-compatible endpoint, key `GEMINI_API_KEY`), `groq`, `openrouter`, `mistral`, `ollama`; unknown names use `<NAME>_BASE_URL`, `<NAME>_API_KEY`, `<NAME>_MODEL`. Providers without a key are skipped.
- Circuit breaker (3 failures -> 10 minute cooldown) and daily quota are in-memory per serverless instance; the SDK primary (`primary:gemini`) and the spec entry `gemini` keep separate state.
- If no provider key is set, startup logs a warning (`env.no_ai_provider`); the bot then answers from FAQ full-text match or escalates to staff.
- `BOT_FTS_THRESHOLD` (default 0.15) overrides the deterministic FAQ match threshold.

## Vercel Setup

1. Create separate values for Preview/staging and Production. Do not share service-role, cron, Resend, Gemini, or VAPID private secrets between environments.
2. Set `APP_ENV=staging` when Vercel supplies `VERCEL_ENV=preview`, and `APP_ENV=production` when Vercel supplies `VERCEL_ENV=production`. Startup fails if `APP_ENV` is missing, misspelled, or inconsistent.
3. Set `APP_VERSION` to an immutable release or commit identifier, for example the Vercel commit SHA supplied by deployment automation.
4. Confirm both public VAPID variables contain the same public key. Keep `VAPID_PRIVATE_KEY` server-only.
5. Redeploy, then verify `/api/health/live` and `/api/health/ready`.
6. Confirm Vercel Cron is enabled for the project (Hobby may limit cron frequency; Pro recommended for `*/2` send cadence). `CRON_SECRET` must match what Vercel injects as `Authorization: Bearer …`.

Only `src/lib/env/client.ts` may be imported by client code. It uses static `process.env.NEXT_PUBLIC_*` references so Next.js can inline public values. Never add a server secret to that module or to a health response.

Local `next build` remains possible with replacement values because startup validation is skipped only during Next's `phase-production-build`. Outside that phase every runtime parses the environment contract. Vercel runtime detection additionally fails closed when `APP_ENV` is absent or inconsistent with `VERCEL_ENV`.
