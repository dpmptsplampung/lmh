import { logServerEvent } from '@/lib/observability/logger';

type ReadinessOptions = {
  validateConfig: () => void;
  queryLayanan: (signal: AbortSignal) => Promise<void>;
  environment: string;
  version: string;
  timeoutMs: number;
  now?: () => Date;
  onFailure?: (error: unknown, durationMs: number) => void;
};

type ReadinessEnv = {
  APP_ENV?: string;
  APP_VERSION?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

type ReadinessClient = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (count: number) => {
        abortSignal: (signal: AbortSignal) => PromiseLike<{ error: unknown }>;
      };
    };
  };
};

type ReadinessHandlerDependencies<TEnv extends ReadinessEnv> = {
  env: Record<string, string | undefined>;
  parseEnv: (env: Record<string, string | undefined>) => TEnv;
  createServiceClient: (env: TEnv) => ReadinessClient;
  timeoutMs: number;
};

export async function createReadinessResponse(options: ReadinessOptions): Promise<Response> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    options.validateConfig();
    await Promise.race([
      options.queryLayanan(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('readiness timeout'));
        }, options.timeoutMs);
      }),
    ]);

    return Response.json({
      status: 'ready',
      version: options.version,
      environment: options.environment,
      timestamp: (options.now ?? (() => new Date()))().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    options.onFailure?.(error, Date.now() - startedAt);
    return Response.json({ status: 'not_ready' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createReadinessHandler<TEnv extends ReadinessEnv>(
  dependencies: ReadinessHandlerDependencies<TEnv>,
): () => Promise<Response> {
  return () => {
    let runtimeEnv: TEnv;

    return createReadinessResponse({
      environment: dependencies.env.APP_ENV ?? 'development',
      version: dependencies.env.APP_VERSION ?? 'development',
      timeoutMs: dependencies.timeoutMs,
      validateConfig: () => {
        runtimeEnv = dependencies.parseEnv(dependencies.env);
        if (!runtimeEnv.NEXT_PUBLIC_SUPABASE_URL || !runtimeEnv.SUPABASE_SERVICE_ROLE_KEY) {
          throw new Error('Readiness database configuration is missing');
        }
      },
      queryLayanan: async (signal) => {
        const { error } = await dependencies.createServiceClient(runtimeEnv)
          .from('layanan')
          .select('id')
          .limit(1)
          .abortSignal(signal);
        if (error) throw error;
      },
      onFailure: (error, durationMs) => logServerEvent('error', {
        route: '/api/health/ready',
        method: 'GET',
        operation: 'health.ready',
        durationMs,
        statusCode: 503,
        error: { type: error instanceof Error ? error.name : 'UnknownError' },
      }),
    });
  };
}
