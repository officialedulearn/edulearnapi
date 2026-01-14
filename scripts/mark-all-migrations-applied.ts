import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

config({
  path: '.env',
});

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL is not defined');
}

const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
const db = drizzle(connection);

async function markAllMigrationsApplied() {
  try {
    console.log('🔧 Marking all existing migrations as applied...\n');

    const journalPath = path.join(__dirname, '../lib/db/migrations/meta/_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));

    console.log(`Found ${journal.entries.length} migrations in journal\n`);

    const currentMigrations = await db.execute(sql`
      SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id;
    `) as any[];

    console.log(`Currently ${currentMigrations.length} migrations recorded in database\n`);

    let addedCount = 0;
    for (const entry of journal.entries) {
      const exists = currentMigrations.some((m: any) => m.id === entry.idx);
      
      if (!exists) {
        const hash = entry.tag;
        await db.execute(sql`
          INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
          VALUES (${entry.idx}, ${hash}, ${entry.when})
          ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash;
        `);
        console.log(`✓ Marked migration ${entry.idx} (${entry.tag}) as applied`);
        addedCount++;
      } else {
        const currentHash = currentMigrations.find((m: any) => m.id === entry.idx)?.hash;
        if (currentHash !== entry.tag) {
          await db.execute(sql`
            UPDATE drizzle.__drizzle_migrations 
            SET hash = ${entry.tag}
            WHERE id = ${entry.idx};
          `);
          console.log(`✓ Updated hash for migration ${entry.idx} (${entry.tag})`);
          addedCount++;
        }
      }
    }

    if (addedCount === 0) {
      console.log('\n✓ All migrations were already properly marked!');
    } else {
      console.log(`\n✓ Processed ${addedCount} migration(s)`);
    }

    console.log('\n🎉 All migrations are now marked as applied!');
    console.log('You can now safely run: pnpm migrate');

    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    await connection.end();
    process.exit(1);
  }
}

markAllMigrationsApplied();
