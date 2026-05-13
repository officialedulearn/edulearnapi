export const ROADMAP_STEP_START_QUEUE_NAME = 'roadmap-step-start';
export const ROADMAP_STEP_START_JOB_NAME = 'roadmap-step-start.generate';

export const roadmapStepStartJobId = (userId: string, stepId: string) =>
  `roadmap-step-start:${userId}:${stepId}`;
