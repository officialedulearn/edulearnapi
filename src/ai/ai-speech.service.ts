import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

export type AiSpeechVoice = {
  id: string;
  label: string;
  description: string;
  elevenLabsVoiceId: string;
};

export type AiSpeechRequest = {
  text: string;
  voiceId: string;
  messageId?: string;
  chunkKey?: string;
};

const MAX_SPEECH_TEXT_LENGTH = 4_000;
const MAX_CHUNK_TEXT_LENGTH = 900;
const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';

export const AI_SPEECH_VOICES: AiSpeechVoice[] = [
  {
    id: 'warm-tutor',
    label: 'Warm Tutor',
    description: 'Friendly, clear, and calm for lessons.',
    elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  },
  {
    id: 'bright-coach',
    label: 'Bright Coach',
    description: 'Upbeat and energetic for quick explanations.',
    elevenLabsVoiceId: 'EXAVITQu4vr4xnSDxMaL',
  },
  {
    id: 'deep-guide',
    label: 'Deep Guide',
    description: 'Steady and grounded for focused study.',
    elevenLabsVoiceId: 'pNInz6obpgDQGcFmaJgB',
  },
];

const EMBED_MARKER_PATTERN =
  /\[(ROADMAP_CARD|FLASHCARD_CARD|PUBLIC_QUIZ_CARD):[a-f0-9-]+\]/gi;

@Injectable()
export class AiSpeechService {
  getVoices(): AiSpeechVoice[] {
    return AI_SPEECH_VOICES;
  }

  async generateSpeech(
    request: AiSpeechRequest,
    options?: { chunk?: boolean },
  ): Promise<Buffer> {
    const voice = this.resolveVoice(request.voiceId);
    const text = this.sanitizeText(request.text);
    const maxLength = options?.chunk
      ? MAX_CHUNK_TEXT_LENGTH
      : MAX_SPEECH_TEXT_LENGTH;

    if (!text) {
      throw new BadRequestException('Speech text is required');
    }

    if (text.length > maxLength) {
      throw new BadRequestException(
        `Speech text must be ${maxLength} characters or less`,
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Voice playback is not configured',
      );
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice.elevenLabsVoiceId}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.8,
            style: 0.25,
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Voice generation failed. Please try again.',
      );
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) {
      throw new ServiceUnavailableException(
        'Voice generation returned empty audio',
      );
    }

    return audio;
  }

  private resolveVoice(voiceId: string): AiSpeechVoice {
    const voice = AI_SPEECH_VOICES.find((item) => item.id === voiceId);
    if (!voice) {
      throw new BadRequestException('Invalid voiceId');
    }
    return voice;
  }

  private sanitizeText(text: string): string {
    if (typeof text !== 'string') {
      return '';
    }

    return text
      .replace(EMBED_MARKER_PATTERN, ' ')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[`*_>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
