import { Injectable, BadRequestException, Inject, forwardRef, OnModuleInit, Logger } from '@nestjs/common';
import axios from 'axios';
import { AuthService } from 'src/auth/auth.service';
import * as crypto from 'crypto';
import { TwitterApi } from 'twitter-api-v2';
import { eq, sql } from 'drizzle-orm';
import db from '../../drizzle';
import { user, userReward } from '../../lib/db/schema';

@Injectable()
export class TwitterService implements OnModuleInit {
    private readonly logger = new Logger(TwitterService.name);
    private botClient: TwitterApi; 
    private writeClient: TwitterApi; 

    constructor(
        @Inject(forwardRef(() => AuthService))
        private authService: AuthService
    ) {
        if (process.env.TWITTER_BEARER_TOKEN) {
            this.botClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
        }
        
        if (process.env.TWITTER_API_KEY && 
            process.env.TWITTER_API_SECRET && 
            process.env.TWITTER_ACCESS_TOKEN && 
            process.env.TWITTER_ACCESS_TOKEN_SECRET) {
            this.writeClient = new TwitterApi({
                appKey: process.env.TWITTER_API_KEY,
                appSecret: process.env.TWITTER_API_SECRET,
                accessToken: process.env.TWITTER_ACCESS_TOKEN,
                accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
            });
        }
    }

    private clientId = process.env.TWITTER_CLIENT_ID;
    private clientSecret = process.env.TWITTER_CLIENT_SECRET;
    private redirectUri = process.env.TWITTER_REDIRECT_URI;
    private apiKey = process.env.TWITTER_API_KEY || process.env.TWITTER_CLIENT_ID;
    private apiSecret = process.env.TWITTER_API_SECRET || process.env.TWITTER_CLIENT_SECRET;
    private accessToken = process.env.TWITTER_ACCESS_TOKEN;
    private accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

  generateAuthUrl(redirectUri?: string): { url: string; codeVerifier: string; codeChallenge: string } {
    const finalRedirectUri = redirectUri || this.redirectUri || '';
    
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId || '',
      redirect_uri: finalRedirectUri,
      scope: 'tweet.read tweet.write users.read offline.access',
      state: crypto.randomBytes(16).toString('hex'),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const url = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
    
    return {
      url,
      codeVerifier,
      codeChallenge
    };
  }

  async getAccessToken(code: string, providedRedirectUri?: string, providedCodeVerifier?: string) {
    try {
      const finalRedirectUri = providedRedirectUri || this.redirectUri || '';
      
      if (!providedCodeVerifier) {
        throw new BadRequestException('Code verifier is required for PKCE flow');
      }
      
      const params = new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: this.clientId || '',
        redirect_uri: finalRedirectUri,
        code_verifier: providedCodeVerifier,
      });

      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  
       
      const res = await axios.post(
        "https://api.twitter.com/2/oauth2/token",
        params,
        { 
          headers: { 
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${credentials}`,
          } 
        }
      );
      
      if (!res.data || !res.data.access_token) {
        console.error('Twitter token response error:', res.data);
        throw new BadRequestException('Failed to get access token from Twitter');
      }
      
      return res.data.access_token;
    } catch (error) {
      console.error('Error getting Twitter access token:', error.response?.data || error.message);
      throw new BadRequestException(
        error.response?.data?.error_description || 
        error.response?.data?.error || 
        'Failed to exchange code for access token'
      );
    }
  }

  async getUserProfile(accessToken: string, userCaller: string) {
    try {
      const res = await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (!res.data || !res.data.data) {
        throw new BadRequestException('Failed to fetch user profile from Twitter');
      }
      
      const user = await this.authService.getUserByEmail(userCaller);

      if (!user) {
        throw new BadRequestException('User not found');
      }

      if(res.data.data.username !== user?.username) {
        await this.authService.editUser({
          name: res.data.data.name, 
          email: userCaller, 
          username: res.data.data.username,
          learning: user.learning || ''
        });
        await this.authService.verifyUser(userCaller);
      }
      
      await this.authService.verifyUser(userCaller);
      return res.data.data; 
    } catch (error) {
      console.error('Error getting Twitter user profile:', error.response?.data || error.message);
      throw new BadRequestException('Failed to fetch Twitter profile');
    }
  }

  async postTweet(
    text: string,
    options?: {
      card_uri?: string;
      community_id?: string;
      direct_message_deep_link?: string;
      edit_options?: {
        previous_post_id: string;
      };
      for_super_followers_only?: boolean;
      geo?: {
        place_id: string;
      };
      media?: {
        media_ids: string[];
        tagged_user_ids?: string[];
      };
      nullcast?: boolean;
      poll?: {
        duration_minutes: number;
        options: string[];
        reply_settings?: 'following' | 'mentionedUsers';
      };
      quote_tweet_id?: string;
      reply?: {
        exclude_reply_user_ids?: string[];
        in_reply_to_tweet_id: string;
      };
      reply_settings?: 'following' | 'mentionedUsers';
      share_with_followers?: boolean;
    },
    retryCount: number = 0
  ) {
    try {
      // Check if we're rate limited for tweets
      if (this.tweetRateLimitResetTime && Date.now() < this.tweetRateLimitResetTime) {
        const waitMinutes = Math.ceil((this.tweetRateLimitResetTime - Date.now()) / 60000);
        this.logger.warn(`⏳ Tweet rate limited. Waiting ${waitMinutes} more minute(s)...`);
        throw new BadRequestException(`Tweet rate limited. Please wait ${waitMinutes} minutes before trying again.`);
      }

      if (!this.apiKey || !this.apiSecret || !this.accessToken || !this.accessTokenSecret) {
        throw new BadRequestException(
          'Twitter OAuth 1.0a credentials missing. Required in .env:\n' +
          'TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET'
        );
      }

      this.logger.log('📤 Posting tweet using twitter-api-v2 library...');
      this.logger.log('  - Tweet text length:', text.length);
      if (retryCount > 0) {
        this.logger.log(`  - Retry attempt: ${retryCount}`);
      }

      const client = new TwitterApi({
        appKey: this.apiKey,
        appSecret: this.apiSecret,
        accessToken: this.accessToken,
        accessSecret: this.accessTokenSecret,
      });

      const tweetPayload: any = {
        text,
      };

      if (options) {
        if (options.card_uri) tweetPayload.card_uri = options.card_uri;
        if (options.community_id) tweetPayload.community_id = options.community_id;
        if (options.direct_message_deep_link) tweetPayload.direct_message_deep_link = options.direct_message_deep_link;
        if (options.edit_options) tweetPayload.edit_options = options.edit_options;
        if (options.for_super_followers_only !== undefined) tweetPayload.for_super_followers_only = options.for_super_followers_only;
        if (options.geo) tweetPayload.geo = options.geo;
        if (options.media) tweetPayload.media = options.media;
        if (options.nullcast !== undefined) tweetPayload.nullcast = options.nullcast;
        if (options.poll) tweetPayload.poll = options.poll;
        if (options.quote_tweet_id) tweetPayload.quote_tweet_id = options.quote_tweet_id;
        if (options.reply) tweetPayload.reply = options.reply;
        if (options.reply_settings) tweetPayload.reply_settings = options.reply_settings;
        if (options.share_with_followers !== undefined) tweetPayload.share_with_followers = options.share_with_followers;
      }

      const tweet = await client.v2.tweet(tweetPayload);

      this.logger.log('✅ Tweet posted successfully!')

      return tweet.data;
    } catch (error) {
      this.logger.error('❌ Error posting tweet:', error);

    
      if (error.code === 429) {
        const resetTime = error.rateLimit?.reset;
        if (resetTime) {
          this.tweetRateLimitResetTime = resetTime * 1000;
          const resetDate = new Date(this.tweetRateLimitResetTime);
          const waitMinutes = Math.ceil((this.tweetRateLimitResetTime - Date.now()) / 60000);
          this.logger.warn(`⏱️ Tweet rate limit reached. Will retry after ${resetDate.toLocaleTimeString()} (in ${waitMinutes} minutes)`);
        } else {
          this.tweetRateLimitResetTime = Date.now() + (15 * 60 * 1000);
          this.logger.warn('⏱️ Tweet rate limit reached. Will retry in 15 minutes');
        }
        if (retryCount < 3) {
          const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          this.logger.log(`🔄 Retrying tweet post in ${backoffDelay}ms (attempt ${retryCount + 1}/3)`);
          
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          return this.postTweet(text, options, retryCount + 1);
        } else {
          throw new BadRequestException('Tweet rate limit exceeded. Please try again later.');
        }
      }

      if (error.code === 401 || error.code === 403) {
        throw new BadRequestException('Authentication failed. Please check your Twitter credentials.');
      }
      
      throw new BadRequestException(
        error.data?.detail || 
        error.data?.title ||
        error.message || 
        'Failed to post tweet'
      );
    }
  }

  async onModuleInit() {
    if (this.botClient && this.writeClient) {
      this.logger.log('🤖 Starting Twitter bot listener (polling mode)...');
      this.listenToMentionsPolling();
    } else {
      if (!this.botClient) {
        this.logger.warn('⚠️ TWITTER_BEARER_TOKEN not configured. Bot listener not started.');
      }
      if (!this.writeClient) {
        this.logger.warn('⚠️ Twitter OAuth 1.0a credentials not configured. Bot cannot post replies.');
      }
    }
  }

  private lastCheckedTweetId: string | null = null;
  private rateLimitResetTime: number | null = null;
  private tweetRateLimitResetTime: number | null = null;
  private processedTweetIds: Set<string> = new Set();

  private async listenToMentionsPolling() {
    const pollInterval = 16 * 60 * 1000; 
    
    this.logger.log('🎧 Now polling for mentions every 16 minutes (Twitter API rate limit)...');
    this.logger.warn('⚠️  Note: Twitter Basic/Free tier has very limited rate limits.');
    this.logger.warn('⚠️  For real-time responses, you need Elevated or Enterprise access.');
      
    await this.checkForMentions();
    
    setInterval(async () => {
      await this.checkForMentions();
    }, pollInterval);
  }

  private async checkForMentions() {
    try {
      if (this.rateLimitResetTime && Date.now() < this.rateLimitResetTime) {
        const waitMinutes = Math.ceil((this.rateLimitResetTime - Date.now()) / 60000);
        this.logger.log(`⏳ Rate limited. Waiting ${waitMinutes} more minute(s)...`);
        return;
      }

      this.logger.log('🔍 Checking for new mentions...');

      const searchQuery = '@edulearnbot score';
      const tweets = await this.botClient.v2.search(searchQuery, {
        'tweet.fields': ['author_id', 'conversation_id', 'created_at', 'referenced_tweets'],
        'user.fields': ['username'],
        expansions: ['author_id'],
        max_results: 10,
        ...(this.lastCheckedTweetId && { since_id: this.lastCheckedTweetId }),
      });

      const tweetData = tweets?.data?.data || tweets?.data || [];
      if (!Array.isArray(tweetData) || tweetData.length === 0) {
        this.logger.log('✅ No new mentions found');
        return;
      }

      this.logger.log(`📩 Found ${tweetData.length} new mention(s)`);

      let processedCount = 0;
      for (const tweet of tweetData) {
        if (this.processedTweetIds.has(tweet.id)) {
          this.logger.log(`⏭️ Skipping already processed tweet: ${tweet.id}`);
          continue;
        }

        if (tweet.text?.toLowerCase().includes('@edulearnbot score')) {
          this.logger.log(`Processing tweet: ${tweet.text}`);
          await this.handleScoreRequest(tweet, tweets.includes);
          
          this.processedTweetIds.add(tweet.id);
          processedCount++;
          
          if (!this.lastCheckedTweetId || tweet.id > this.lastCheckedTweetId) {
            this.lastCheckedTweetId = tweet.id;
          }
          
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (this.processedTweetIds.size > 1000) {
        const idsArray = Array.from(this.processedTweetIds);
        this.processedTweetIds = new Set(idsArray.slice(-500));
      }

      this.logger.log(`✅ Processed ${processedCount} new tweet(s)`);
    } catch (error: any) {
      if (error.code === 429) {
        const resetTime = error.rateLimit?.reset;
        if (resetTime) {
          this.rateLimitResetTime = resetTime * 1000; 
          const resetDate = new Date(this.rateLimitResetTime);
          const waitMinutes = Math.ceil((this.rateLimitResetTime - Date.now()) / 60000);
          this.logger.warn(`⏱️  Rate limit reached. Will retry after ${resetDate.toLocaleTimeString()} (in ${waitMinutes} minutes)`);
        } else {
          this.logger.warn('⏱️  Rate limit reached. Will retry in 16 minutes');
        }
      } else {
        this.logger.error('❌ Error checking for mentions:', error.message || error);
      }
    }
  }

  private async listenToMentions() {
    try {
      const rules = await this.botClient.v2.streamRules();
      if (rules.data?.length) {
        await this.botClient.v2.updateStreamRules({
          delete: { ids: rules.data.map((rule) => rule.id) },
        });
      }

      await this.botClient.v2.updateStreamRules({
        add: [{ value: '@edulearnbot score', tag: 'score-requests' }],
      });

      this.logger.log('✅ Stream rules set up successfully');

      const stream = await this.botClient.v2.searchStream({
        'tweet.fields': ['author_id', 'conversation_id', 'created_at', 'referenced_tweets'],
        'user.fields': ['username'],
        expansions: ['author_id', 'referenced_tweets.id', 'referenced_tweets.id.author_id'],
        autoConnect: true,
      });

      stream.on('data', async (tweet) => {
        this.logger.log(`📩 Received tweet: ${tweet.data?.text}`);
        if (tweet.data?.text?.toLowerCase().includes('@edulearnbot score')) {
          await this.handleScoreRequest(tweet.data, tweet.includes);
        }
      });

      stream.on('error', (error) => {
        this.logger.error('❌ Stream error:', error);
        setTimeout(() => {
          this.logger.log('🔄 Reconnecting to stream...');
          this.listenToMentions();
        }, 5000);
      });

      this.logger.log('🎧 Now listening for mentions...');
    } catch (error) {
      this.logger.error('❌ Error setting up stream:', error);
    }
  }

  private async handleScoreRequest(tweet: any, includes: any) {
    try {
      const referencedTweets = tweet.referenced_tweets;
      if (!referencedTweets || referencedTweets.length === 0) {
        this.logger.warn('⚠️ Tweet is not a reply to another tweet');
        return;
      }

      const repliedTo = referencedTweets.find((ref: any) => ref.type === 'replied_to');
      if (!repliedTo) {
        this.logger.warn('⚠️ No replied_to tweet found');
        return;
      }

      this.logger.log(`🔍 Fetching parent tweet: ${repliedTo.id}`);

      const parentTweet = await this.botClient.v2.singleTweet(repliedTo.id, {
        'user.fields': ['username'],
        expansions: ['author_id'],
      });

      const parentAuthorUsername = parentTweet.includes?.users?.[0]?.username;
      if (!parentAuthorUsername) {
        this.logger.warn('⚠️ Could not get parent tweet author username');
        return;
      }

      if (parentAuthorUsername.toLowerCase() === 'edulearnbot') {
        this.logger.log('⚠️ Ignoring request to score the bot itself');
        return;
      }

      this.logger.log(`🎯 Scoring user: @${parentAuthorUsername}`);

      const requesterUsername = includes?.users?.find((u: any) => u.id === tweet.author_id)?.username || tweet.author_id;

      const scoreData = await this.calculateScore(parentAuthorUsername);

      let replyText: string;
      if (scoreData.found) {
        replyText = `@${requesterUsername} 📊 Score for @${parentAuthorUsername}:\n\n` +
                    `🎯 XP: ${scoreData.xp}\n` +
                    `📚 Learning: ${scoreData.learning}\n` +
                    `🏆 Rewards: ${scoreData.rewards}\n` +
                    `⚡ Total Score: ${scoreData.totalScore}`;
      } else {
        const funnyResponses = [
          `@${requesterUsername} Oops! @${parentAuthorUsername} seems to be living under a rock 🪨 - they're not an EduLearner yet! Time to join the learning revolution! 🚀`,
          `@${requesterUsername} Plot twist! @${parentAuthorUsername} is still using carrier pigeons 📮 instead of EduLearn. Someone send them an invite! 🎓`,
          `@${requesterUsername} Breaking news: @${parentAuthorUsername} hasn't discovered the secret sauce of learning yet! 🍝 They're missing out on all the XP! ⚡`,
          `@${requesterUsername} Alert! @${parentAuthorUsername} is still stuck in the stone age 🦕 - no EduLearn account detected! Time for an upgrade! 🔄`,
          `@${requesterUsername} Mystery solved! @${parentAuthorUsername} is probably still using a flip phone 📱 and hasn't joined the EduLearn party yet! 🎉`,
          `@${requesterUsername} Houston, we have a problem! @${parentAuthorUsername} is not in our learning database 🛸 - they're still using ancient scrolls! 📜`,
          `@${requesterUsername} Warning: @${parentAuthorUsername} detected in the wild without EduLearn powers! 🦸‍♂️ They need to level up ASAP! ⬆️`,
          `@${requesterUsername} Plot hole alert! @${parentAuthorUsername} is missing from our learning universe 🌌 - they're probably still using Windows 95! 💻`
        ];
        
        const randomResponse = funnyResponses[Math.floor(Math.random() * funnyResponses.length)];
        replyText = randomResponse;
      }

      await this.postTweet(replyText, {
        reply: {
          in_reply_to_tweet_id: tweet.id
        }
      });
      
      this.logger.log(`✅ Replied with score to @${requesterUsername}`);
    } catch (error) {
      this.logger.error('❌ Failed to handle score request:', error);
    }
  }

  private async calculateScore(username: string): Promise<{
    found: boolean;
    xp: number;
    learning: string;
    rewards: number;
    totalScore: number;
  }> {
    try {
      this.logger.log(`📊 Calculating score for ${username}`);
    
      const users = await db
        .select()
        .from(user)
        .where(eq(user.username, username))
        .limit(1);

      if (!users || users.length === 0) {
        this.logger.log(`⚠️ User ${username} not found in database`);
        return {
          found: false,
          xp: 0,
          learning: '',
          rewards: 0,
          totalScore: 0,
        };
      }

      const userData = users[0];

      const rewardsCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(userReward)
        .where(eq(userReward.userId, userData.id));

      const totalRewards = Number(rewardsCount[0]?.count || 0);

      const xp = userData.xp || 0;
      const rewardBonus = totalRewards * 100;
      const totalScore = xp + rewardBonus;

      this.logger.log(`✅ Score calculated for ${username}: XP=${xp}, Rewards=${totalRewards}, Total=${totalScore}`);

      return {
        found: true,
        xp,
        learning: userData.learning || 'Not specified',
        rewards: totalRewards,
        totalScore,
      };
    } catch (error) {
      this.logger.error(`❌ Error calculating score for ${username}:`, error);
      return {
        found: false,
        xp: 0,
        learning: '',
        rewards: 0,
        totalScore: 0,
      };
    }
  }
}
