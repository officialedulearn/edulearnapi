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

// Load the migration journal
const journal = require('../lib/db/migrations/meta/_journal.json');

async function checkMigrations() {
  try {
    console.log('🔍 Checking migration discrepancies...\n');

    // Get migrations from DB
    const dbMigrations = (await db.execute(sql`
      SELECT id, hash, created_at 
      FROM drizzle.__drizzle_migrations 
      ORDER BY id;
    `)) as any[];

    // Get migrations from journal
    const journalMigrations = journal.entries;

    console.log(`Migrations in database: ${dbMigrations.length}`);
    console.log(`Migrations in journal: ${journalMigrations.length}\n`);

    // Show DB migrations
    console.log('=== Database Migrations ===');
    dbMigrations.forEach((m: any) => {
      console.log(`  ${m.id}: ${m.hash}`);
    });

    console.log('\n=== Journal Migrations ===');
    journalMigrations.forEach((m: any) => {
      console.log(`  ${m.idx}: ${m.tag}`);
    });

    // Find discrepancies
    console.log('\n=== Discrepancies ===');

    const dbIds = dbMigrations.map((m: any) => m.id);
    const journalIds = journalMigrations.map((m: any) => m.idx);

    const inDbNotInJournal = dbIds.filter(
      (id: number) => !journalIds.includes(id),
    );
    const inJournalNotInDb = journalIds.filter(
      (id: number) => !dbIds.includes(id),
    );

    if (inDbNotInJournal.length > 0) {
      console.log('\nMigrations in DB but NOT in journal:');
      inDbNotInJournal.forEach((id: number) => {
        const dbMig = dbMigrations.find((m: any) => m.id === id);
        console.log(`  ${id}: ${dbMig?.hash}`);
      });
    }

    if (inJournalNotInDb.length > 0) {
      console.log('\nMigrations in journal but NOT in DB:');
      inJournalNotInDb.forEach((id: number) => {
        const journalMig = journalMigrations.find((m: any) => m.idx === id);
        console.log(`  ${id}: ${journalMig?.tag}`);
      });
    }

    if (inDbNotInJournal.length === 0 && inJournalNotInDb.length === 0) {
      console.log('✓ All migrations are in sync!');
    }

    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await connection.end();
    process.exit(1);
  }
}

checkMigrations();
