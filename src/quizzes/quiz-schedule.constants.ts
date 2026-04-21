export const QUIZ_SCHEDULE_QUEUE_NAME = 'quiz-generation-scheduled';
export const QUIZ_SCHEDULE_JOB_NAME = 'scheduled-quiz-run';

export function quizScheduleSchedulerId(userId: string): string {
  return `quiz-schedule:${userId}`;
}
