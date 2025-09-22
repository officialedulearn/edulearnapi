# Audio Transcription Setup

## Quick Start

1. **Get Google Cloud Speech API Key**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Enable Speech-to-Text API
   - Create a service account
   - Download the JSON key file

2. **Add to your .env file**:
```env
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json
```

3. **Place the JSON key file** in the `api/` directory as `google-credentials.json`

4. **Restart your server**:
```bash
npm run start:dev
```

## Environment Variables Needed

Add these to your `.env` file:

```env
# Existing variables...
GEMINI_API_KEY=your_gemini_api_key_here

# New audio transcription variable
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json
```

## Testing

The audio transcription endpoint is available at:
```
POST /ai/transcribe-audio
```

With form data:
- `audio`: audio file (MP3, WAV, M4A, AAC)
- `chatId`: string
- `userId`: string

## Mobile Integration

The mobile app will automatically send audio recordings to this endpoint when you stop recording. The flow is:

1. User taps microphone button
2. User speaks
3. User taps stop button
4. Audio is sent to `/ai/transcribe-audio`
5. Server transcribes audio using Google Cloud Speech API
6. Server generates AI response using transcribed text
7. Response is sent back to mobile app

## Supported Audio Formats

- MP3
- WAV
- M4A
- AAC

## File Size Limit

Maximum file size: 10MB

## Security

- Audio files are automatically deleted after processing
- Service account key should never be committed to version control
- Use environment variables for production deployment

