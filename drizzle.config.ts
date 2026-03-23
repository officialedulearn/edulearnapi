import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({
  path: '.env',
});

function postgresUrlWithLongStatementTimeout(connectionUrl: string): string {
  try {
    const u = new URL(connectionUrl);
    const opts = u.searchParams.get('options') ?? '';
    if (opts.includes('statement_timeout')) return connectionUrl;
    u.searchParams.set(
      'options',
      opts ? `${opts} -c statement_timeout=0` : '-c statement_timeout=0',
    );
    return u.toString();
  } catch {
    return connectionUrl;
  }
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // biome-ignore lint: Forbidden non-null assertion.
    url: postgresUrlWithLongStatementTimeout(process.env.POSTGRES_URL!),
  },
});
