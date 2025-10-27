import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsArray, IsNotEmpty, ValidateNested, IsUUID, IsDate } from 'class-validator';
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
    description: 'The text content of the message. Required when type is "text"',
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
    description: 'The content of the message. Can be a simple text string or an array of content objects for multimodal messages',
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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageContentDto)
  content: MessageContentDto[] | string;

  @ApiProperty({
    description: 'Timestamp when the message was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  @Transform(({ value }) => value instanceof Date ? value : new Date(value))
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
  @Transform(({ value }) => value instanceof Date ? value : new Date(value))
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
}

