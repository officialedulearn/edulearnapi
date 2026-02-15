import { IsString, IsArray, ValidateNested, IsInt, Min } from 'class-validator';
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PublicQuizAnswerDto)
  answers: PublicQuizAnswerDto[];
}
