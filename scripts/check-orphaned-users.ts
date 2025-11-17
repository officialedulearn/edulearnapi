import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { supabaseAdmin } from '../lib/supabase';
import db from '../drizzle';
import { user } from '../lib/db/schema';

async function checkOrphanedUsers() {
  console.log('🔍 Checking for orphaned users...\n');

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

    console.log('═══════════════════════════════════════════════════════════');
    console.log('                      ANALYSIS REPORT                      ');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`📊 Statistics:`);
    console.log(`   Total Supabase Auth users:  ${allAuthUsers.length}`);
    console.log(`   Total Database users:       ${dbUsers.length}`);
    console.log(`   Orphaned Auth users:        ${orphanedUsers.length}`);
    console.log(`   Sync percentage:            ${((1 - orphanedUsers.length / allAuthUsers.length) * 100).toFixed(2)}%\n`);

    if (orphanedUsers.length === 0) {
      console.log('✅ Perfect sync! No orphaned users found.\n');
      console.log('   Database and Supabase Auth are perfectly synchronized.');
      process.exit(0);
      return;
    }

    console.log(`⚠️  Found ${orphanedUsers.length} orphaned Supabase Auth users:\n`);
    console.log('   (These users exist in Supabase Auth but NOT in the database)\n');

    orphanedUsers.forEach((user, index) => {
      const createdDate = new Date(user.created_at).toLocaleString();
      const lastSignIn = user.last_sign_in_at 
        ? new Date(user.last_sign_in_at).toLocaleString()
        : 'Never';
      
      console.log(`${(index + 1).toString().padStart(3, ' ')}. ${user.email}`);
      console.log(`     ID: ${user.id}`);
      console.log(`     Created: ${createdDate}`);
      console.log(`     Last Sign In: ${lastSignIn}`);
      console.log(`     Confirmed: ${user.email_confirmed_at ? 'Yes' : 'No'}\n`);
    });

    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('💡 Next Steps:\n');
    console.log('   1. Review the list above carefully');
    console.log('   2. To delete these orphaned users, run:');
    console.log('      npm run cleanup:orphaned-users\n');
    console.log('   3. Or manually delete specific users if needed\n');

    if (orphanedUsers.length > 50) {
      console.log('⚠️  WARNING: Large number of orphaned users detected!');
      console.log('   Consider investigating why so many users are orphaned.');
      console.log('   Common causes:');
      console.log('   - Database creation failures');
      console.log('   - Network issues during signup');
      console.log('   - Application errors during user creation\n');
    }

    const recentOrphans = orphanedUsers.filter(u => {
      const createdDate = new Date(u.created_at);
      const daysSinceCreation = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceCreation < 7;
    });

    if (recentOrphans.length > 0) {
      console.log(`⚠️  ${recentOrphans.length} orphaned user(s) created in the last 7 days!`);
      console.log('   This suggests the issue may still be occurring.\n');
    }

  } catch (error) {
    console.error('\n❌ Error during analysis:', error);
    process.exit(1);
  }
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║        Orphaned Users Analysis (Read-Only)                ║');
console.log('║                                                            ║');
console.log('║  This script will analyze and report orphaned users       ║');
console.log('║  without making any changes.                              ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

checkOrphanedUsers();

