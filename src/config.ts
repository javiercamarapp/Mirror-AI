// ─── Environment Variable Definitions ────────────────────────────────────────

interface EnvVarDef<T> {
  envKey: string;
  required: boolean;
  default?: T;
  coerce: (value: string) => T;
}

function stringVar(envKey: string, opts: { required: true }): EnvVarDef<string>;
function stringVar(envKey: string, opts: { required?: false; default: string }): EnvVarDef<string>;
function stringVar(envKey: string, opts: { required?: boolean; default?: string }): EnvVarDef<string> {
  return { envKey, required: opts.required ?? false, default: opts.default, coerce: (v) => v };
}

function intVar(envKey: string, opts: { required?: false; default: number }): EnvVarDef<number> {
  return {
    envKey,
    required: false,
    default: opts.default,
    coerce: (v) => {
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) throw new Error(`${envKey} must be a valid integer, got "${v}"`);
      return n;
    },
  };
}

function boolVar(envKey: string, opts: { required?: false; default: boolean }): EnvVarDef<boolean> {
  return {
    envKey,
    required: false,
    default: opts.default,
    coerce: (v) => v === 'true' || v === '1',
  };
}

// ─── Config Schema ───────────────────────────────────────────────────────────

const ENV_SCHEMA = {
  // Supabase (required)
  supabaseUrl:        stringVar('SUPABASE_URL', { required: true }),
  supabaseServiceKey: stringVar('SUPABASE_SERVICE_KEY', { required: true }),
  supabaseAnonKey:    stringVar('SUPABASE_ANON_KEY', { required: true }),

  // AI & External APIs (required for core features)
  geminiApiKey:       stringVar('GEMINI_API_KEY', { required: true }),
  fireworksApiKey:    stringVar('FIREWORKS_API_KEY', { required: true }),
  fashnApiKey:        stringVar('FASHN_API_KEY', { required: true }),

  // Background removal service
  birefnetApiUrl:     stringVar('BIREFNET_API_URL', { default: 'http://localhost:7860' }),

  // Redis (optional — features degrade gracefully without it)
  redisUrl:           stringVar('REDIS_URL', { default: '' }),

  // Server
  port:               intVar('PORT', { default: 3000 }),
  nodeEnv:            stringVar('NODE_ENV', { default: 'development' }),
  logLevel:           stringVar('LOG_LEVEL', { default: 'info' }),

  // CORS
  allowedOrigins:     stringVar('ALLOWED_ORIGINS', { default: 'https://mirror-ai.app' }),

  // APNs Push Notifications (optional — push disabled without these)
  apnsKeyId:          stringVar('APNS_KEY_ID', { default: '' }),
  apnsTeamId:         stringVar('APNS_TEAM_ID', { default: '' }),
  apnsBundleId:       stringVar('APNS_BUNDLE_ID', { default: '' }),
  apnsAuthKey:        stringVar('APNS_AUTH_KEY', { default: '' }),

  // Feature flags
  enableAnalytics:    boolVar('ENABLE_ANALYTICS', { default: true }),
} as const;

// ─── Build & Validate ────────────────────────────────────────────────────────

type ConfigShape = {
  [K in keyof typeof ENV_SCHEMA]: (typeof ENV_SCHEMA)[K] extends EnvVarDef<infer T> ? T : never;
};

function buildConfig(): ConfigShape {
  const errors: string[] = [];
  const result: Record<string, unknown> = {};

  for (const [key, def] of Object.entries(ENV_SCHEMA)) {
    const raw = process.env[def.envKey];

    if (raw !== undefined && raw !== '') {
      try {
        result[key] = def.coerce(raw);
      } catch (err) {
        errors.push((err as Error).message);
      }
    } else if (def.required) {
      errors.push(`${def.envKey} is required but not set`);
    } else {
      result[key] = def.default;
    }
  }

  // Reject wildcard CORS in production and staging
  const isProduction = (result.nodeEnv as string) === 'production';
  const isStaging = (result.nodeEnv as string) === 'staging';
  if ((isProduction || isStaging) && (result.allowedOrigins as string) === '*') {
    errors.push(
      'ALLOWED_ORIGINS must not be "*" in production or staging. ' +
      'Set it to a comma-separated list of allowed origins (e.g. "https://mirror-ai.app,https://admin.mirror-ai.app").'
    );
  }

  // Even in development, warn if wildcard CORS is used
  if ((result.allowedOrigins as string) === '*' && !isProduction && !isStaging) {
    console.warn(
      '[config] WARNING: ALLOWED_ORIGINS is set to "*". This is acceptable only for local development.'
    );
  }

  // Validate that each origin looks like a proper URL (not just any string)
  if ((result.allowedOrigins as string) !== '*') {
    const origins = (result.allowedOrigins as string).split(',').map(o => o.trim());
    for (const origin of origins) {
      if (!/^https?:\/\/[^\s/]+$/.test(origin)) {
        errors.push(
          `ALLOWED_ORIGINS contains an invalid origin: "${origin}". ` +
          'Each origin must be a valid URL like "https://mirror-ai.app" (no trailing slash, no path).'
        );
      }
    }
  }

  if (errors.length > 0) {
    const message =
      '\n━━━ Missing or invalid environment variables ━━━\n' +
      errors.map((e) => `  ✗ ${e}`).join('\n') +
      '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      'Check your .env file against .env.example.\n';
    throw new Error(message);
  }

  return result as ConfigShape;
}

/**
 * Validated and type-coerced application configuration.
 * Fails fast at import time if required vars are missing.
 */
export const config = buildConfig();

/**
 * @deprecated Config is now validated at build time. Kept for backward compatibility.
 */
export function validateConfig(): void {
  // No-op: validation already happened in buildConfig()
}
