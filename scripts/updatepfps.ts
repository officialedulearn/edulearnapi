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

        const waitForRateLimit = async (error: any) => {
            const resetTime = error.response?.headers?.['x-rate-limit-reset'];
            if (resetTime) {
                const waitTime = (parseInt(resetTime) * 1000) - Date.now() + 1000;
                if (waitTime > 0) {
                    console.log(`⏳ Rate limit reset at ${new Date(parseInt(resetTime) * 1000).toLocaleTimeString()}. Waiting ${Math.ceil(waitTime / 1000)} seconds...`);
                    await delay(waitTime);
                    return true;
                }
            }
            return false;
        };

        for (const sUser of users) {
            try {
                if (!sUser.username) {
                    console.log(`⚠️  Skipping ${sUser.email}: no username`);
                    failCount++;
                    processedCount++;
                    continue;
                }

                let retries = 0;
                const maxRetries = 3;
                let success = false;

                while (retries < maxRetries && !success) {
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
                            successCount++;
                            success = true;
                        } else {
                            console.log(`⚠️  No profile image found for ${sUser.username}`);
                            failCount++;
                            success = true;
                        }
                    } catch (error: any) {
                        if (error.response?.status === 404) {
                            console.log(`⚠️  User not found on Twitter: ${sUser.username}`);
                            failCount++;
                            success = true;
                        } else if (error.response?.status === 429) {
                            const waited = await waitForRateLimit(error);
                            if (waited) {
                                retries++;
                                console.log(`🔄 Retrying (${retries}/${maxRetries})...`);
                            } else {
                                console.error(`❌ Rate limit exceeded. Skipping ${sUser.username}`);
                                failCount++;
                                success = true;
                            }
                        } else {
                            if (retries < maxRetries - 1) {
                                retries++;
                                const backoffDelay = Math.min(1000 * Math.pow(2, retries), 10000);
                                console.log(`⚠️  Error updating ${sUser.email}: ${error.message}. Retrying in ${backoffDelay}ms...`);
                                await delay(backoffDelay);
                            } else {
                                console.error(`❌ Error updating ${sUser.email}:`, error.message);
                                failCount++;
                                success = true;
                            }
                        }
                    }
                }

                processedCount++;
                await delay(1000);
            } catch (error: any) {
                console.error(`❌ Unexpected error processing ${sUser.email}:`, error.message);
                failCount++;
                processedCount++;
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