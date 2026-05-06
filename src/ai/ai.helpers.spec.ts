import {
  sanitizeAssistantMessageContent,
  sanitizeLeakedAssistantToolTranscript,
} from './ai.helpers';

describe('ai.helpers assistant transcript sanitizer', () => {
  it('extracts leaked memory facts and keeps only the assistant-facing text', () => {
    const raw = JSON.stringify({
      text:
        "tool_code\nprint(default_api.updateUserMemory(facts=['Obi Chukwuemerie Samuel is currently learning CSS.']))\nthought\n" +
        "The user, Obi Chukwuemerie Samuel, is a frontend developer who is currently learning CSS. " +
        'This is new information that is not already in the `LONG-TERM LEARNER MEMORY`. ' +
        'Therefore, I should use the `updateUserMemory` tool to persist this new fact. ' +
        'That\'s awesome, Obi! Getting a strong grasp on CSS is super important.',
    });

    const sanitized = sanitizeLeakedAssistantToolTranscript(raw);

    expect(sanitized.leakedMemoryFacts).toEqual([
      'Obi Chukwuemerie Samuel is currently learning CSS.',
    ]);
    expect(sanitized.text).toBe(
      "That's awesome, Obi! Getting a strong grasp on CSS is super important.",
    );
  });

  it('sanitizes assistant message content objects before persistence', () => {
    const content = sanitizeAssistantMessageContent({
      text: 'tool_code\nprint(default_api.updateUserMemory(facts=["Learning CSS"]))\nthought\nGreat, let us continue.',
      metadata: { source: 'model' },
    });

    expect(content).toEqual({
      text: 'Great, let us continue.',
      metadata: { source: 'model' },
    });
  });
});
