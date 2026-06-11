import { Type as GeminiType } from '@google/genai';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, max } from 'drizzle-orm';
import db from '../../drizzle';
import {
  surveyAiAnalyses,
  surveyAnswers,
  surveyQuestions,
  surveyResponses,
  surveys,
  type Survey,
  type SurveyAiAnalysisPayload,
  type SurveyQuestion,
  type SurveyQuestionType,
} from '../../lib/db/schema';
import { GeminiClientService } from '../ai/gemini-client.service';
import type {
  CreateSurveyDto,
  SubmitSurveyResponseDto,
  SurveyQuestionInputDto,
  UpdateSurveyDto,
} from './dto/survey.dto';

type SurveyAnswerValue = string | number | boolean | string[] | null;

type NormalizedAnswer = {
  question: SurveyQuestion;
  value: SurveyAnswerValue;
  textValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
};

const AI_MODEL = 'gemini-2.5-flash';
const AI_PROMPT_VERSION = 'survey-analysis-v1';

@Injectable()
export class SurveysService {
  constructor(private readonly geminiClient: GeminiClientService) {}

  async getActiveSurvey() {
    const rows = await db
      .select()
      .from(surveys)
      .where(and(eq(surveys.isActive, true), eq(surveys.status, 'published')))
      .orderBy(desc(surveys.publishedAt))
      .limit(1);

    if (!rows.length) {
      throw new NotFoundException('No active survey is published');
    }

    return this.getPublicSurveyById(rows[0].id);
  }

  async getPublicSurveyBySlug(slug: string) {
    const survey = await this.findSurveyBySlug(slug);
    if (survey.status !== 'published') {
      throw new NotFoundException('Survey is not published');
    }
    return this.getPublicSurveyById(survey.id);
  }

  async listAdminSurveys() {
    const surveyRows = await db
      .select()
      .from(surveys)
      .orderBy(desc(surveys.createdAt));
    const statsRows = await db
      .select({
        surveyId: surveyResponses.surveyId,
        responseCount: count(),
        latestResponseAt: max(surveyResponses.submittedAt),
      })
      .from(surveyResponses)
      .groupBy(surveyResponses.surveyId);
    const analysisRows = await db.select().from(surveyAiAnalyses);

    const statsBySurveyId = new Map(
      statsRows.map((row) => [row.surveyId, row]),
    );
    const analysisBySurveyId = new Map(
      analysisRows.map((row) => [row.surveyId, row]),
    );

    return surveyRows.map((survey) => {
      const stats = statsBySurveyId.get(survey.id);
      const analysis = analysisBySurveyId.get(survey.id);
      const latestResponseAt = stats?.latestResponseAt ?? null;
      return {
        ...survey,
        responseCount: Number(stats?.responseCount ?? 0),
        latestResponseAt,
        analysisGeneratedAt: analysis?.generatedAt ?? null,
        analysisStale: this.isAnalysisStale(
          analysis?.latestResponseAtAnalyzed ?? null,
          latestResponseAt,
          Number(stats?.responseCount ?? 0),
          analysis?.responseCountAnalyzed ?? 0,
        ),
      };
    });
  }

  async getAdminSurvey(id: string) {
    const survey = await this.findSurveyById(id);
    const questions = await this.getSurveyQuestions(id);
    return { ...survey, questions };
  }

  async createSurvey(dto: CreateSurveyDto) {
    const slug = this.normalizeSlug(dto.slug || dto.title);
    const questions = this.prepareQuestionInputs(dto.questions);

    try {
      const createdId = await db.transaction(async (tx) => {
        if (dto.isActive) {
          await tx
            .update(surveys)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(surveys.isActive, true));
        }

        const created = await tx
          .insert(surveys)
          .values({
            title: dto.title.trim(),
            description: dto.description?.trim() || null,
            slug,
            isActive: dto.isActive ?? false,
          })
          .returning();

        await tx.insert(surveyQuestions).values(
          questions.map((question, index) => ({
            surveyId: created[0].id,
            prompt: question.prompt,
            type: question.type,
            options: question.options,
            required: question.required,
            sortOrder: question.sortOrder ?? index,
          })),
        );

        return created[0].id;
      });

      return await this.getAdminSurvey(createdId);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Survey slug is already in use');
      }
      throw error;
    }
  }

  async updateSurvey(id: string, dto: UpdateSurveyDto) {
    const existing = await this.findSurveyById(id);
    const slug = dto.slug ? this.normalizeSlug(dto.slug) : undefined;
    const questions = dto.questions
      ? this.prepareQuestionInputs(dto.questions)
      : undefined;

    if (questions && existing.status !== 'draft') {
      throw new BadRequestException(
        'Question changes are only allowed while a survey is in draft',
      );
    }

    try {
      await db.transaction(async (tx) => {
        if (dto.isActive) {
          await tx
            .update(surveys)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(surveys.isActive, true));
        }

        await tx
          .update(surveys)
          .set({
            title: dto.title?.trim() ?? existing.title,
            description:
              dto.description === undefined
                ? existing.description
                : dto.description?.trim() || null,
            slug: slug ?? existing.slug,
            isActive: dto.isActive ?? existing.isActive,
            updatedAt: new Date(),
          })
          .where(eq(surveys.id, id));

        if (questions) {
          await tx
            .delete(surveyQuestions)
            .where(eq(surveyQuestions.surveyId, id));
          await tx.insert(surveyQuestions).values(
            questions.map((question, index) => ({
              surveyId: id,
              prompt: question.prompt,
              type: question.type,
              options: question.options,
              required: question.required,
              sortOrder: question.sortOrder ?? index,
            })),
          );
        }
      });

      return await this.getAdminSurvey(id);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Survey slug is already in use');
      }
      throw error;
    }
  }

  async publishSurvey(id: string) {
    const survey = await this.findSurveyById(id);
    const questions = await this.getSurveyQuestions(id);
    if (!questions.length) {
      throw new BadRequestException('A survey needs at least one question');
    }

    return await db.transaction(async (tx) => {
      await tx
        .update(surveys)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(surveys.isActive, true));

      const updated = await tx
        .update(surveys)
        .set({
          status: 'published',
          isActive: true,
          publishedAt: survey.publishedAt ?? new Date(),
          archivedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(surveys.id, id))
        .returning();

      return updated[0];
    });
  }

  async archiveSurvey(id: string) {
    const updated = await db
      .update(surveys)
      .set({
        status: 'archived',
        isActive: false,
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(surveys.id, id))
      .returning();

    if (!updated.length) {
      throw new NotFoundException(`Survey with id ${id} not found`);
    }

    return updated[0];
  }

  async submitResponse(
    surveyId: string,
    dto: SubmitSurveyResponseDto,
    userId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    const survey = await this.findSurveyById(surveyId);
    if (survey.status !== 'published') {
      throw new BadRequestException('Survey is not accepting responses');
    }

    const questions = await this.getSurveyQuestions(surveyId);
    const normalized = this.normalizeAnswers(questions, dto.answers);

    return await db.transaction(async (tx) => {
      const response = await tx
        .insert(surveyResponses)
        .values({
          surveyId,
          userId,
          metadata,
        })
        .returning();

      await tx.insert(surveyAnswers).values(
        normalized.map((answer) => ({
          responseId: response[0].id,
          surveyId,
          questionId: answer.question.id,
          questionPrompt: answer.question.prompt,
          questionType: answer.question.type,
          value: answer.value,
          textValue: answer.textValue,
          numberValue: answer.numberValue,
          booleanValue: answer.booleanValue,
        })),
      );

      return response[0];
    });
  }

  async getSurveyResponses(surveyId: string) {
    await this.findSurveyById(surveyId);

    const responses = await db
      .select()
      .from(surveyResponses)
      .where(eq(surveyResponses.surveyId, surveyId))
      .orderBy(desc(surveyResponses.submittedAt));
    const answers = await db
      .select()
      .from(surveyAnswers)
      .where(eq(surveyAnswers.surveyId, surveyId))
      .orderBy(asc(surveyAnswers.createdAt));

    return {
      responses: responses.map((response) => ({
        ...response,
        answers: answers.filter((answer) => answer.responseId === response.id),
      })),
      answerRows: answers,
      summary: this.buildAnswerSummary(answers),
    };
  }

  async getOrGenerateAnalysis(surveyId: string, force = false) {
    const survey = await this.findSurveyById(surveyId);
    const stats = await this.getResponseStats(surveyId);
    const existing = await db
      .select()
      .from(surveyAiAnalyses)
      .where(eq(surveyAiAnalyses.surveyId, surveyId))
      .limit(1);

    const stale = this.isAnalysisStale(
      existing[0]?.latestResponseAtAnalyzed ?? null,
      stats.latestResponseAt,
      stats.responseCount,
      existing[0]?.responseCountAnalyzed ?? 0,
    );

    if (existing.length && !force) {
      return { ...existing[0], stale, fromCache: true };
    }

    if (stats.responseCount === 0) {
      throw new BadRequestException('Cannot analyze a survey with no responses');
    }

    const questions = await this.getSurveyQuestions(surveyId);
    const responses = await this.getSurveyResponses(surveyId);
    const analysis = await this.generateAiAnalysis(
      survey,
      questions,
      responses.answerRows,
    );

    const saved = await db
      .insert(surveyAiAnalyses)
      .values({
        surveyId,
        model: AI_MODEL,
        promptVersion: AI_PROMPT_VERSION,
        responseCountAnalyzed: stats.responseCount,
        latestResponseAtAnalyzed: stats.latestResponseAt,
        analysis,
      })
      .onConflictDoUpdate({
        target: surveyAiAnalyses.surveyId,
        set: {
          model: AI_MODEL,
          promptVersion: AI_PROMPT_VERSION,
          responseCountAnalyzed: stats.responseCount,
          latestResponseAtAnalyzed: stats.latestResponseAt,
          analysis,
          generatedAt: new Date(),
        },
      })
      .returning();

    return { ...saved[0], stale: false, fromCache: false };
  }

  private async getPublicSurveyById(id: string) {
    const survey = await this.findSurveyById(id);
    const questions = await this.getSurveyQuestions(id);
    return {
      id: survey.id,
      slug: survey.slug,
      title: survey.title,
      description: survey.description,
      questions: questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        type: question.type,
        options: question.options,
        required: question.required,
        sortOrder: question.sortOrder,
      })),
    };
  }

  private async findSurveyById(id: string): Promise<Survey> {
    const rows = await db.select().from(surveys).where(eq(surveys.id, id));
    if (!rows.length) {
      throw new NotFoundException(`Survey with id ${id} not found`);
    }
    return rows[0];
  }

  private async findSurveyBySlug(rawSlug: string): Promise<Survey> {
    const slug = this.normalizeSlug(rawSlug);
    const rows = await db
      .select()
      .from(surveys)
      .where(eq(surveys.slug, slug));
    if (!rows.length) {
      throw new NotFoundException(`Survey with slug ${slug} not found`);
    }
    return rows[0];
  }

  private async getSurveyQuestions(surveyId: string): Promise<SurveyQuestion[]> {
    return await db
      .select()
      .from(surveyQuestions)
      .where(eq(surveyQuestions.surveyId, surveyId))
      .orderBy(asc(surveyQuestions.sortOrder));
  }

  private async getResponseStats(surveyId: string) {
    const rows = await db
      .select({
        responseCount: count(),
        latestResponseAt: max(surveyResponses.submittedAt),
      })
      .from(surveyResponses)
      .where(eq(surveyResponses.surveyId, surveyId));

    return {
      responseCount: Number(rows[0]?.responseCount ?? 0),
      latestResponseAt: rows[0]?.latestResponseAt ?? null,
    };
  }

  private prepareQuestionInputs(questions: SurveyQuestionInputDto[]) {
    return questions.map((question, index) => {
      const prompt = question.prompt.trim();
      if (!prompt) {
        throw new BadRequestException('Question prompt is required');
      }
      const options = (question.options ?? [])
        .map((option) => option.trim())
        .filter(Boolean);
      if (
        (question.type === 'single_choice' ||
          question.type === 'multiple_choice') &&
        options.length < 2
      ) {
        throw new BadRequestException(
          'Choice questions require at least two options',
        );
      }
      return {
        prompt,
        type: question.type,
        options,
        required: question.required ?? false,
        sortOrder: question.sortOrder ?? index,
      };
    });
  }

  private normalizeAnswers(
    questions: SurveyQuestion[],
    answers: SubmitSurveyResponseDto['answers'],
  ): NormalizedAnswer[] {
    const answersByQuestionId = new Map(
      answers.map((answer) => [answer.questionId, answer.value]),
    );

    return questions.map((question) => {
      const rawValue = answersByQuestionId.get(question.id);
      const value = this.normalizeAnswerValue(question, rawValue);

      if (question.required && this.isEmptyAnswer(value)) {
        throw new BadRequestException(`Question "${question.prompt}" is required`);
      }

      return {
        question,
        value,
        textValue: this.getTextValue(question.type, value),
        numberValue: typeof value === 'number' ? value : null,
        booleanValue: typeof value === 'boolean' ? value : null,
      };
    });
  }

  private normalizeAnswerValue(
    question: SurveyQuestion,
    value: unknown,
  ): SurveyAnswerValue {
    if (value === undefined || value === null || value === '') return null;

    switch (question.type) {
      case 'short_text':
      case 'long_text': {
        if (typeof value !== 'string') {
          throw new BadRequestException('Text answer must be a string');
        }
        const trimmed = value.trim();
        const maxLength = question.type === 'short_text' ? 500 : 5000;
        if (trimmed.length > maxLength) {
          throw new BadRequestException('Text answer is too long');
        }
        return trimmed || null;
      }
      case 'rating': {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          throw new BadRequestException('Rating answer must be a whole number');
        }
        if (value < 1 || value > 5) {
          throw new BadRequestException('Rating answer must be between 1 and 5');
        }
        return value;
      }
      case 'single_choice': {
        if (typeof value !== 'string') {
          throw new BadRequestException('Choice answer must be a string');
        }
        return this.requireOption(question, value);
      }
      case 'multiple_choice': {
        if (!Array.isArray(value)) {
          throw new BadRequestException('Multiple choice answer must be an array');
        }
        const selected = value.map((item) => {
          if (typeof item !== 'string') {
            throw new BadRequestException(
              'Multiple choice answers must be strings',
            );
          }
          return this.requireOption(question, item);
        });
        return selected.length ? selected : null;
      }
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new BadRequestException('Boolean answer must be true or false');
        }
        return value;
      default:
        throw new BadRequestException('Unsupported question type');
    }
  }

  private requireOption(question: SurveyQuestion, value: string): string {
    const option = value.trim();
    if (!question.options.includes(option)) {
      throw new BadRequestException(
        `"${option}" is not a valid option for "${question.prompt}"`,
      );
    }
    return option;
  }

  private getTextValue(
    type: SurveyQuestionType,
    value: SurveyAnswerValue,
  ): string | null {
    if (value === null) return null;
    if (Array.isArray(value)) return value.join(', ');
    if (type === 'short_text' || type === 'long_text' || type === 'single_choice') {
      return String(value);
    }
    return null;
  }

  private isEmptyAnswer(value: SurveyAnswerValue): boolean {
    return (
      value === null ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'string' && value.trim().length === 0)
    );
  }

  private buildAnswerSummary(answers: (typeof surveyAnswers.$inferSelect)[]) {
    const byQuestion = new Map<
      string,
      {
        questionId: string;
        questionPrompt: string;
        questionType: string;
        totalAnswers: number;
        emptyAnswers: number;
        options: Record<string, number>;
        averageRating: number | null;
      }
    >();

    for (const answer of answers) {
      const entry = byQuestion.get(answer.questionId) ?? {
        questionId: answer.questionId,
        questionPrompt: answer.questionPrompt,
        questionType: answer.questionType,
        totalAnswers: 0,
        emptyAnswers: 0,
        options: {},
        averageRating: null,
      };
      entry.totalAnswers += 1;
      if (answer.value === null || answer.value === undefined) {
        entry.emptyAnswers += 1;
      }
      if (typeof answer.value === 'string') {
        entry.options[answer.value] = (entry.options[answer.value] ?? 0) + 1;
      }
      if (Array.isArray(answer.value)) {
        answer.value.forEach((option) => {
          entry.options[option] = (entry.options[option] ?? 0) + 1;
        });
      }
      byQuestion.set(answer.questionId, entry);
    }

    for (const entry of byQuestion.values()) {
      const ratingAnswers = answers.filter(
        (answer) =>
          answer.questionId === entry.questionId &&
          typeof answer.numberValue === 'number',
      );
      if (ratingAnswers.length) {
        entry.averageRating =
          ratingAnswers.reduce(
            (sum, answer) => sum + (answer.numberValue ?? 0),
            0,
          ) / ratingAnswers.length;
      }
    }

    return Array.from(byQuestion.values());
  }

  private async generateAiAnalysis(
    survey: Survey,
    questions: SurveyQuestion[],
    answers: (typeof surveyAnswers.$inferSelect)[],
  ): Promise<SurveyAiAnalysisPayload> {
    const compactAnswers = answers.map((answer) => ({
      responseId: answer.responseId,
      questionId: answer.questionId,
      question: answer.questionPrompt,
      type: answer.questionType,
      value: answer.value,
    }));

    const result = await this.geminiClient.genAI.models.generateContent({
      model: AI_MODEL,
      contents: JSON.stringify({
        survey: {
          title: survey.title,
          description: survey.description,
        },
        questions: questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          type: question.type,
          options: question.options,
        })),
        answers: compactAnswers,
      }),
      config: {
        temperature: 0.2,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
        systemInstruction:
          'Analyze EduLearn survey responses for product decisions. Return concise valid JSON only. Do not invent data beyond the responses.',
        responseSchema: {
          type: GeminiType.OBJECT,
          properties: {
            summary: { type: GeminiType.STRING },
            keyThemes: {
              type: GeminiType.ARRAY,
              items: { type: GeminiType.STRING },
            },
            sentiment: {
              type: GeminiType.STRING,
              enum: ['positive', 'mixed', 'negative', 'neutral'],
            },
            recommendations: {
              type: GeminiType.ARRAY,
              items: { type: GeminiType.STRING },
            },
            notableQuotes: {
              type: GeminiType.ARRAY,
              items: { type: GeminiType.STRING },
            },
            questionInsights: {
              type: GeminiType.ARRAY,
              items: {
                type: GeminiType.OBJECT,
                properties: {
                  questionId: { type: GeminiType.STRING },
                  question: { type: GeminiType.STRING },
                  insight: { type: GeminiType.STRING },
                },
                required: ['questionId', 'question', 'insight'],
              },
            },
          },
          required: [
            'summary',
            'keyThemes',
            'sentiment',
            'recommendations',
            'notableQuotes',
            'questionInsights',
          ],
        },
      },
    });

    const text = result.text?.trim();
    if (!text) {
      throw new BadRequestException('Gemini returned an empty analysis');
    }

    return JSON.parse(text) as SurveyAiAnalysisPayload;
  }

  private normalizeSlug(value: string): string {
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!slug || slug.length > 100) {
      throw new BadRequestException('Survey slug must be 1-100 URL characters');
    }

    return slug;
  }

  private isAnalysisStale(
    analyzedAt: Date | null,
    latestResponseAt: Date | null,
    responseCount: number,
    responseCountAnalyzed: number,
  ): boolean {
    if (!latestResponseAt || !analyzedAt) return false;
    return latestResponseAt > analyzedAt || responseCount !== responseCountAnalyzed;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }
}
