import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsArray,
  IsNotEmpty,
  ValidateNested,
  IsUUID,
  IsDate,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
  MinLength,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class MessageContentDto {
  @ApiProperty({
    description: 'The type of content in the message',
    example: 'text',
    enum: ['text', 'image_url'],
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description:
      'The text content of the message. Required when type is "text"',
    example: 'What is machine learning?',
    required: false,
  })
  text?: string;

  @ApiProperty({
    description: 'Image URL object. Required when type is "image_url"',
    example: { url: 'https://example.com/image.jpg' },
    required: false,
  })
  image_url?: {
    url: string;
  };
}

export class MessageDto {
  @ApiProperty({
    description: 'Unique identifier for the message',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'The ID of the chat this message belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({
    description: 'The role of the message sender',
    example: 'user',
    enum: ['user', 'assistant', 'system'],
  })
  @IsString()
  @IsNotEmpty()
  role: 'user' | 'assistant' | 'system';

  @ApiProperty({
    description:
      'The content of the message. Can be a simple text string or an array of content objects for multimodal messages',
    example: [
      {
        type: 'text',
        text: 'What is machine learning?',
      },
    ],
    type: 'array',
    items: {
      type: 'object',
    },
  })
  @IsNotEmpty()
  content: MessageContentDto[] | string;

  @ApiProperty({
    description: 'Timestamp when the message was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  @Transform(({ value }) => (value instanceof Date ? value : new Date(value)))
  @IsDate()
  @IsNotEmpty()
  createdAt: Date;
}

export class GenerateMessagesDto {
  @ApiProperty({
    description: 'Array of messages in the conversation',
    type: [MessageDto],
    example: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        chatId: '123e4567-e89b-12d3-a456-426614174000',
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What is machine learning?',
          },
        ],
        createdAt: '2024-01-15T10:30:00.000Z',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[];

  @ApiProperty({
    description: 'The ID of the chat conversation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({
    description: 'The ID of the user making the request',
    example: '987fbc97-4bed-5078-9f07-9141ba07c9f3',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class GenerateTitleDto {
  @ApiProperty({
    description: 'Unique identifier for the message',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'The ID of the chat this message belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({
    description: 'The role of the message sender',
    example: 'user',
    enum: ['user', 'assistant', 'system'],
  })
  @IsString()
  @IsNotEmpty()
  role: 'user' | 'assistant' | 'system';

  @ApiProperty({
    description: 'The content of the message',
    example: [
      {
        type: 'text',
        text: 'What is machine learning?',
      },
    ],
  })
  @IsNotEmpty()
  content: MessageContentDto[] | string;

  @ApiProperty({
    description: 'Timestamp when the message was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  @Transform(({ value }) => (value instanceof Date ? value : new Date(value)))
  @IsDate()
  @IsNotEmpty()
  createdAt: Date;
}

export class GenerateQuizDto {
  @ApiProperty({
    description: 'The ID of the chat to generate a quiz from',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({
    description: 'The ID of the user requesting the quiz',
    example: '987fbc97-4bed-5078-9f07-9141ba07c9f3',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class GenerateSuggestionsDto {
  @ApiProperty({
    description: 'The ID of the user requesting topic suggestions',
    example: '987fbc97-4bed-5078-9f07-9141ba07c9f3',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: 'When true, skip Redis cache and regenerate from Gemini',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
}

export type StudySuggestionReaction = 'up' | 'down';

export interface StudySuggestionsResponse {
  suggestions: string[];
  generatedAt: string;
  feedback: Partial<Record<'0' | '1' | '2', StudySuggestionReaction>>;
  fromCache: boolean;
}

export class UpdateStudySuggestionFeedbackDto {
  @ApiProperty({
    description: 'The ID of the user updating suggestion feedback',
    example: '987fbc97-4bed-5078-9f07-9141ba07c9f3',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Index of the suggestion (0, 1, or 2)',
    minimum: 0,
    maximum: 2,
  })
  @IsInt()
  @Min(0)
  @Max(2)
  index: number;

  @ApiProperty({
    description: 'Reaction for that suggestion; use none to clear',
    enum: ['up', 'down', 'none'],
  })
  @IsIn(['up', 'down', 'none'])
  action: 'up' | 'down' | 'none';
}

export class GenerateFlashcardsDto {
  @ApiProperty({
    description: 'The ID of the user requesting flashcard generation',
    example: '987fbc97-4bed-5078-9f07-9141ba07c9f3',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Description of what to study (topic, scope, level)',
    example: 'Solana account model and rent for an intermediate learner',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  topic: string;

  @ApiProperty({
    description: 'Number of cards to generate (5–30). Default 15.',
    example: 15,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(30)
  cardCount?: number;
}
