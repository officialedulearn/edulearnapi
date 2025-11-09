import { IsString, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class QuizAnswerDto {
  @IsString()
  question: string;

  @IsString()
  selectedAnswer: string;

  @IsString()
  correctAnswer: string;
}

export class SubmitQuizDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  chatId?: string;

  @IsString()
  title: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers: QuizAnswerDto[];
}

