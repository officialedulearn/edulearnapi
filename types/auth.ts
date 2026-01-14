export type signUpDetails = {
  id: string;
  name: string;
  email: string;
  referralCode?: string;
  referredBy?: string;
  username: string;
  oauthProvider?: 'google' | 'apple' | null;
  oauthProviderId?: string | null;
  hasCompletedProfile?: boolean;
};

export type OAuthUserData = {
  id: string;
  email: string;
  name: string;
  provider: 'google' | 'apple';
  providerId: string;
};

export type OAuthCallbackResult = {
  user: any;
  isNewUser: boolean;
  needsUsername: boolean;
};
