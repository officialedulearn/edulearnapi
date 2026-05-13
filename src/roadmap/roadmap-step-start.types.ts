export type RoadmapStepStartMode = 'sync' | 'background';

export type RoadmapStepStartJobData = {
  userId: string;
  stepId: string;
  roadmapId: string;
  chatId: string;
};

export type StartRoadmapStepBackgroundResponse = {
  status: 'queued' | 'already_started';
  chatId: string;
  roadmapId: string;
  step: unknown;
  message: string;
};
