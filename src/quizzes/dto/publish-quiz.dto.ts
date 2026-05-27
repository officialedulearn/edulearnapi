import {
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PublishQuizQuestionDto {
  @IsString()
  question: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  options: string[];

  @IsString()
  correctAnswer: string;

  @IsString()
  explanation: string;
}

export class PublishQuizDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coveredConcepts?: string[];

  @IsOptional()
  @IsString()
  challengeProfile?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PublishQuizQuestionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  questions: PublishQuizQuestionDto[];

  @IsOptional()
  @IsUUID()
  sourceChatId?: string;
}
