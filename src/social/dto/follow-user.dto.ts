import { IsUUID, IsNotEmpty } from 'class-validator';

export class FollowUserDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
