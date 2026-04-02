import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import db from '../drizzle';
import { user } from '../lib/db/schema';
import { eq, isNull } from 'drizzle-orm';
import axios from 'axios';

const updateUserPFPs = async () => {
  try {
    const bearerToken = process.env.TWITTER_BEARER_TOKEN;

    if (!bearerToken) {
      console.error(
        '❌ TWITTER_BEARER_TOKEN not found in environment variables',
      );
      process.exit(1);
    }

    console.log('📊 Fetching users with empty profile pictures...');
    const users = await db
      .select()
      .from(user)
      .where(isNull(user.profilePictureURL));
    console.log(`✅ Found ${users.length} users to update\n`);

    if (users.length === 0) {
      console.log('✅ No users need updating!');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let processedCount = 0;

    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    let rateLimitRemaining = 300;
    let rateLimitReset = Date.now() + 15 * 60 * 1000;
    const BASE_DELAY = 3000;

    const checkAndWaitForRateLimit = async () => {
      const now = Date.now();

      if (rateLimitRemaining <= 5) {
        const waitTime = rateLimitReset - now + 1000;
        if (waitTime > 0) {
          console.log(
            `⏳ Rate limit low (${rateLimitRemaining} remaining). Waiting ${Math.ceil(waitTime / 1000)}s for reset...`,
          );
          await delay(waitTime);
          rateLimitRemaining = 300;
          rateLimitReset = Date.now() + 15 * 60 * 1000;
        }
      }
    };

    for (const sUser of users) {
      try {
        if (!sUser.username) {
          console.log(`⚠️  Skipping ${sUser.email}: no username`);
          failCount++;
          processedCount++;
          continue;
        }

        await checkAndWaitForRateLimit();

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
            },
          );

          const remaining = parseInt(
            response.headers['x-rate-limit-remaining'] || '0',
          );
          const reset = parseInt(response.headers['x-rate-limit-reset'] || '0');

          if (remaining !== 0) {
            rateLimitRemaining = remaining;
          }
          if (reset !== 0) {
            rateLimitReset = reset * 1000;
          }

          if (response.data?.data?.profile_image_url) {
            const profilePictureURL = response.data.data.profile_image_url;

            await db
              .update(user)
              .set({ profilePictureURL })
              .where(eq(user.email, sUser.email));

            console.log(
              `✅ Updated PFP for ${sUser.email} (${rateLimitRemaining} requests remaining)`,
            );
            successCount++;
          } else {
            console.log(`⚠️  No profile image found for ${sUser.username}`);
            failCount++;
          }
        } catch (error: any) {
          if (error.response?.status === 404) {
            console.log(`⚠️  User not found on Twitter: ${sUser.username}`);
            failCount++;
          } else if (error.response?.status === 429) {
            const resetTime = error.response?.headers?.['x-rate-limit-reset'];
            if (resetTime) {
              rateLimitReset = parseInt(resetTime) * 1000;
              rateLimitRemaining = 0;
              const waitTime = rateLimitReset - Date.now() + 1000;
              if (waitTime > 0) {
                console.log(
                  `⏳ Rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)}s for reset...`,
                );
                await delay(waitTime);
                rateLimitRemaining = 300;
                rateLimitReset = Date.now() + 15 * 60 * 1000;

                try {
                  const retryResponse = await axios.get(
                    `https://api.twitter.com/2/users/by/username/${sUser.username}`,
                    {
                      headers: {
                        Authorization: `Bearer ${bearerToken}`,
                      },
                      params: {
                        'user.fields': 'profile_image_url',
                      },
                    },
                  );

                  const retryRemaining = parseInt(
                    retryResponse.headers['x-rate-limit-remaining'] || '0',
                  );
                  const retryReset = parseInt(
                    retryResponse.headers['x-rate-limit-reset'] || '0',
                  );

                  if (retryRemaining !== 0) {
                    rateLimitRemaining = retryRemaining;
                  }
                  if (retryReset !== 0) {
                    rateLimitReset = retryReset * 1000;
                  }

                  if (retryResponse.data?.data?.profile_image_url) {
                    const profilePictureURL =
                      retryResponse.data.data.profile_image_url;

                    await db
                      .update(user)
                      .set({ profilePictureURL })
                      .where(eq(user.email, sUser.email));

                    console.log(
                      `✅ Updated PFP for ${sUser.email} (${rateLimitRemaining} requests remaining)`,
                    );
                    successCount++;
                  } else {
                    console.log(
                      `⚠️  No profile image found for ${sUser.username}`,
                    );
                    failCount++;
                  }
                } catch (retryError: any) {
                  console.error(
                    `❌ Error retrying ${sUser.username}:`,
                    retryError.message,
                  );
                  failCount++;
                }
              } else {
                failCount++;
              }
            } else {
              console.error(
                `❌ Rate limit exceeded for ${sUser.username} (no reset time)`,
              );
              failCount++;
            }
          } else {
            console.error(`❌ Error updating ${sUser.email}:`, error.message);
            failCount++;
          }
        }

        processedCount++;

        const delayTime = rateLimitRemaining > 50 ? BASE_DELAY : BASE_DELAY * 2;
        await delay(delayTime);
      } catch (error: any) {
        console.error(
          `❌ Unexpected error processing ${sUser.email}:`,
          error.message,
        );
        failCount++;
        processedCount++;
      }
    }

    console.log('\n📊 Update Summary:');
    console.log(`   ✅ Successfully updated: ${successCount} users`);
    console.log(`   ❌ Failed: ${failCount} users`);
    console.log(
      `   📈 Total processed: ${processedCount} / ${users.length} users\n`,
    );
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
};

updateUserPFPs();
