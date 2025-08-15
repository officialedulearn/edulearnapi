import { Injectable, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { AuthService } from 'src/auth/auth.service';

@Injectable()
export class TwitterService {
    constructor(private authService: AuthService) {}
    private clientId = process.env.TWITTER_CLIENT_ID;
    private clientSecret = process.env.TWITTER_CLIENT_SECRET;
    private redirectUri = process.env.TWITTER_REDIRECT_URI;

  async getAccessToken(code: string, providedRedirectUri?: string) {
    try {
      const finalRedirectUri = providedRedirectUri || this.redirectUri || '';
      
      console.log('Using redirect URI:', finalRedirectUri);
      
      const params = new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: this.clientId || '',
        redirect_uri: finalRedirectUri,
        code_verifier: "challenge",
      });
      
      const res = await axios.post(
        "https://api.twitter.com/2/oauth2/token",
        params,
        { 
          headers: { 
            "Content-Type": "application/x-www-form-urlencoded",
            ...(this.clientSecret ? {
              "Authorization": `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
            } : {})
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
        await this.authService.editUser({name: res.data.data.name, email: userCaller, username: res.data.data.username});
        await this.authService.verifyUser(userCaller);
      }
      
      await this.authService.verifyUser(userCaller);
      return res.data.data; 
    } catch (error) {
      console.error('Error getting Twitter user profile:', error.response?.data || error.message);
      throw new BadRequestException('Failed to fetch Twitter profile');
    }
  }
}
