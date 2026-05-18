import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_USER_SETTINGS_PREFERENCES,
  normalizeUserSettingsPreferences,
  User,
  type UserSettingsPreferences,
  user,
  userReward,
} from 'lib/db/schema';
import db from '../../drizzle';
import { count, eq } from 'drizzle-orm';

const USER_SETTINGS_KEYS: Array<keyof UserSettingsPreferences> = [
  'pushNotifications',
  'inAppNotifications',
  'emailNotifications',
  'agentWake',
  'memoryEnabled',
];

@Injectable()
export class UserService {
  async getUserById(id: string): Promise<User | null> {
    try {
      const result = await db
        .select({
          id: user.id,
          address: user.address,
          xp: user.xp,
          credits: user.credits,
          name: user.name,
          email: user.email,
          lastLoggedIn: user.lastLoggedIn,
          streak: user.streak,
          referralCode: user.referralCode,
          quizLimits: user.quizLimits,
          quizCompleted: user.quizCompleted,
          isPremium: user.isPremium,
          premiumUntil: user.premiumUntil,
          verified: user.verified,
          profilePictureURL: user.profilePictureURL,
        })
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      if (!result.length) return null;

      const [{ count: nftCount }] = await db
        .select({
          count: count(),
        })
        .from(userReward)
        .where(eq(userReward.userId, id));

      return {
        ...result[0],
        quizLimit: result[0].quizLimits,
        nfts: nftCount,
      } as any;
    } catch (error) {
      console.error('Failed to get user by ID');
      throw error;
    }
  }

  private sanitizeSettingsPatch(
    patch: Partial<UserSettingsPreferences>,
  ): Partial<UserSettingsPreferences> {
    if (!patch || typeof patch !== 'object') {
      throw new BadRequestException('Settings payload is required');
    }

    const sanitized: Partial<UserSettingsPreferences> = {};

    for (const key of USER_SETTINGS_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;

      if (typeof value !== 'boolean') {
        throw new BadRequestException(`${key} must be a boolean value`);
      }

      sanitized[key] = value;
    }

    if (!Object.keys(sanitized).length) {
      throw new BadRequestException('No valid settings fields were provided');
    }

    return sanitized;
  }

  async getUserSettings(userId: string): Promise<UserSettingsPreferences> {
    const [result] = await db
      .select({ settingsPreferences: user.settingsPreferences })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!result) {
      throw new NotFoundException('User not found');
    }

    return normalizeUserSettingsPreferences(result.settingsPreferences);
  }

  async updateUserSettings(
    userId: string,
    patch: Partial<UserSettingsPreferences>,
  ): Promise<UserSettingsPreferences> {
    const sanitizedPatch = this.sanitizeSettingsPatch(patch);
    const currentSettings = await this.getUserSettings(userId);

    const nextSettings: UserSettingsPreferences = {
      ...DEFAULT_USER_SETTINGS_PREFERENCES,
      ...currentSettings,
      ...sanitizedPatch,
    };

    const updatePayload: { settingsPreferences: UserSettingsPreferences; memory?: string } =
      {
        settingsPreferences: nextSettings,
      };

    if (sanitizedPatch.memoryEnabled === false) {
      updatePayload.memory = '';
    }

    const updatedRows = await db
      .update(user)
      .set(updatePayload)
      .where(eq(user.id, userId))
      .returning({ id: user.id });

    if (!updatedRows.length) {
      throw new NotFoundException('User not found');
    }

    return nextSettings;
  }

  async getUserMemory(userId: string): Promise<string> {
    const [result] = await db
      .select({
        memory: user.memory,
        settingsPreferences: user.settingsPreferences,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!result) {
      return '';
    }

    const settings = normalizeUserSettingsPreferences(result.settingsPreferences);
    if (!settings.memoryEnabled) {
      return '';
    }

    return result.memory ?? '';
  }

  async updateUserMemory(userId: string, memory: string): Promise<string> {
    const [result] = await db
      .select({ settingsPreferences: user.settingsPreferences })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!result) {
      throw new NotFoundException('User not found');
    }

    const settings = normalizeUserSettingsPreferences(result.settingsPreferences);
    if (!settings.memoryEnabled) {
      return '';
    }

    await db.update(user).set({ memory }).where(eq(user.id, userId));
    return memory;
  }
}
