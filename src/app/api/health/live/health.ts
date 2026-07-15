type LivenessOptions = {
  environment: string;
  version: string;
  now?: () => Date;
};

export function createLivenessResponse(options: LivenessOptions): Response {
  return Response.json({
    status: 'live',
    version: options.version,
    environment: options.environment,
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
  }, { headers: { 'cache-control': 'no-store' } });
}
