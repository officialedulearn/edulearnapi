import {
  DEFAULT_USER_SETTINGS_PREFERENCES,
  normalizeUserSettingsPreferences,
} from 'lib/db/schema';

describe('user settings normalization', () => {
  it('adds default voice settings for old preference payloads', () => {
    expect(
      normalizeUserSettingsPreferences({
        pushNotifications: false,
        inAppNotifications: true,
        emailNotifications: true,
        agentWake: false,
        memoryEnabled: true,
      }),
    ).toEqual({
      pushNotifications: false,
      inAppNotifications: true,
      emailNotifications: true,
      agentWake: false,
      memoryEnabled: true,
      voiceResponsesEnabled:
        DEFAULT_USER_SETTINGS_PREFERENCES.voiceResponsesEnabled,
      voiceId: DEFAULT_USER_SETTINGS_PREFERENCES.voiceId,
    });
  });
});
