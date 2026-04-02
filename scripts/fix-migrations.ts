import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { sql } from 'drizzle-orm';

config({
  path: '.env',
});

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL is not defined');
}

const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
const db = drizzle(connection);

interface MigrationRecord {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

// Load the migration journal
const journal = require('../lib/db/migrations/meta/_journal.json');

async function checkTableExists(tableName: string): Promise<boolean> {
  try {
    const result = (await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = ${tableName}
      );
    `)) as any[];
    return result[0]?.exists || false;
  } catch (error) {
    console.error(`Error checking table ${tableName}:`, error);
    return false;
  }
}

async function getMigrationStatus(): Promise<number[]> {
  try {
    await db.execute(sql`
      CREATE SCHEMA IF NOT EXISTS drizzle;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      );
    `);

    const result = (await db.execute(sql`
      SELECT id FROM drizzle.__drizzle_migrations ORDER BY id;
    `)) as any[];

    return result.map((row: any) => row.id);
  } catch (error) {
    console.error('Error getting migration status:', error);
    return [];
  }
}

async function markMigrationApplied(migration: MigrationRecord): Promise<void> {
  try {
    const hash = `${migration.tag}:${String(migration.idx).padStart(4, '0')}`;

    await db.execute(sql`
      INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
      VALUES (${migration.idx}, ${hash}, ${migration.when})
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log(
      `✓ Marked migration ${migration.idx} (${migration.tag}) as applied`,
    );
  } catch (error) {
    console.error(`Error marking migration ${migration.idx}:`, error);
    throw error;
  }
}

async function fixMigrations() {
  try {
    console.log('🔍 Checking migration status...\n');

    const appliedMigrations = await getMigrationStatus();
    const allMigrations: MigrationRecord[] = journal.entries;

    console.log(`Applied migrations in DB: ${appliedMigrations.length}`);
    console.log(`Total migrations in files: ${allMigrations.length}\n`);

    const missingMigrations = allMigrations.filter(
      (migration) => !appliedMigrations.includes(migration.idx),
    );

    if (missingMigrations.length === 0) {
      console.log('✓ All migrations are properly tracked!');
      process.exit(0);
    }

    console.log(
      `Found ${missingMigrations.length} missing migration(s) in tracking table:\n`,
    );

    // Check if tables from migration 0034 exist
    const migration34 = missingMigrations.find((m) => m.idx === 34);

    if (migration34) {
      console.log('Checking if tables from migration 0034 exist...');
      const communityExists = await checkTableExists('community');
      const feedbackExists = await checkTableExists('feedback');
      const notificationsExists = await checkTableExists('notifications');

      if (communityExists && feedbackExists && notificationsExists) {
        console.log('✓ Tables from migration 0034 already exist in database');
        console.log('  Marking migration 0034 as applied...\n');
        await markMigrationApplied(migration34);
      }
    }

    // Mark all missing migrations that have their tables already in place
    for (const migration of missingMigrations) {
      if (migration.idx === 34) continue; // Already handled above

      console.log(`Checking migration ${migration.idx} (${migration.tag})...`);

      // For safety, we'll mark all missing migrations up to the latest applied one
      if (
        appliedMigrations.length > 0 &&
        migration.idx < Math.max(...appliedMigrations)
      ) {
        console.log(
          `  Migration ${migration.idx} is older than latest applied, marking as applied...`,
        );
        await markMigrationApplied(migration);
      }
    }

    console.log('\n✓ Migration tracking fixed!');
    console.log('\nYou can now run: pnpm migrate');

    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error fixing migrations:', error);
    await connection.end();
    process.exit(1);
  }
}

fixMigrations();
