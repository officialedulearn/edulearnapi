import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiSpeechService } from './ai-speech.service';

describe('AiSpeechService', () => {
  const originalEnv = process.env.ELEVENLABS_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.ELEVENLABS_API_KEY = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects invalid voice IDs', async () => {
    const service = new AiSpeechService();

    await expect(
      service.generateSpeech({ text: 'Hello', voiceId: 'missing' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty text', async () => {
    const service = new AiSpeechService();

    await expect(
      service.generateSpeech({
        text: ' [ROADMAP_CARD:abc123] ',
        voiceId: 'warm-tutor',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oversized chunk text', async () => {
    const service = new AiSpeechService();

    await expect(
      service.generateSpeech(
        { text: 'a'.repeat(901), voiceId: 'warm-tutor' },
        { chunk: true },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a clean error when ElevenLabs fails', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    const service = new AiSpeechService();

    await expect(
      service.generateSpeech({ text: 'Hello', voiceId: 'warm-tutor' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
