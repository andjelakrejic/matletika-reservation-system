import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { Transform } from 'class-transformer'


export class CreateBookingDto {
    @IsISO8601() startAt!: string;
    @IsInt() @IsIn([1, 2]) hours!: number;
    @IsIn(['PRIMARY', 'SECONDARY']) schoolLevel!: 'PRIMARY' | 'SECONDARY';
    @IsInt() @Min(1) @Max(8) grade!: number; // osnovna 1-8, srednja: 1-4 
    
    @Transform(({ value }) =>
        Array.isArray(value) ? [...new Set(value.map((t) => String(t).trim()).filter(Boolean))] : value,
    )
    @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsString({ each: true }) 
        @MinLength(2, { each: true }) @MaxLength(60, { each: true }) topics!: string[]; // oblasti koje se vezbaju

    @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class ManualBookingDto {
    @IsISO8601() startAt!: string;
    @IsInt() @IsIn([1, 2]) hours!: number;
    @IsOptional() @IsInt() studentId?: number;
    @IsOptional() @IsString() @MinLength(2) @MaxLength(80) guestName?: string;
    @IsOptional() @IsIn(['PRIMARY', 'SECONDARY']) schoolLevel?: 'PRIMARY' | 'SECONDARY';
    @IsOptional() @IsInt() @Min(1) @Max(8) grade?: number;
    @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsString({ each: true }) 
        @MinLength(2, { each: true }) @MaxLength(60, { each: true }) topics!: string[];
    @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class UpdateStatusDto {
  @IsIn(['CONFIRMED', 'CANCELLED']) status!: 'CONFIRMED' | 'CANCELLED';
}