# Observability

Vercel is the only observability provider for this gate. No Sentry or OpenTelemetry package is required. Server events are emitted as one JSON object per line to stdout/stderr and are available in Vercel Runtime Logs.

## Structured Logs

Use `logServerEvent` from `src/lib/observability/logger.ts` for incremental route adoption. Next.js unhandled server request errors are captured by `src/instrumentation.ts`.

Stable fields are `timestamp`, `level`, `service`, `environment`, `version`, and, when applicable, `requestId`, `route`, `method`, `operation`, `durationMs`, `statusCode`, and `error.type`.

The logger recursively redacts any field whose key matches authorization, cookie, token, secret, password, email, phone, telepon, hp, nama, name, form, or message. Error messages are redacted. Staging and production Error output excludes stack traces. Bigints are normalized and circular object graphs are bounded. Do not log raw request bodies, form data, database responses, provider payloads, or secrets even though the logger provides a final safety layer.

`x-request-id` accepts only 1-128 characters from letters, digits, `.`, `_`, `:`, and `-`. Proxy preserves a valid upstream ID or generates a UUID, then forwards and returns it for Vercel log correlation.

## Health Endpoints

- `GET /api/health/live` is dependency-free. A `200` response means the process can serve HTTP. It returns only status, version, environment, and timestamp.
- `GET /api/health/ready` validates runtime configuration and performs a bounded, minimal `layanan` query with the server-only Supabase service-role client. Its 3-second timeout aborts the PostgREST request, and the route advertises a 5-second platform `maxDuration`.
- Ready returns `200` with deployment metadata. Invalid configuration, timeout, and database failure return only `503 {"status":"not_ready"}`.
- Both endpoints set `Cache-Control: no-store`. Neither endpoint returns provider URLs, keys, database messages, or other diagnostics.
- `public/sw.js` bypasses `/api/health/` before interception. Health probes always reach the deployed runtime and never fall back to cached or offline responses.

Health probes should call the deployed HTTPS endpoints directly with `GET`; do not route them through a browser session or service worker. Treat a timeout as a failed probe. Use consecutive-failure thresholds so a single deployment transition does not page operators.

## WAF And Rate Limits

Serverless instances do not share reliable in-memory rate-limit state. Configure rate control operationally in Vercel WAF:

1. Allow unauthenticated `GET` requests to the exact `/api/health/live` and `/api/health/ready` paths.
2. Deny other methods on those paths and apply a conservative per-source rate limit that remains above the combined Vercel and external probe frequency.
3. Use separate limits for readiness because it reaches Supabase; do not allow high-frequency public polling.
4. Exclude approved monitor sources only when their addresses are stable and managed. Keep response bodies sanitized even for allowlisted probes.
5. Review WAF events and readiness failures together before tuning thresholds. Do not implement distributed rate control with process-local counters.

## Vercel Alerts

Configure alerts manually in Vercel because alert resources are outside this repository:

1. In the Vercel project, enable Runtime Logs retention/access for the operations team.
2. Create an external uptime check against `/api/health/live`; alert after repeated non-200 responses.
3. Create an external readiness check against `/api/health/ready`; alert on repeated `503` responses, using a threshold that tolerates a single transient deployment probe.
4. In Vercel Observability, create an error-rate alert for Functions and review JSON events where `operation=next.request_error` or `operation=health.ready`.
5. Route notifications to the approved operations channel and perform a controlled staging failure to verify delivery.

Treat liveness failure as process/deployment failure. Treat readiness failure as configuration or Supabase dependency failure. Use the request ID and Vercel deployment metadata to investigate; do not weaken response sanitization to expose diagnostics.
