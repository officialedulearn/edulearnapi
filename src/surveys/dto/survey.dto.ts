import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { SurveyQuestionType } from '../../../lib/db/schema';

const questionTypes = [
  'short_text',
  'long_text',
  'rating',
  'single_choice',
  'multiple_choice',
  'boolean',
] as const;

export class SurveyQuestionInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MaxLength(500)
  prompt: string;

  @IsIn(questionTypes)
  type: SurveyQuestionType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateSurveyDto {
  @IsString()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MaxLength(100)
  slug: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionInputDto)
  questions: SurveyQuestionInputDto[];
}

export class UpdateSurveyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionInputDto)
  questions?: SurveyQuestionInputDto[];
}

export class SurveyAnswerInputDto {
  @IsString()
  questionId: string;

  value: unknown;
}

export class SubmitSurveyResponseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SurveyAnswerInputDto)
  answers: SurveyAnswerInputDto[];
}
