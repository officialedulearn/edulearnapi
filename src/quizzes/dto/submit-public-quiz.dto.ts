import {
  IsString,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PublicQuizAnswerDto {
  @IsInt()
  @Min(0)
  questionIndex: number;

  @IsString()
  selectedAnswer: string;
}

export class SubmitPublicQuizDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsUUID()
  participationId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PublicQuizAnswerDto)
  answers: PublicQuizAnswerDto[];
}
