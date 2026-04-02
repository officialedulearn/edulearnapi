import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';

config({
  path: '.env',
});

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('POSTGRES_URL environment variable is not set');
}

const client = postgres(connectionString, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
  transform: {
    undefined: null,
  },
});

const db = drizzle(client);

export default db;
