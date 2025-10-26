import { ApiProperty } from '@nestjs/swagger';

export class CreateChatDto {
  @ApiProperty({
    description: 'The title of the chat session',
    example: 'Learning Python Basics',
  })
  title: string;

  @ApiProperty({
    description: 'The user ID (use marketplace user ID for marketplace API)',
    example: '12345678-1234-1234-1234-123456789012',
  })
  userId: string;
}

