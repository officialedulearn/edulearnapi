<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Environment Variables

Create a `.env` file in the root of the `api` directory with the following variables:

### Twitter/X Integration (for posting tweets)

⚠️ **IMPORTANT**: Twitter uses TWO different authentication systems. Make sure you get the right credentials!

#### For Posting Tweets (OAuth 1.0a - Required)

```env
# OAuth 1.0a - Consumer Keys (for posting tweets)
TWITTER_API_KEY=your_consumer_api_key
TWITTER_API_SECRET=your_consumer_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret
```

#### For User Authentication (OAuth 2.0 - Optional, already configured if you have user login)

```env
TWITTER_CLIENT_ID=your_oauth2_client_id
TWITTER_CLIENT_SECRET=your_oauth2_client_secret
TWITTER_REDIRECT_URI=your_redirect_uri
```

**How to get these credentials:**

1. Go to the [Twitter Developer Portal](https://developer.twitter.com/en/portal/dashboard)
2. Create or select your app
3. **IMPORTANT:** Set app permissions to **"Read and Write"** in Settings → User authentication settings
4. In the app settings, you'll find:
   - **API Key** (Consumer Key) → `TWITTER_API_KEY`
   - **API Secret** (Consumer Secret) → `TWITTER_API_SECRET`
5. Under "Keys and tokens", generate (or regenerate if permissions changed):
   - **Access Token** → `TWITTER_ACCESS_TOKEN`
   - **Access Token Secret** → `TWITTER_ACCESS_TOKEN_SECRET`

**⚠️ Common Issues:**

- **401 Unauthorized Error**:
  - Your app must have "Read and Write" permissions
  - If you changed permissions, you MUST regenerate the Access Token and Access Token Secret
  - Make sure all 4 credentials (API Key, API Secret, Access Token, Access Token Secret) are correctly copied to your `.env` file
  - Ensure there are no extra spaces or quotes in your `.env` file

**Note:** The `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` are for OAuth 2.0 user authentication (different from posting tweets). For posting, you need OAuth 1.0a credentials: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, and `TWITTER_ACCESS_TOKEN_SECRET`.

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Marketplace Streaming API

### Overview

The Marketplace Streaming API provides real-time Server-Sent Events (SSE) streaming for AI chat responses. This endpoint is designed specifically for marketplace integrations and operates independently of the main application's credit system.

### Endpoint

```
POST /ai/marketplace-stream
```

### Authentication

**Required Header:**

```
x-marketplace-key: YOUR_MARKETPLACE_API_KEY
```

The marketplace API key should be set in your `.env` file:

```env
MARKETPLACE_API_KEY=your_secure_marketplace_key
```

### Request Format

```json
{
  "messages": [
    {
      "id": "unique-message-id",
      "chatId": "unique-chat-id",
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Your question here"
        }
      ],
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "chatId": "unique-chat-id"
}
```

### Response Format

The endpoint returns Server-Sent Events (SSE) with the following format:

```
data: {"token":"Hello"}
data: {"token":" there"}
data: {"token":"!"}
```

Each event contains a `token` field with a chunk of the AI response.

### Features

- ✅ Real-time token streaming
- ✅ Conversation history support
- ✅ No credit system (free for marketplace)
- ✅ Same educational AI tutor as main app
- ✅ Messages saved to database
- ✅ Marketplace-only authentication

### Example Usage

#### JavaScript/TypeScript

```javascript
const response = await fetch('http://your-api-url/ai/marketplace-stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-marketplace-key': 'YOUR_MARKETPLACE_KEY',
  },
  body: JSON.stringify({
    messages: [
      {
        id: 'msg-1',
        chatId: 'chat-123',
        role: 'user',
        content: [{ type: 'text', text: 'Explain Solana DeFi' }],
        createdAt: new Date().toISOString(),
      },
    ],
    chatId: 'chat-123',
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      console.log(data.token); // Process each token
    }
  }
}
```

#### Python

```python
import requests
import json

headers = {
    'Content-Type': 'application/json',
    'x-marketplace-key': 'YOUR_MARKETPLACE_KEY'
}

payload = {
    'messages': [
        {
            'id': 'msg-1',
            'chatId': 'chat-123',
            'role': 'user',
            'content': [{'type': 'text', 'text': 'Explain Solana DeFi'}],
            'createdAt': '2024-01-15T10:30:00.000Z'
        }
    ],
    'chatId': 'chat-123'
}

response = requests.post(
    'http://your-api-url/ai/marketplace-stream',
    headers=headers,
    json=payload,
    stream=True
)

for line in response.iter_lines():
    if line.startswith(b'data: '):
        data = json.loads(line[6:])
        print(data['token'], end='', flush=True)
```

### Testing

A test HTML file is included at `api/test-marketplace-stream.html` for manual testing. To use it:

1. Open the file in a browser
2. Enter your API URL (e.g., `http://localhost:3000`)
3. Enter your marketplace API key
4. Enter a message
5. Click "Start Stream" to test the connection

### Error Responses

| Status Code | Description                                           |
| ----------- | ----------------------------------------------------- |
| 200         | Success - SSE stream initiated                        |
| 400         | Bad request - Invalid message format                  |
| 401         | Unauthorized - Invalid or missing marketplace API key |
| 404         | Not found - Marketplace user not configured           |
| 500         | Internal server error                                 |

### Conversation History

The endpoint supports conversation history by including previous messages in the `messages` array:

```json
{
  "messages": [
    {
      "id": "1",
      "chatId": "chat-123",
      "role": "user",
      "content": [{ "type": "text", "text": "What is Solana?" }],
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "2",
      "chatId": "chat-123",
      "role": "assistant",
      "content": [
        { "type": "text", "text": "Solana is a high-performance blockchain..." }
      ],
      "createdAt": "2024-01-15T10:30:15.000Z"
    },
    {
      "id": "3",
      "chatId": "chat-123",
      "role": "user",
      "content": [{ "type": "text", "text": "Tell me about PDAs" }],
      "createdAt": "2024-01-15T10:31:00.000Z"
    }
  ],
  "chatId": "chat-123"
}
```

### Setup Requirements

1. **Marketplace API Key**: Set `MARKETPLACE_API_KEY` in your `.env` file
2. **Marketplace User**: Ensure a user with email `marketplace@edulearn.com` exists in your database
   - You can create this user using the script in `api/scripts/create-marketplace-user.ts`

### Notes

- This endpoint does NOT consume user credits
- This endpoint does NOT require JWT authentication
- This endpoint uses the same AI model and system prompt as the main app (without user personalization)
- All messages are saved to the database
- The AI responses are powered by Gemini 2.5 Flash

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
