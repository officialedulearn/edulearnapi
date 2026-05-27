export const QUIZ_SYSTEM_INSTRUCTION = `Based on the context of our conversation so far, generate EXACTLY 10 quiz questions to test understanding — but only if the discussion included web3 learning-based content. If the conversation was casual or unrelated to learning, return an empty array [].

All questions should be medium difficulty (level 6 on a scale of 1 to 10), with 4 options and only one correct answer.

CRITICAL REQUIREMENTS:
- YOU MUST GENERATE EXACTLY 10 QUESTIONS - NOT 5, NOT 9, EXACTLY 10
- Each question MUST have exactly 4 options (no more, no less)
- The correctAnswer MUST be one of the 4 options (exact match, character-for-character)
- All fields are required and must be strings (except options which is an array of strings)
- Questions must be diverse and cover different aspects of the conversation topic
- Avoid duplicate or very similar questions
- Each option should be distinct and plausible

JSON FORMATTING RULES (CRITICAL):
- Return ONLY a valid JSON array - no markdown, no code blocks, no extra text
- Do NOT include newlines or line breaks within string values
- Do NOT use unescaped quotes within strings
- Keep all text on single lines within each string field
- Use proper JSON escaping for special characters
- Do NOT add trailing commas after the last element

VALIDATION CHECKLIST (must pass all):
✓ Array contains exactly 10 question objects
✓ Each question has: question (string), options (array of 4 strings), correctAnswer (string), explanation (string)
✓ correctAnswer exactly matches one of the 4 options
✓ No empty strings or null values
✓ Options are sufficiently different from each other
✓ JSON is properly formatted and parseable

Return ONLY valid JSON matching the schema.`;

export function buildScheduledQuizSystemInstruction(
  difficulty: 'easy' | 'medium' | 'hard',
): string {
  const difficultyLine =
    difficulty === 'easy'
      ? 'easy — basic recall and definitions'
      : difficulty === 'medium'
        ? 'medium — standard understanding and application'
        : 'hard — deeper reasoning, edge cases, and synthesis';

  return `Generate EXACTLY 10 multiple-choice quiz questions for the learner.

The user message will include:
- A TOPIC to focus on
- Optional LEARNER CONTEXT from recent studying (may be empty)

Target difficulty: ${difficultyLine}

CRITICAL REQUIREMENTS:
- YOU MUST GENERATE EXACTLY 10 QUESTIONS
- Each question MUST have exactly 4 options
- The correctAnswer MUST be one of the 4 options (exact match)
- All fields required: question, options, correctAnswer, explanation
- Questions must cover the topic and, when present, relate to learner context without copying it verbatim
- Questions must not repeat recent quiz history provided in the user message
- Include a compact summary, concept list, and challenge profile for future quiz generation
- If the topic is unusable, still return the required object shape with an empty questions array

JSON FORMATTING RULES:
- Return ONLY a valid JSON array — no markdown or code fences
- No newlines inside string values; escape properly
- No trailing commas

VALIDATION:
- Exactly 10 question objects
- Each question: 4 distinct options, correctAnswer matches one option
- summary is one sentence
- coveredConcepts contains 5-12 short labels
- challengeProfile explains whether the quiz tests recall, application, edge cases, comparison, or synthesis

Return ONLY valid JSON matching the schema.`;
}
