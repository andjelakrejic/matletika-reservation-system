import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'

export class RegisterDto {
    @IsString() @MinLength(2) @MaxLength(20) firstName!: string;
    @IsString() @MinLength(2) @MaxLength(20) lastName!: string;
    @IsEmail() email!: string;
    @IsString() @MinLength(8) @MaxLength(100) password!: string;
}

export class LoginDto {
    @IsEmail() email!: string;
    @IsString() password!: string;
}