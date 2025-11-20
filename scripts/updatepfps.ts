import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import db from '../drizzle';
import { user } from '../lib/db/schema';
import {eq, isNull} from "drizzle-orm"
import axios from "axios"

const updateUserPFPs = async () => {
    try {
        const bearerToken = process.env.TWITTER_BEARER_TOKEN;
        
        if (!bearerToken) {
            console.error('❌ TWITTER_BEARER_TOKEN not found in environment variables');
            process.exit(1);
        }

        console.log('📊 Fetching users with empty profile pictures...');
        const users = await db.select().from(user).where(isNull(user.profilePictureURL));
        console.log(`✅ Found ${users.length} users to update\n`);

        if (users.length === 0) {
            console.log('✅ No users need updating!');
            return;
        }

        let successCount = 0;
        let failCount = 0;

        for (const sUser of users) {
            try {
                if (!sUser.username) {
                    console.log(`⚠️  Skipping ${sUser.email}: no username`);
                    failCount++;
                    continue;
                }

                const response = await axios.get(
                    `https://api.twitter.com/2/users/by/username/${sUser.username}`,
                    {
                      headers: {
                        Authorization: `Bearer ${bearerToken}`,
                      },
                      params: {
                        'user.fields': 'profile_image_url',
                      },
                    }
                  );

                if (response.data?.data?.profile_image_url) {
                    const profilePictureURL = response.data.data.profile_image_url;
                    
                    await db
                      .update(user)
                      .set({ profilePictureURL })
                      .where(eq(user.email, sUser.email));
                    
                    console.log(`✅ Updated PFP for ${sUser.email}`);
                    successCount++;
                } else {
                    console.log(`⚠️  No profile image found for ${sUser.username}`);
                    failCount++;
                }
            } catch (error: any) {
                if (error.response?.status === 404) {
                    console.log(`⚠️  User not found on Twitter: ${sUser.username}`);
                } else if (error.response?.status === 429) {
                    console.error(`❌ Rate limit exceeded. Please wait before retrying.`);
                    failCount++;
                    break;
                } else {
                    console.error(`❌ Error updating ${sUser.email}:`, error.message);
                }
                failCount++;
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log('\n📊 Update Summary:');
        console.log(`   ✅ Successfully updated: ${successCount} users`);
        console.log(`   ❌ Failed: ${failCount} users`);
        console.log(`   📈 Total processed: ${users.length} users\n`);

    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

updateUserPFPs()