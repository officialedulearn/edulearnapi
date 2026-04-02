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
