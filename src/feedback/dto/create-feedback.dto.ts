import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateFeedbackDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(10, { message: 'Feedback must be at least 10 characters long' })
  @MaxLength(500, { message: 'Feedback must not exceed 500 characters' })
  content: string;

  @IsOptional()
  @IsEnum(['bug', 'feature', 'improvement', 'other'])
  category?: 'bug' | 'feature' | 'improvement' | 'other';

  @IsNotEmpty()
  @IsString()
  userId: string;
}

export class UpdateFeedbackStatusDto {
  @IsNotEmpty()
  @IsEnum(['pending', 'reviewed', 'resolved'])
  status: 'pending' | 'reviewed' | 'resolved';
}
