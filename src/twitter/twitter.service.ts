import { Injectable, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import axios from 'axios';
import { AuthService } from 'src/auth/auth.service';
import * as crypto from 'crypto';
import { TwitterApi } from 'twitter-api-v2';

@Injectable()
export class TwitterService {
    constructor(
        @Inject(forwardRef(() => AuthService))
        private authService: AuthService
    ) {}
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
    }
  ) {
    try {
      if (!this.apiKey || !this.apiSecret || !this.accessToken || !this.accessTokenSecret) {
        throw new BadRequestException(
          'Twitter OAuth 1.0a credentials missing. Required in .env:\n' +
          'TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET'
        );
      }

      console.log('📤 Posting tweet using twitter-api-v2 library...');
      console.log('  - Tweet text length:', text.length);

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

      console.log('✅ Tweet posted successfully!')

      return tweet.data;
    } catch (error) {
      console.error('❌ Error posting tweet:', error);

      if (error.code === 401 || error.code === 403) {
        throw new BadRequestException(
          'Failed to post tweet'
        );
      }
      
      throw new BadRequestException(
        error.data?.detail || 
        error.data?.title ||
        error.message || 
        'Failed to post tweet'
      );
    }
  }
}
