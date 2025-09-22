# Audio Transcription Setup Guide

## Overview
This guide will help you set up audio transcription functionality for the EduLearn API using Google Cloud Speech-to-Text API.

## Prerequisites
- Google Cloud Platform account
- Google Cloud project with billing enabled
- Google Cloud Speech-to-Text API enabled

## Step 1: Enable Google Cloud Speech-to-Text API

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project or create a new one
3. Navigate to "APIs & Services" > "Library"
4. Search for "Cloud Speech-to-Text API"
5. Click on it and press "Enable"

## Step 2: Create Service Account

1. In the Google Cloud Console, go to "IAM & Admin" > "Service Accounts"
2. Click "Create Service Account"
3. Fill in the details:
   - Name: `edulearn-speech-service`
   - Description: `Service account for EduLearn audio transcription`
4. Click "Create and Continue"
5. Grant the following roles:
   - `Cloud Speech-to-Text API User`
   - `Storage Object Viewer` (if using Cloud Storage)
6. Click "Done"

## Step 3: Generate Service Account Key

1. Find your newly created service account in the list
2. Click on the service account email
3. Go to the "Keys" tab
4. Click "Add Key" > "Create new key"
5. Choose "JSON" format
6. Click "Create"
7. The JSON key file will be downloaded automatically

## Step 4: Set Up Environment Variables

### Option A: Using the JSON key file (Recommended for development)

1. Place the downloaded JSON key file in your project root (e.g., `api/google-credentials.json`)
2. Add to your `.env` file:
```env
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json
```

### Option B: Using environment variables (Recommended for production)

1. Open the downloaded JSON key file
2. Extract the following values:
   - `type`
   - `project_id`
   - `private_key_id`
   - `private_key`
   - `client_email`
   - `client_id`
   - `auth_uri`
   - `token_uri`
   - `auth_provider_x509_cert_url`
   - `client_x509_cert_url`

3. Add to your `.env` file:
```env
GOOGLE_APPLICATION_CREDENTIALS_TYPE=service_account
GOOGLE_APPLICATION_CREDENTIALS_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY_ID=your-private-key-id
GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
GOOGLE_APPLICATION_CREDENTIALS_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_APPLICATION_CREDENTIALS_CLIENT_ID=your-client-id
GOOGLE_APPLICATION_CREDENTIALS_AUTH_URI=https://accounts.google.com/o/oauth2/auth
GOOGLE_APPLICATION_CREDENTIALS_TOKEN_URI=https://oauth2.googleapis.com/token
GOOGLE_APPLICATION_CREDENTIALS_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
GOOGLE_APPLICATION_CREDENTIALS_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/your-service-account%40your-project.iam.gserviceaccount.com
```

## Step 5: Update the AI Service (if using environment variables)

If you chose Option B, you'll need to update the AI service to use environment variables instead of the JSON file. Here's how:

1. Open `api/src/ai/ai.service.ts`
2. Update the constructor to use environment variables:

```typescript
constructor(
  private chatService: ChatService,
  private authService: AuthService,
  private rewardsService: RewardsService,
) {
  const aiApiKey = process.env.GEMINI_API_KEY;
  if (!aiApiKey) {
    throw new Error('AI API Key is not configured');
  }
  this.genAI = new GoogleGenAI({
    apiKey: aiApiKey,
  });
  
  // Initialize Speech Client with environment variables
  this.speechClient = new SpeechClient({
    credentials: {
      type: process.env.GOOGLE_APPLICATION_CREDENTIALS_TYPE,
      project_id: process.env.GOOGLE_APPLICATION_CREDENTIALS_PROJECT_ID,
      private_key_id: process.env.GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_APPLICATION_CREDENTIALS_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_APPLICATION_CREDENTIALS_CLIENT_ID,
      auth_uri: process.env.GOOGLE_APPLICATION_CREDENTIALS_AUTH_URI,
      token_uri: process.env.GOOGLE_APPLICATION_CREDENTIALS_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.GOOGLE_APPLICATION_CREDENTIALS_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.GOOGLE_APPLICATION_CREDENTIALS_CLIENT_X509_CERT_URL,
    },
  });
}
```

## Step 6: Test the Setup

1. Start your API server:
```bash
cd api
npm run start:dev
```

2. Test the audio transcription endpoint:
```bash
curl -X POST http://localhost:3001/ai/transcribe-audio \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "audio=@path/to/your/audio/file.mp3" \
  -F "chatId=test-chat-id" \
  -F "userId=test-user-id"
```

## Step 7: Deploy to Production

### For production deployment:

1. **Never commit your service account key file to version control**
2. Add `google-credentials.json` to your `.gitignore`
3. Use environment variables (Option B) for production
4. Set up the environment variables in your production environment (Vercel, Railway, etc.)

## Troubleshooting

### Common Issues:

1. **"Permission denied" error**: Make sure your service account has the correct roles
2. **"API not enabled" error**: Ensure the Speech-to-Text API is enabled in your project
3. **"Invalid credentials" error**: Check that your environment variables are set correctly
4. **"Quota exceeded" error**: Check your Google Cloud billing and quotas

### Testing Audio Formats:

The API supports the following audio formats:
- MP3
- WAV
- M4A
- AAC

Make sure your mobile app is recording in one of these supported formats.

## Security Notes

1. **Never expose your service account key in client-side code**
2. **Use environment variables for production**
3. **Regularly rotate your service account keys**
4. **Monitor API usage and set up billing alerts**

## Cost Considerations

Google Cloud Speech-to-Text API pricing (as of 2024):
- First 60 minutes per month: Free
- Additional usage: $0.006 per 15 seconds

Monitor your usage in the Google Cloud Console to avoid unexpected charges.

## Support

If you encounter issues:
1. Check the Google Cloud Console for API errors
2. Verify your service account permissions
3. Ensure your audio files are in supported formats
4. Check your network connectivity and firewall settings
