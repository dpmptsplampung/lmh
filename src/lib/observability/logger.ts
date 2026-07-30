type LogLevel = 'info' | 'warn' | 'error';

type LogFields = {
  requestId?: string;
  route?: string;
  method?: string;
  operation: string;
  durationMs?: number;
  statusCode?: number;
  error?: unknown;
  [key: string]: unknown;
};

type LogOptions = {
  now?: () => Date;
  environment?: string;
  version?: string;
};

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(?:authorization|cookie|token|secret|password|email|phone|telepon|hp|nama|name|form|message)/i;

function sanitize(value: unknown, environment: string, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      type: value.name || 'Error',
      message: REDACTED,
      ...(environment === 'production' || environment === 'staging' ? {} : { stack: value.stack }),
    };
  }

  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  try {
    if (Array.isArray(value)) return value.map((item) => sanitize(item, environment, seen));

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, environment, seen),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}

export function logServerEvent(level: LogLevel, fields: LogFields, options: LogOptions = {}): void {
  const environment = options.environment ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  const entry = sanitize({
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    level,
    service: 'lampung-maju-hub',
    environment,
    version: options.version ?? process.env.APP_VERSION ?? (environment === 'test' ? 'test' : 'development'),
    ...fields,
  }, environment);
  const output = JSON.stringify(entry);

  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.info(output);

  // SEC-03 / OPS-06: selain ke console, tulis level error/warn ke error_log
  // (self-contained, tanpa biaya berulang). Best-effort: kegagalan sink TIDAK
  // boleh mengganggu alur utama, jadi tidak di-await dan tidak melempar.
  if (level === 'error' || level === 'warn') {
    void persistErrorLog(level, fields, environment, options.version).catch(() => {
      // sengaja ditelan — logging tidak boleh memutus request.
    });
  }
}

type ErrorLogPayload = {
  level: LogLevel;
  route?: string;
  method?: string;
  operation: string;
  requestId?: string;
  statusCode?: number;
  message: string;
  detail: Record<string, unknown>;
  environment: string;
  version?: string;
};

// Diekspor untuk diuji secara terpisah. Mengembalikan payload yang akan ditulis.
export function buildErrorLogPayload(
  level: LogLevel,
  fields: LogFields,
  environment: string,
  version?: string,
): ErrorLogPayload {
  const { requestId, route, method, operation, statusCode, error, ...rest } = fields;
  const message =
    error instanceof Error
      ? `[${error.name}]` // pesan error disanitasi oleh sanitize(); nama error aman
      : typeof fields.message === 'string'
        ? '[REDACTED]'
        : operation;
  // Hapus field yang berpotensi PII dari detail sebelum ditulis (lapisan kedua).
  const detail = sanitize({ ...rest }, environment) as Record<string, unknown>;
  return {
    level,
    route,
    method,
    operation,
    requestId,
    statusCode,
    message,
    detail,
    environment,
    version: version ?? process.env.APP_VERSION,
  };
}

async function persistErrorLog(
  level: LogLevel,
  fields: LogFields,
  environment: string,
  version?: string,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return; // sink nonaktif bila service role tidak disetel

  const payload = buildErrorLogPayload(level, fields, environment, version);
  // Panggil RPC langsung via fetch agar logger tetap ringan (tanpa import client berat).
  const res = await fetch(`${url}/rest/v1/rpc/log_error_event`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_level: payload.level,
      p_route: payload.route ?? null,
      p_method: payload.method ?? null,
      p_operation: payload.operation,
      p_request_id: payload.requestId ?? null,
      p_status_code: payload.statusCode ?? null,
      p_message: payload.message,
      p_detail: payload.detail,
      p_environment: payload.environment,
      p_version: payload.version ?? null,
    }),
  });
  // Telan status non-2xx — logging tidak boleh gagal.
  void res;
}
