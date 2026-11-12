import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";


export class UpdateProfileDto {
    @IsOptional() @IsString() @MinLength(2) @MaxLength(20) firstName?: string;
    @IsOptional() @IsString() @MinLength(2) @MaxLength(20) lastName?: string;
}

export class ChangePasswordDto {
    @IsString() currentPassword!: string;
    @IsString() @MinLength(8) @MaxLength(100) newPassword!: string;
    @IsString() confirmPassword!: string;
}

export class DeleteAccountDto {
    @IsString() password!: string;
}

export class PushTokenDto {
    @Matches(/^Expo(nent)?PushToken\[.+\]$/) token!: string;
}