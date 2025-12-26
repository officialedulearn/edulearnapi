# Shareable Cards API

Generate beautiful shareable cards for users to show off their achievements, streaks, earnings, and more.

## Design System

All cards follow the EduLearn design system:
- **Primary Color**: `#00FF80` (Success green)
- **Dark Theme**: Black backgrounds with subtle borders
- **Light Theme**: White backgrounds with clean borders
- **Typography**: Inter font family
- **Border Radius**: Consistent rounded corners (16-24px)

## Endpoints

### 1. Generic OG Card
**GET** `/cards/og`

Generic Open Graph card for social media sharing.

**Query Parameters:**
- `title` (string, optional): Main title text
- `subtitle` (string, optional): Subtitle text
- `mascot` (string, optional): URL to mascot/image
- `theme` ('light' | 'dark', optional): Color theme

**Example:**
```
GET /cards/og?title=Welcome%20to%20EduLearn&subtitle=AI-powered%20learning&theme=dark
```

---

### 2. Streak Card
**GET** `/cards/streak/:userId`

Shows user's learning streak with XP and quiz stats.

**Path Parameters:**
- `userId` (string, required): User's UUID

**Query Parameters:**
- `theme` ('light' | 'dark', optional): Color theme (default: dark)

**Features:**
- 🔥 Large streak counter with flame emoji
- User avatar with green border
- XP and quiz completion stats
- Username and display name

**Example:**
```
GET /cards/streak/123e4567-e89b-12d3-a456-426614174000?theme=dark
```

---

### 3. Earnings Card
**GET** `/cards/earnings/:userId`

Displays user's total earnings and financial stats.

**Path Parameters:**
- `userId` (string, required): User's UUID

**Query Parameters:**
- `theme` ('light' | 'dark', optional): Color theme (default: dark)

**Features:**
- 💰 Total earnings in large green text
- Credits balance display
- Referral count
- User avatar and profile info

**Example:**
```
GET /cards/earnings/123e4567-e89b-12d3-a456-426614174000?theme=dark
```

---

### 4. Level Card
**GET** `/cards/level/:userId`

Showcases user's current level with comprehensive stats.

**Path Parameters:**
- `userId` (string, required): User's UUID

**Query Parameters:**
- `theme` ('light' | 'dark', optional): Color theme (default: dark)

**Features:**
- Level badge with emoji (🌱 Novice → 👑 Expert)
- Circular avatar with green border
- XP, Quizzes, and Streak stats
- Centered, profile-style layout

**Levels:**
- 🌱 Novice
- 📚 Beginner
- 🎯 Intermediate
- 🚀 Advanced
- 👑 Expert

**Example:**
```
GET /cards/level/123e4567-e89b-12d3-a456-426614174000?theme=light
```

---

## Response Format

All endpoints return:
- **Content-Type**: `image/png`
- **Dimensions**: 1080x1080px (Instagram square format)
- **Cache-Control**: 
  - OG cards: 1 hour (3600s)
  - User cards: 5 minutes (300s)
- **Features**:
  - High-quality avatar images (Twitter 400x400 format)
  - Mascot images for each card type
  - EduLearn logo branding

## Usage in Frontend

### React/Next.js Example

```tsx
export function ShareStreakButton({ userId }: { userId: string }) {
  const shareUrl = `${API_URL}/cards/streak/${userId}?theme=dark`;
  
  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({
        title: 'Check out my streak!',
        text: 'I\'m on fire on EduLearn! 🔥',
        url: shareUrl,
      });
    }
  };

  return <button onClick={handleShare}>Share Streak</button>;
}
```

### React Native Example

```tsx
import * as Sharing from 'expo-sharing';

export function ShareEarningsButton({ userId }: { userId: string }) {
  const shareUrl = `${API_URL}/cards/earnings/${userId}?theme=dark`;
  
  const handleShare = async () => {
    await Sharing.shareAsync(shareUrl, {
      dialogTitle: 'Share my earnings',
    });
  };

  return <Button title="Share Earnings" onPress={handleShare} />;
}
```

### Direct Image Embedding

```html
<!-- Open Graph meta tags -->
<meta property="og:image" content="https://api.edulearn.com/cards/level/USER_ID?theme=dark" />
<meta property="og:image:width" content="1080" />
<meta property="og:image:height" content="1080" />

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://api.edulearn.com/cards/streak/USER_ID?theme=dark" />

<!-- Instagram optimized -->
<meta property="og:image:type" content="image/png" />
```

## Performance Notes

1. **Font Caching**: Fonts are loaded once and cached in memory
2. **Response Caching**: Cards are cached for 5 minutes (user cards) or 1 hour (OG cards)
3. **Avatar Loading**: User avatars are fetched and converted to data URLs
4. **Error Handling**: Returns 404 if user not found

## Technical Stack

- **satori**: React-like JSX to SVG conversion
- **@resvg/resvg-js**: SVG to PNG rendering
- **axios**: HTTP client for font/image fetching
- **Inter font**: Via jsDelivr CDN

## Future Enhancements

- [ ] Add achievement/badge cards
- [ ] Add quiz completion milestone cards
- [ ] Add referral leaderboard cards
- [ ] Support custom backgrounds
- [ ] Add animation/GIF support
- [ ] Add watermark options

