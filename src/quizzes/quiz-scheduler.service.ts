import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QuizGenerationService } from './quiz-generation.service';

/**
 * Handles scheduled quiz generation tasks
 * Runs monthly cron job to generate quizzes for active users
 */
@Injectable()
export class QuizSchedulerService {
  private readonly logger = new Logger(QuizSchedulerService.name);

  constructor(private readonly quizGenerationService: QuizGenerationService) {}

  /**
   * Monthly quiz generation cron job
   * Runs on the 1st of every month at 2:00 AM UTC
   * Generates quizzes for all active users who haven't received one in 30 days
   */
  @Cron('0 2 1 * *') // 2:00 AM on the 1st of every month
  async handleMonthlyQuizGeneration() {
    this.logger.log('⏰ Starting monthly quiz generation cron job...');

    try {
      const result =
        await this.quizGenerationService.runMonthlyQuizGeneration();

      this.logger.log(
        `✅ Monthly quiz generation complete: ${result.successful}/${result.total} users generated quiz successfully. ${result.failed} failed.`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Monthly quiz generation cron job failed: ${(error as Error)?.message}`,
        (error as Error)?.stack,
      );
    }
  }

  /**
   * Alternative: Weekly quiz generation (for testing/custom frequency)
   * Disabled by default - uncomment to use
   * Runs every Sunday at 3:00 AM UTC
   */
  // @Cron('0 3 0 * * 0')
  // async handleWeeklyQuizGeneration() {
  //   this.logger.log('⏰ Starting weekly quiz generation cron job...');
  //   try {
  //     const result = await this.quizGenerationService.runMonthlyQuizGeneration();
  //     this.logger.log(`✅ Weekly quiz generation complete: ${result.successful}/${result.total} successful`);
  //   } catch (error) {
  //     this.logger.error(`❌ Weekly quiz generation failed: ${(error as Error)?.message}`);
  //   }
  // }
}
