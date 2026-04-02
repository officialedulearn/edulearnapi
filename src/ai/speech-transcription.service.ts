import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { SpeechClient } from '@google-cloud/speech';
import { readFileSync, unlinkSync } from 'fs';
import type { File } from 'multer';
import { GeminiClientService } from './gemini-client.service';

@Injectable()
export class SpeechTranscriptionService {
  private readonly speechClient: SpeechClient;

  constructor(private readonly geminiClient: GeminiClientService) {
    this.speechClient = new SpeechClient({
      credentials: {
        type: process.env.GOOGLE_APPLICATION_CREDENTIALS_TYPE,
        project_id: process.env.GOOGLE_APPLICATION_CREDENTIALS_PROJECT_ID,
        private_key_id:
          process.env.GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY_ID,
        private_key:
          process.env.GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY?.replace(
            /\\n/g,
            '\n',
          ),
        client_email: process.env.GOOGLE_APPLICATION_CREDENTIALS_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_APPLICATION_CREDENTIALS_CLIENT_ID,
      },
    });
  }

  private get genAI(): GoogleGenAI {
    return this.geminiClient.genAI;
  }

  async transcribeAudio(file: { path: string }) {
    const audioBytes = readFileSync(file.path).toString('base64');

    const audio = {
      content: audioBytes,
    };

    const config = {
      encoding: 'MP3' as const,
      sampleRateHertz: 16000,
      languageCode: 'en-US',
    };

    const request = {
      audio,
      config,
    };

    const response = await this.speechClient.recognize(request);

    const transcription = response[0]?.results
      ?.map((result) => result.alternatives?.[0].transcript)
      .join('\n');

    return { transcription };
  }

  private async cleanupTranscription(
    rawTranscription: string,
  ): Promise<string> {
    try {
      const result = await Promise.race([
        this.genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Please clean up and improve the accuracy of this transcribed text. Fix any grammar errors, add proper punctuation, correct any misheard words, and make it more readable. Return only the cleaned text without any additional explanation or commentary.\n\nTranscribed text:\n${rawTranscription}`,
                },
              ],
            },
          ],
          config: {
            maxOutputTokens: 2000,
            temperature: 0.3,
            systemInstruction:
              'You are a text cleanup assistant. Your job is to improve transcribed audio text by fixing grammar, punctuation, and correcting misheard words. Return only the cleaned text, nothing else.',
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cleanup timeout')), 30000),
        ),
      ]);

      const cleanedText = (result as { text?: string }).text?.trim();
      return cleanedText || rawTranscription;
    } catch (error) {
      console.warn('Failed to cleanup transcription with Gemini:', error);
      return rawTranscription;
    }
  }

  async transcribeAudioOnly({
    file,
  }: {
    file: File;
  }): Promise<{ transcription: string }> {
    try {
      if (!file || !file.path) {
        throw new Error('Invalid file parameter - missing file or path');
      }

      const { transcription } = await this.transcribeAudio({ path: file.path });

      if (!transcription || transcription.trim().length === 0) {
        throw new Error('No speech detected in the audio file');
      }

      const cleanedTranscription = await this.cleanupTranscription(
        transcription.trim(),
      );

      try {
        unlinkSync(file.path);
      } catch (cleanupError) {
        console.warn('Failed to clean up uploaded file:', cleanupError);
      }

      return { transcription: cleanedTranscription };
    } catch (error) {
      if (file && file.path) {
        try {
          unlinkSync(file.path);
        } catch (cleanupError) {
          console.warn(
            'Failed to clean up uploaded file after error:',
            cleanupError,
          );
        }
      }

      console.error('Error in transcribeAudioOnly:', error);
      throw new Error(
        "I'm sorry, I couldn't process your audio message. Please try speaking more clearly or check your microphone settings.",
      );
    }
  }
}
