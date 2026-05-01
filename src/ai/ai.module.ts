import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiStructuredGenerationService } from './ai-structured-generation.service';
import { AiTutorChatService } from './ai-tutor-chat.service';
import { ChatModule } from 'src/chat/chat.module';
import { AuthModule } from 'src/auth/auth.module';
import { RewardsModule } from 'src/rewards/rewards.module';
import { RoadmapModule } from 'src/roadmap/roadmap.module';
import { GeminiClientService } from './gemini-client.service';
import { NftRewardService } from './nft-reward.service';
import { QuizGenerationService } from './quiz-generation.service';
import { FlashcardService } from './flashcard.service';
import { SpeechTranscriptionService } from './speech-transcription.service';
import { RedisModule } from 'src/redis/redis.module';
import { QuizzesModule } from 'src/quizzes/quizzes.module';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    ChatModule,
    forwardRef(() => AuthModule),
    RewardsModule,
    forwardRef(() => RoadmapModule),
    RedisModule,
    forwardRef(() => QuizzesModule),
    forwardRef(() => UserModule),
  ],
  controllers: [AiController],
  providers: [
    GeminiClientService,
    NftRewardService,
    QuizGenerationService,
    FlashcardService,
    SpeechTranscriptionService,
    AiStructuredGenerationService,
    AiTutorChatService,
    AiService,
  ],
  exports: [
    AiService,
    NftRewardService,
    GeminiClientService,
    QuizGenerationService,
  ],
})
export class AiModule {}
