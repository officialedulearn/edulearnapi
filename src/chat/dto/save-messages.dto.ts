import { ApiProperty } from '@nestjs/swagger';

class MessageContent {
  @ApiProperty({
    description: 'Content type',
    enum: ['text', 'image'],
    example: 'text',
  })
  type: string;

  @ApiProperty({
    description: 'Text content',
    example: 'What is machine learning?',
    required: false,
  })
  text?: string;

  @ApiProperty({
    description: 'Image URL or base64 encoded image',
    required: false,
  })
  image?: string;
}

class MessageDto {
  @ApiProperty({
    description: 'Message role',
    enum: ['user', 'assistant'],
    example: 'user',
  })
  role: string;

  @ApiProperty({
    description: 'Message content array',
    type: [MessageContent],
    example: [{ type: 'text', text: 'Hello, AI!' }],
  })
  content: MessageContent[];

  @ApiProperty({
    description: 'Chat ID this message belongs to',
    example: '12345678-1234-1234-1234-123456789012',
  })
  chatId: string;

  @ApiProperty({
    description: 'Timestamp when the message was created',
    example: '2024-01-01T12:00:00Z',
  })
  createdAt: string | Date;
}

export class SaveMessagesDto {
  @ApiProperty({
    description: 'Array of messages to save',
    type: [MessageDto],
  })
  messages: MessageDto[];
}

