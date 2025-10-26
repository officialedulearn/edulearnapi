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
    example: 'Explain quantum computing in simple terms',
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
    example: [{ type: 'text', text: 'What is machine learning?' }],
  })
  content: MessageContent[];
}

export class GenerateMessageDto {
  @ApiProperty({
    description: 'Array of conversation messages',
    type: [MessageDto],
    example: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'What is machine learning?' }],
      },
    ],
  })
  messages: MessageDto[];

  @ApiProperty({
    description: 'The chat ID for this conversation',
    example: '12345678-1234-1234-1234-123456789012',
  })
  chatId: string;

  @ApiProperty({
    description: 'The user ID (use marketplace user ID for marketplace API)',
    example: '12345678-1234-1234-1234-123456789012',
  })
  userId: string;
}

