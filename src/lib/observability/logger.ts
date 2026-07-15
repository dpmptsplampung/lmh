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
}
