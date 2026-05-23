import { AdminService, GrowthLead, GrowthRetention, GrowthSegment } from './admin.service';

type PrivateGrowthService = {
  buildGrowthLeads(data: unknown, now?: Date): GrowthLead[];
  buildGrowthSegments(leads: GrowthLead[]): GrowthSegment[];
  buildGrowthRetention(
    data: unknown,
    leads: GrowthLead[],
    now?: Date,
  ): GrowthRetention;
};

const createService = () =>
  new AdminService(
    {} as ConstructorParameters<typeof AdminService>[0],
    {} as ConstructorParameters<typeof AdminService>[1],
    {} as ConstructorParameters<typeof AdminService>[2],
    {} as ConstructorParameters<typeof AdminService>[3],
    {} as ConstructorParameters<typeof AdminService>[4],
  ) as unknown as PrivateGrowthService;

const createGrowthDataSet = () => ({
  users: [
    {
      id: 'user-active',
      name: 'Active Learner',
      email: 'active@example.com',
      username: 'active',
      level: 'advanced',
      xp: 1200,
      streak: 12,
      quizCompleted: 8,
      isPremium: false,
      referralCount: 2,
      lastLoggedIn: new Date('2026-05-22T00:00:00.000Z'),
    },
    {
      id: 'user-risk',
      name: 'Risk Learner',
      email: 'risk@example.com',
      username: 'risk',
      level: 'novice',
      xp: 20,
      streak: 0,
      quizCompleted: 0,
      isPremium: false,
      referralCount: 0,
      lastLoggedIn: new Date('2026-04-01T00:00:00.000Z'),
    },
  ],
  activities: [
    {
      id: 'activity-1',
      userId: 'user-active',
      type: 'quiz',
      title: 'Solana quiz',
      xpEarned: 50,
      createdAt: new Date('2026-05-22T01:00:00.000Z'),
    },
  ],
  chats: [
    {
      id: 'chat-1',
      userId: 'user-active',
      title: 'Learning Solana wallet basics',
      createdAt: new Date('2026-05-22T01:00:00.000Z'),
    },
  ],
  roadmaps: [
    {
      id: 'roadmap-1',
      userId: 'user-active',
      chatId: 'chat-1',
      topic: 'solana',
      title: 'Solana roadmap',
      description: 'Learn Solana',
      createdAt: new Date('2026-05-22T01:00:00.000Z'),
    },
  ],
  quizParticipations: [],
  quizAnswers: [
    {
      id: 'answer-1',
      userId: 'user-active',
      quizId: 'quiz-1',
      participationId: 'participation-1',
      questionIndex: 0,
      question: 'What is Solana finality?',
      selectedAnswer: 'A',
      correctAnswer: 'B',
      explanation: 'Finality explanation',
      isCorrect: false,
      createdAt: new Date('2026-05-22T01:00:00.000Z'),
    },
    {
      id: 'answer-2',
      userId: 'user-active',
      quizId: 'quiz-1',
      participationId: 'participation-1',
      questionIndex: 1,
      question: 'What is Solana finality?',
      selectedAnswer: 'B',
      correctAnswer: 'B',
      explanation: 'Finality explanation',
      isCorrect: true,
      createdAt: new Date('2026-05-22T01:00:00.000Z'),
    },
    {
      id: 'answer-3',
      userId: 'user-active',
      quizId: 'quiz-1',
      participationId: 'participation-1',
      questionIndex: 2,
      question: 'What is Solana finality?',
      selectedAnswer: 'A',
      correctAnswer: 'B',
      explanation: 'Finality explanation',
      isCorrect: false,
      createdAt: new Date('2026-05-22T01:00:00.000Z'),
    },
  ],
  publicQuizzes: [
    {
      id: 'quiz-1',
      title: 'Solana finality',
      description: 'Quiz',
      questions: [],
      createdBy: 'user-active',
      sourceChatId: 'chat-1',
      createdAt: new Date('2026-05-22T01:00:00.000Z'),
      viewCount: 0,
      attemptCount: 0,
      creatorId: 'user-active',
    },
  ],
  communityMembers: [{ id: 'member-1', userId: 'user-active', communityId: 'community-1', role: 'member' }],
  notificationRows: [],
  transactions: [],
  subscriptions: [],
  feedbackRows: [],
  reminderLogs: [{ id: 'reminder-1', userId: 'user-risk', decision: 'skipped' }],
  wakeupLogs: [{ id: 'wakeup-1', userId: 'user-risk', decision: 'skipped' }],
});

describe('AdminService growth intelligence', () => {
  it('scores active leads above inactive churn-risk users', () => {
    const service = createService();
    const leads = service.buildGrowthLeads(
      createGrowthDataSet(),
      new Date('2026-05-23T00:00:00.000Z'),
    );

    const active = leads.find((lead) => lead.id === 'user-active');
    const risk = leads.find((lead) => lead.id === 'user-risk');

    expect(active?.leadScore).toBeGreaterThan(risk?.leadScore || 0);
    expect(risk?.churnRisk).toBeGreaterThan(active?.churnRisk || 0);
    expect(active?.recommendedAction).toBe('Send premium offer');
  });

  it('classifies premium, churn, and referral segments', () => {
    const service = createService();
    const leads = service.buildGrowthLeads(
      createGrowthDataSet(),
      new Date('2026-05-23T00:00:00.000Z'),
    );
    const segments = service.buildGrowthSegments(leads);

    expect(segments.find((segment) => segment.id === 'premium-candidates')?.count).toBe(1);
    expect(segments.find((segment) => segment.id === 'churned')?.count).toBe(1);
    expect(segments.find((segment) => segment.id === 'referral')?.count).toBeGreaterThan(0);
  });

  it('returns empty retention data without crashing', () => {
    const service = createService();
    const data = { ...createGrowthDataSet(), users: [], activities: [] };
    const retention = service.buildGrowthRetention(
      data,
      [],
      new Date('2026-05-23T00:00:00.000Z'),
    );

    expect(retention.summary.d7Rate).toBe(0);
    expect(retention.riskBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(0);
  });
});
