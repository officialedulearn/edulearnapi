import { ApiProperty } from '@nestjs/swagger';

export class GenerateQuizDto {
  @ApiProperty({
    description: 'The chat ID to generate quiz from',
    example: '12345678-1234-1234-1234-123456789012',
  })
  chatId: string;

  @ApiProperty({
    description: 'The user ID (use marketplace user ID for marketplace API)',
    example: '12345678-1234-1234-1234-123456789012',
  })
  userId: string;
}

