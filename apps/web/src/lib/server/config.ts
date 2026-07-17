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
  WASABI_ROOT_PREFIX: z.string().trim().default(''),
  WASABI_ACCESS_KEY_ID: optionalText,
  WASABI_SECRET_ACCESS_KEY: optionalText,
  ABY_STORAGE_PREFIX: z.string().trim().default('aby/'),
  ABY_AUDIO_PREFIX: z.string().trim().default('aby/aud/'),
  ABY_VIDEO_PREFIX: z.string().trim().default('aby/mov/'),
  ABY_SOURCE_AUDIO_PREFIX: z.string().trim().default('ref/'),
  ABY_SOURCE_VIDEO_PREFIX: z.string().trim().default('mov/'),
  ABY_INGEST_MAX_SOURCE_BYTES: z.coerce.number().int().positive().default(1_073_741_824),
  ABY_PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  FFPROBE_PATH: z.string().trim().default('ffprobe'),
  FFPROBE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  FFMPEG_PATH: z.string().trim().default('ffmpeg'),
  FFMPEG_ANALYSIS_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(1_800_000).default(900_000),
  FPCALC_PATH: z.string().trim().default('fpcalc'),
  LOGTO_ISSUER_URL: optionalText,
  LOGTO_CLIENT_ID: optionalText,
  LOGTO_CLIENT_SECRET: optionalText,
  QDRANT_URL: optionalText,
  MUSICBRAINZ_BASE_URL: z.string().url().default('https://musicbrainz.org/ws/2'),
  COVER_ART_ARCHIVE_BASE_URL: z.string().url().default('https://coverartarchive.org'),
  DISCOGS_BASE_URL: z.string().url().default('https://api.discogs.com'),
  DISCOGS_CONSUMER_KEY: optionalText,
  DISCOGS_CONSUMER_SECRET: optionalText,
  ABY_EXTERNAL_METADATA_CONTACT: z.string().trim().default('https://aby.zztt.org'),
  ACOUSTID_CLIENT_API_KEY: z.string().trim().default('8Xt5HI6Y')
});

export type AbyConfig = ReturnType<typeof readConfig>;

export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
  const env = EnvironmentSchema.parse(environment);
  const production = env.NODE_ENV === 'production';
  const demoMode = env.ABY_DEMO_MODE ? env.ABY_DEMO_MODE === 'true' : !production;
  if (production && demoMode) throw new Error('ABY_DEMO_MODE cannot be enabled in production');
  const normalizePrefix = (value: string) => value.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '') + '/';
  const wasabiRootPrefix = env.WASABI_ROOT_PREFIX ? normalizePrefix(env.WASABI_ROOT_PREFIX) : '';
  if (wasabiRootPrefix.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('WASABI_ROOT_PREFIX cannot contain traversal segments');
  }
  const normalizedPrefix = normalizePrefix(env.ABY_STORAGE_PREFIX);
  const audioPrefix = normalizePrefix(env.ABY_AUDIO_PREFIX);
  const videoPrefix = normalizePrefix(env.ABY_VIDEO_PREFIX);
  const sourceAudioPrefix = normalizePrefix(env.ABY_SOURCE_AUDIO_PREFIX);
  const sourceVideoPrefix = normalizePrefix(env.ABY_SOURCE_VIDEO_PREFIX);
  if (normalizedPrefix !== 'aby/') throw new Error('ABY_STORAGE_PREFIX must be the canonical aby/ boundary');
  if (!audioPrefix.startsWith(normalizedPrefix) || !videoPrefix.startsWith(normalizedPrefix) || audioPrefix === videoPrefix) {
    throw new Error('Aby audio and video prefixes must be distinct children of aby/');
  }
  if (sourceAudioPrefix.startsWith(normalizedPrefix) || sourceVideoPrefix.startsWith(normalizedPrefix)) {
    throw new Error('Legacy source prefixes must remain outside the canonical aby/ boundary');
  }
  return {
    ...env,
    production,
    demoMode,
    storagePrefix: normalizedPrefix,
    wasabiRootPrefix,
    audioPrefix,
    videoPrefix,
    sourceAudioPrefix,
    sourceVideoPrefix,
    databaseConfigured: Boolean(env.DATABASE_URL),
    wasabiConfigured: Boolean(env.WASABI_ENDPOINT && env.WASABI_REGION && env.WASABI_BUCKET && env.WASABI_ACCESS_KEY_ID && env.WASABI_SECRET_ACCESS_KEY),
    logtoConfigured: Boolean(env.LOGTO_ISSUER_URL && env.LOGTO_CLIENT_ID && env.LOGTO_CLIENT_SECRET),
    discogsConfigured: Boolean(env.DISCOGS_CONSUMER_KEY && env.DISCOGS_CONSUMER_SECRET),
    qdrantConfigured: Boolean(env.QDRANT_URL)
  };
}
