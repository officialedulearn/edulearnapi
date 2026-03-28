# Quiz Generation Feature - Implementation Guide

## Overview
Auto-generates quizzes from user's recent learning history, sends notifications, and provides seamless quiz-taking experience.

## Files Modified/Created

### New Files Created:
1. **`src/quizzes/quiz-generation.service.ts`** ✅
   - Main service for generating quizzes from recent learning
   - Fetches chat messages, calls AI to generate questions
   - Creates database records and sends notifications

### Files Modified:
1. **`src/ai/ai.service.ts`** ✅
   - Added `generateQuizQuestions()` method
   - Takes raw conversation text and generates quiz questions
   - Validates question structure and options

2. **`src/quizzes/quizzes.controller.ts`** ✅
   - Added `POST /quizzes/generate` endpoint
   - Added `GET /quizzes/generated` endpoint
   - Injected `QuizGenerationService`

3. **`src/quizzes/quizzes.module.ts`** ✅
   - Added `QuizGenerationService` provider
   - Imported `AiModule` and `NotificationsModule`
   - Exported `QuizGenerationService` for use in other modules

## API Endpoints

### 1. Generate Quiz from Recent Learning
**POST** `/quizzes/generate?daysBack=3`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Query Parameters:**
- `daysBack` (optional): How many days back to fetch learning history (default: 3)

**Response:**
```json
{
  "quizId": "uuid",
  "title": "Quiz: Understanding Blockchain Basics...",
  "notificationSent": true
}
```

**Behavior:**
- Fetches user's recent chat sessions (within daysBack)
- Extracts messages from most recent chat
- Calls AI to generate 10 quiz questions
- Creates quiz record in database
- Sends Expo push notification (if user has expoPushToken)
- Returns quiz ID for immediate navigation

---

### 2. Get User's Generated Quizzes
**GET** `/quizzes/generated?limit=10`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Query Parameters:**
- `limit` (optional): Number of quizzes to return (default: 10)

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "Quiz: Understanding Blockchain Basics",
    "description": "Auto-generated quiz from your Blockchain Basics discussion",
    "createdAt": "2026-03-28T21:35:00Z",
    "viewCount": 5,
    "attemptCount": 2,
    "sourceChatId": "uuid"
  }
]
```

---

### 3. Get Quiz Details (Existing)
**GET** `/quizzes/public/{quizId}`

Returns full quiz with all 10 questions and options.

---

### 4. Submit Quiz Answers (Existing)
**POST** `/quizzes/public/{quizId}/attempt`

**Body:**
```json
{
  "userId": "uuid",
  "answers": [
    { "questionIndex": 0, "selectedAnswer": "Option A" },
    { "questionIndex": 1, "selectedAnswer": "Option B" }
  ]
}
```

**Response:**
```json
{
  "score": 8,
  "totalQuestions": 10,
  "results": [
    {
      "questionIndex": 0,
      "selectedAnswer": "Option A",
      "correctAnswer": "Option A",
      "isCorrect": true
    }
  ],
  "xpEarned": 50,
  "activity": { ... }
}
```

---

## Service Architecture

### QuizGenerationService Methods

#### `generateQuizFromRecentLearning(userId, daysBack = 3)`
- **Purpose:** Main generation flow
- **Steps:**
  1. Fetch user data
  2. Find recent chat sessions (within daysBack)
  3. Extract messages from most recent chat
  4. Call `AiService.generateQuizQuestions()`
  5. Create quiz in DB (via `publicQuiz` table)
  6. Send notification via `NotificationsService`
  7. Return quiz ID and metadata
- **Error Handling:** Throws if no recent activity found

#### `getUserGeneratedQuizzes(userId, limit = 10)`
- **Purpose:** Retrieve user's generated quizzes
- **Returns:** List of quizzes ordered by creation date (newest first)

#### `scheduleQuizGeneration(userId)`
- **Purpose:** Called by cron jobs for automatic generation
- **Features:**
  - Rate limiting: Only generates if 6+ hours since last quiz
  - Non-fatal: Logs warnings instead of throwing
- **Use Case:** Scheduled background task

### AiService.generateQuizQuestions(conversationText)
- **Purpose:** AI-powered question generation
- **Input:** Raw conversation (user + assistant messages)
- **Output:** Array of 10 validated questions
- **Validation:**
  - Exactly 4 options per question
  - Correct answer matches one option
  - All fields present (question, options, correctAnswer, explanation)
- **Error Handling:** Retries up to 2 times on failure

---

## Mobile Integration Flow

### 1. User Completes Learning Session
```
User: [Chat with AI about blockchain]
→ System generates quiz automatically
```

### 2. Notification Sent
```
Push Notification:
📱 "🎯 New Quiz Available!"
   "Test your knowledge: Quiz: Understanding Blockchain Basics"

deepLink: /quiz/{quizId}
```

### 3. User Taps Notification
```
Mobile App:
- Navigates to quiz screen
- Calls GET /quizzes/public/{quizId}
- Displays 10 questions with options
```

### 4. User Completes Quiz
```
Mobile App:
- User selects answers
- POST /quizzes/public/{quizId}/attempt
- Shows score and explanations
- Awards XP and updates user profile
```

### 5. Quiz Appears in History
```
GET /quizzes/generated
- Shows in user's "Recently Generated Quizzes" list
- Can retake quiz or generate new ones
```

---

## Database Schema (Existing)

### publicQuiz Table
```sql
CREATE TABLE public_quiz (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  description text,
  questions jsonb NOT NULL,           -- Array of 10 question objects
  createdBy uuid REFERENCES user(id),
  createdAt timestamp DEFAULT NOW(),
  viewCount integer DEFAULT 0,
  attemptCount integer DEFAULT 0,
  sourceChatId uuid REFERENCES chat(id),
  visibility varchar DEFAULT 'private'
);
```

### Quiz Question Structure
```json
{
  "question": "What is blockchain?",
  "options": [
    "A distributed ledger",
    "A cryptocurrency",
    "A smart contract",
    "A consensus mechanism"
  ],
  "correctAnswer": "A distributed ledger",
  "explanation": "Blockchain is a distributed ledger that..."
}
```

---

## Error Handling & Edge Cases

### No Recent Activity
- **Error:** `NotFoundException`
- **Message:** "No recent learning activity found for user X in the last Y days"
- **Solution:** User needs to complete a chat first

### No Messages in Chat
- **Error:** `NotFoundException`
- **Message:** "No messages found in chat"
- **Solution:** User needs to have a meaningful conversation

### AI Generation Fails
- **Behavior:** Retries up to 2 times
- **Fallback:** Throws error (client can retry)
- **Timeout:** 30 second limit per attempt

### Notification Send Fails
- **Behavior:** Logged as warning, quiz still created
- **Message:** "Failed to send notification"
- **Quiz Status:** Still usable, user just won't get push notification

---

## Configuration Notes

### AI Model Selection
- **Free Users:** `gemini-2.5-flash` (faster, cheaper)
- **Premium Users:** `gemini-2.5-pro` (more powerful - future enhancement)

### Question Count
- Fixed at 10 questions (per system instruction)
- Medium difficulty (level 6/10)

### Rate Limiting
- Background cron: Minimum 6 hours between generations
- Manual trigger: No limit (user can request anytime)

---

## Testing Checklist

- [ ] Create user and complete a chat session
- [ ] Call `POST /quizzes/generate` - should return quizId
- [ ] Verify quiz created in database
- [ ] Check notification sent (if user has expoPushToken)
- [ ] Call `GET /quizzes/generated` - should list the quiz
- [ ] Call `GET /quizzes/public/{quizId}` - should return full quiz
- [ ] Call `POST /quizzes/public/{quizId}/attempt` - submit answers
- [ ] Verify score calculation and XP awarded
- [ ] Test with no recent activity (should throw error)
- [ ] Test with insufficient chat messages (should throw error)

---

## Future Enhancements

1. **Scheduled Generation**
   - Cron job that generates quizzes daily for active users
   - Call `scheduleQuizGeneration()` for each user

2. **Topic Detection**
   - Auto-extract topic from conversation
   - Use in quiz title and notifications

3. **Difficulty Levels**
   - Allow users to request easy/medium/hard quizzes
   - Pass difficulty parameter to AI

4. **Multi-Chat Quizzes**
   - Combine questions from multiple recent chats
   - Create comprehensive assessments

5. **Quiz Analytics**
   - Track quiz performance over time
   - Identify weak areas in learning
   - Recommend follow-up quizzes

6. **Retake Tracking**
   - Track retakes and improvement
   - Show score history

---

## Deployment Notes

1. **Ensure modules are imported:**
   - `AiModule` in `QuizzesModule`
   - `NotificationsModule` in `QuizzesModule`

2. **Test endpoints in staging first:**
   - Generate a few quizzes
   - Verify database records
   - Check notification system

3. **No database migrations needed:**
   - All tables already exist (`publicQuiz`, `notifications`, `chat`, `message`)

4. **Environment variables:**
   - Google AI API key (already configured)
   - Expo push token handling (already in place)

---

## Support & Debugging

### Quiz Generation Fails
```bash
# Check AI service logs
# Verify conversation has 2+ user messages
# Check if conversation is learning-focused
```

### Notification Not Sent
```bash
# Verify user has expoPushToken in database
# Check Expo push service is running
# Look for "Notification sent" log message
```

### Score Not Calculated
```bash
# Verify answers match question indices
# Check correctAnswer is exact string match
# Ensure ActivityService.submitQuiz() is working
```

---

_Feature documentation generated 2026-03-28_
_Ready for implementation and testing_
