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

async function syncMigrations() {
  try {
    console.log('🔄 Syncing Drizzle migrations...\n');

    const journalPath = path.join(__dirname, '../lib/db/migrations/meta/_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));

    const currentMigrations = await db.execute(sql`
      SELECT * FROM drizzle.__drizzle_migrations ORDER BY id;
    `) as any[];

    console.log(`📊 Journal has ${journal.entries.length} migrations`);
    console.log(`📊 Database has ${currentMigrations.length} migration records\n`);

    const maxDbId = currentMigrations.length > 0 
      ? Math.max(...currentMigrations.map((m: any) => m.id))
      : -1;

    console.log(`Highest migration ID in database: ${maxDbId}\n`);
    let markedCount = 0;
    for (const entry of journal.entries) {
      if (entry.idx <= maxDbId) {
        const exists = currentMigrations.some((m: any) => m.id === entry.idx);
        
        if (!exists) {
          const hash = `${entry.tag}:${String(entry.idx).padStart(4, '0')}`;
          await db.execute(sql`
            INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
            VALUES (${entry.idx}, ${hash}, ${entry.when})
            ON CONFLICT (id) DO NOTHING;
          `);
          console.log(`✓ Marked migration ${entry.idx} (${entry.tag}) as applied`);
          markedCount++;
        }
      }
    }

    if (markedCount === 0) {
      console.log('✓ All migrations are already properly synced!');
    } else {
      console.log(`\n✓ Synced ${markedCount} migration(s)`);
    }

    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error syncing migrations:', error);
    await connection.end();
    process.exit(1);
  }
}

syncMigrations();
