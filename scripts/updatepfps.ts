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
        let processedCount = 0;

        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const CONCURRENCY_LIMIT = 5;
        const REQUEST_DELAY = 200;

        const processUser = async (sUser: typeof users[0]) => {
            if (!sUser.username) {
                console.log(`⚠️  Skipping ${sUser.email}: no username`);
                return { success: false, skipped: true };
            }

            let retries = 0;
            const maxRetries = 2;

            while (retries <= maxRetries) {
                try {
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
                        return { success: true };
                    } else {
                        console.log(`⚠️  No profile image found for ${sUser.username}`);
                        return { success: false };
                    }
                } catch (error: any) {
                    if (error.response?.status === 404) {
                        console.log(`⚠️  User not found on Twitter: ${sUser.username}`);
                        return { success: false };
                    } else if (error.response?.status === 429) {
                        const resetTime = error.response?.headers?.['x-rate-limit-reset'];
                        if (resetTime && retries < maxRetries) {
                            const waitTime = (parseInt(resetTime) * 1000) - Date.now() + 1000;
                            if (waitTime > 0) {
                                console.log(`⏳ Rate limit hit. Waiting ${Math.ceil(waitTime / 1000)}s for reset...`);
                                await delay(waitTime);
                                retries++;
                                continue;
                            }
                        }
                        console.error(`❌ Rate limit exceeded for ${sUser.username}`);
                        return { success: false };
                    } else {
                        if (retries < maxRetries) {
                            retries++;
                            const backoffDelay = Math.min(500 * Math.pow(2, retries), 3000);
                            await delay(backoffDelay);
                            continue;
                        }
                        console.error(`❌ Error updating ${sUser.email}:`, error.message);
                        return { success: false };
                    }
                }
            }
            return { success: false };
        };

        for (let i = 0; i < users.length; i += CONCURRENCY_LIMIT) {
            const batch = users.slice(i, i + CONCURRENCY_LIMIT);
            const results = await Promise.all(
                batch.map(sUser => processUser(sUser))
            );

            results.forEach(result => {
                processedCount++;
                if (result.success) {
                    successCount++;
                } else if (!result.skipped) {
                    failCount++;
                }
            });

            if (i + CONCURRENCY_LIMIT < users.length) {
                await delay(REQUEST_DELAY);
            }
        }

        console.log('\n📊 Update Summary:');
        console.log(`   ✅ Successfully updated: ${successCount} users`);
        console.log(`   ❌ Failed: ${failCount} users`);
        console.log(`   📈 Total processed: ${processedCount} / ${users.length} users\n`);

    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

updateUserPFPs()