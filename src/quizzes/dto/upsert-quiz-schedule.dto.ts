import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertQuizScheduleDto {
  @IsString()
  @MinLength(1)
  topic: string;

  @IsIn(['easy', 'medium', 'hard'])
  difficulty: 'easy' | 'medium' | 'hard';

  @IsString()
  @MinLength(5)
  cronExpression: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  timeZone?: string;
}
