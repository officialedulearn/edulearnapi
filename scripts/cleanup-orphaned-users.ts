import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { supabaseAdmin } from '../lib/supabase';
import db from '../drizzle';
import { user } from '../lib/db/schema';

async function cleanupOrphanedUsers() {
  console.log('🔍 Starting orphaned user cleanup...\n');

  try {
    console.log('📊 Fetching all Supabase Auth users...');
    let allAuthUsers: any[] = [];
    let page = 1;
    const perPage = 1000;

    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });

      if (error) {
        console.error('❌ Error fetching Supabase users:', error);
        throw error;
      }

      if (!data.users || data.users.length === 0) {
        break;
      }

      allAuthUsers = allAuthUsers.concat(data.users);
      console.log(`   Fetched page ${page}: ${data.users.length} users`);
      page++;

      if (data.users.length < perPage) {
        break;
      }
    }

    console.log(`✅ Total Supabase Auth users: ${allAuthUsers.length}\n`);

    console.log('📊 Fetching all database users...');
    const dbUsers = await db.select({ email: user.email }).from(user);
    console.log(`✅ Total database users: ${dbUsers.length}\n`);

    const dbEmails = new Set(dbUsers.map(u => u.email?.toLowerCase()));
    
    const orphanedUsers = allAuthUsers.filter(authUser => {
      const email = authUser.email?.toLowerCase();
      return email && !dbEmails.has(email);
    });

    console.log(`\n🔍 Found ${orphanedUsers.length} orphaned Supabase Auth users:\n`);

    if (orphanedUsers.length === 0) {
      console.log('✅ No orphaned users found! Database and Supabase Auth are in sync.\n');
      return;
    }

    orphanedUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} (ID: ${user.id}) - Created: ${user.created_at}`);
    });

    console.log('\n⚠️  WARNING: This will permanently delete these users from Supabase Auth!');
    console.log('⚠️  Make sure you have a backup if needed.\n');

    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('Do you want to proceed with deletion? (yes/no): ', async (answer: string) => {
      if (answer.toLowerCase() !== 'yes') {
        console.log('\n❌ Cleanup cancelled by user.');
        readline.close();
        process.exit(0);
        return;
      }

      console.log('\n🗑️  Starting deletion process...\n');
      
      let successCount = 0;
      let failCount = 0;

      for (const orphanedUser of orphanedUsers) {
        try {
          const { error } = await supabaseAdmin.auth.admin.deleteUser(orphanedUser.id);
          
          if (error) {
            console.error(`❌ Failed to delete ${orphanedUser.email}:`, error.message);
            failCount++;
          } else {
            console.log(`✅ Deleted: ${orphanedUser.email}`);
            successCount++;
          }
        } catch (err) {
          console.error(`❌ Error deleting ${orphanedUser.email}:`, err);
          failCount++;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log('\n📊 Cleanup Summary:');
      console.log(`   ✅ Successfully deleted: ${successCount} users`);
      console.log(`   ❌ Failed to delete: ${failCount} users`);
      console.log(`   📈 Total processed: ${orphanedUsers.length} users\n`);

      if (successCount > 0) {
        console.log('✅ Cleanup completed successfully!');
        
        const { data: remainingAuthUsers } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1,
        });
        
        console.log(`\n📊 Final Stats:`);
        console.log(`   Database users: ${dbUsers.length}`);
        console.log(`   Supabase Auth users: ${allAuthUsers.length - successCount} (estimated)`);
        console.log(`   Difference: ${Math.abs(dbUsers.length - (allAuthUsers.length - successCount))}\n`);
      }

      readline.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('\n❌ Fatal error during cleanup:', error);
    process.exit(1);
  }
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     Orphaned Supabase Auth Users Cleanup Script           ║');
console.log('║                                                            ║');
console.log('║  This script will identify and delete Supabase Auth       ║');
console.log('║  users that do not exist in your database.                ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

cleanupOrphanedUsers();

