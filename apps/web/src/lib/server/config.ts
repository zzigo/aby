import { z } from 'zod';

const optionalText = z.string().trim().min(1).optional();

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ABY_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ABY_DEMO_MODE: z.enum(['true', 'false']).optional(),
  DATABASE_URL: optionalText,
  WASABI_ENDPOINT: optionalText,
  WASABI_REGION: optionalText,
  WASABI_BUCKET: optionalText,
  WASABI_ACCESS_KEY_ID: optionalText,
  WASABI_SECRET_ACCESS_KEY: optionalText,
  ABY_STORAGE_PREFIX: z.string().trim().default('aby/media/'),
  ABY_PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  FFPROBE_PATH: z.string().trim().default('ffprobe'),
  FFPROBE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  LOGTO_ISSUER_URL: optionalText,
  LOGTO_CLIENT_ID: optionalText,
  LOGTO_CLIENT_SECRET: optionalText,
  QDRANT_URL: optionalText
});

export type AbyConfig = ReturnType<typeof readConfig>;

export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
  const env = EnvironmentSchema.parse(environment);
  const production = env.NODE_ENV === 'production';
  const demoMode = env.ABY_DEMO_MODE ? env.ABY_DEMO_MODE === 'true' : !production;
  if (production && demoMode) throw new Error('ABY_DEMO_MODE cannot be enabled in production');
  const normalizedPrefix = env.ABY_STORAGE_PREFIX.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '') + '/';
  if (normalizedPrefix !== 'aby/media/') throw new Error('ABY_STORAGE_PREFIX must remain inside the reserved aby/media/ boundary');
  return {
    ...env,
    production,
    demoMode,
    storagePrefix: normalizedPrefix,
    databaseConfigured: Boolean(env.DATABASE_URL),
    wasabiConfigured: Boolean(env.WASABI_ENDPOINT && env.WASABI_REGION && env.WASABI_BUCKET && env.WASABI_ACCESS_KEY_ID && env.WASABI_SECRET_ACCESS_KEY),
    logtoConfigured: Boolean(env.LOGTO_ISSUER_URL && env.LOGTO_CLIENT_ID && env.LOGTO_CLIENT_SECRET),
    qdrantConfigured: Boolean(env.QDRANT_URL)
  };
}

