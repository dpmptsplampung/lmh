import { z } from 'zod';

const serviceKeys = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'CRON_SECRET',
  'RESEND_FROM',
  'NEXT_PUBLIC_PUBLIC_URL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GEMINI_EMBEDDING_MODEL',
] as const;

const placeholderPattern = /(?:\.\.\.|placeholder|change[-_ ]?me|replace[-_ ]?with|your[-_ ]|example\.test|^(?:test|dev|dummy|sample)(?:[-_ ]|$))/i;

const serverEnvSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']),
  APP_VERSION: z.string(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  NEXT_PUBLIC_PUBLIC_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GEMINI_EMBEDDING_MODEL: z.string().optional(),
  LMH_DEV_RETURN_LINK: z.string().optional(),
}).superRefine((env, context) => {
  if (env.APP_ENV !== 'staging' && env.APP_ENV !== 'production') return;

  if (!env.APP_VERSION.trim() || placeholderPattern.test(env.APP_VERSION)) {
    context.addIssue({ code: 'custom', path: ['APP_VERSION'], message: 'APP_VERSION must identify the deployment' });
  }

  for (const key of serviceKeys) {
    const value = env[key];
    if (!value?.trim()) {
      context.addIssue({ code: 'custom', path: [key], message: `${key} is required` });
    } else if (placeholderPattern.test(value)) {
      context.addIssue({ code: 'custom', path: [key], message: `${key} must not be a placeholder` });
    }
  }

  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_PUBLIC_URL'] as const) {
    const value = env[key];
    if (value) {
      try {
        if (new URL(value).protocol !== 'https:') throw new Error('not HTTPS');
      } catch {
        context.addIssue({ code: 'custom', path: [key], message: `${key} must be an HTTPS URL` });
      }
    }
  }

  if (env.VAPID_PUBLIC_KEY !== env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    context.addIssue({ code: 'custom', path: ['NEXT_PUBLIC_VAPID_PUBLIC_KEY'], message: 'VAPID public keys must match' });
  }
  if (env.LMH_DEV_RETURN_LINK === 'set') {
    context.addIssue({ code: 'custom', path: ['LMH_DEV_RETURN_LINK'], message: 'Development return links are forbidden' });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const vercelAppEnvironment = {
  development: 'development',
  preview: 'staging',
  production: 'production',
} as const;

export function parseServerEnv(input: Record<string, unknown> = process.env): ServerEnv {
  const appEnv = input.APP_ENV ?? (process.env.NODE_ENV === 'test' ? 'test' : 'development');
  return serverEnvSchema.parse({
    ...input,
    APP_ENV: appEnv,
    APP_VERSION: input.APP_VERSION ?? (appEnv === 'test' ? 'test' : 'development'),
  });
}

export function parseRuntimeEnv(input: Record<string, string | undefined> = process.env): ServerEnv {
  const vercelEnvironment = input.VERCEL_ENV;
  if (vercelEnvironment) {
    const expected = vercelAppEnvironment[vercelEnvironment as keyof typeof vercelAppEnvironment];
    if (!expected) throw new Error(`Unsupported VERCEL_ENV: ${vercelEnvironment}`);
    if (!input.APP_ENV) throw new Error(`APP_ENV is required on Vercel ${vercelEnvironment}`);
    if (input.APP_ENV !== expected) {
      throw new Error(`APP_ENV must be ${expected} on Vercel ${vercelEnvironment}`);
    }
  }

  return parseServerEnv(input);
}
