import { createLivenessResponse } from './health';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return createLivenessResponse({
    environment: process.env.APP_ENV ?? 'development',
    version: process.env.APP_VERSION ?? 'development',
  });
}
