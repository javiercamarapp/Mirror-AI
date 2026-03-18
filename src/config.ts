export const config = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  fireworksApiKey: process.env.FIREWORKS_API_KEY ?? '',
  fashnApiKey: process.env.FASHN_API_KEY ?? '',
  birefnetApiUrl: process.env.BIREFNET_API_URL ?? 'http://localhost:7860',
  port: parseInt(process.env.PORT ?? '3000', 10),
} as const;

export function validateConfig(): void {
  const required: Array<keyof typeof config> = [
    'supabaseUrl',
    'supabaseServiceKey',
    'supabaseAnonKey',
  ];

  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Check your .env file against .env.example.'
    );
  }
}
