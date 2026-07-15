import type { Instrumentation } from 'next';
import { parseRuntimeEnv } from '@/lib/env/server';
import { logServerEvent } from '@/lib/observability/logger';

export function validateStartupEnvironment(env: Record<string, string | undefined>): void {
  parseRuntimeEnv(env);
}

export function register(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  validateStartupEnvironment(process.env);
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const requestId = Array.isArray(request.headers['x-request-id'])
    ? request.headers['x-request-id'][0]
    : request.headers['x-request-id'];

  logServerEvent('error', {
    requestId,
    route: context.routePath || request.path,
    method: request.method,
    operation: 'next.request_error',
    error,
    routeType: context.routeType,
  });
};
