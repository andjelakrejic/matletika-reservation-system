import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
    @Transform(trim) @IsString() @MinLength(2) @MaxLength(20) firstName!: string;
    @Transform(trim) @IsString() @MinLength(2) @MaxLength(20) lastName!: string;
    @IsEmail() email!: string;
    @IsString() @MinLength(8) @MaxLength(100) password!: string;
}

export class LoginDto {
    @IsEmail() email!: string;
    @IsString() password!: string;
}

export class ForgotPasswordDto {
    @IsEmail() email!: string;
}

export class ResetPasswordDto {
    @IsEmail() email!: string;
    @Matches(/^\d{6}$/) code!: string;
    @IsString() @MinLength(8) @MaxLength(100) newPassword!: string;
    @IsString() confirmPassword!: string;
}