import { config } from 'dotenv';
import db from '../drizzle';
import { sql } from 'drizzle-orm';

config({
  path: '.env',
});

async function checkDbState() {
  try {
    console.log('🔍 Checking database state...\n');

    // Check drizzle-kit migrations table
    console.log('=== Drizzle-Kit Migrations Table ===');
    try {
      const kitMigrations = (await db.execute(sql`
        SELECT * FROM drizzle.__drizzle_migrations ORDER BY id;
      `)) as any[];
      console.log(
        `Found ${kitMigrations.length} migrations in drizzle.__drizzle_migrations`,
      );
      kitMigrations.forEach((row: any) => {
        console.log(`  ${row.id}: ${row.hash}`);
      });
    } catch (error: any) {
      console.log('Error:', error.message);
    }

    console.log('\n=== Checking if community table exists ===');
    const communityExists = (await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'community'
      );
    `)) as any[];
    console.log('Community table exists:', communityExists[0]?.exists);

    console.log('\n=== All tables in public schema ===');
    const tables = (await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `)) as any[];
    console.log('Tables:', tables.map((r: any) => r.table_name).join(', '));

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkDbState();
