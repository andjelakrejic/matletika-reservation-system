import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsISO8601, Matches, MATCHES, Max, Min, ValidateNested } from "class-validator";


const HALF_HOUR = /^([01]\d|2[0-3]):(00|30)$/;

export class AvailabilityItemDto {
    @IsInt() @Min(0) @Max(6) weekday!: number;
    @Matches(HALF_HOUR) startTime!: string;
    @Matches(HALF_HOUR) endTime!: string;
}

export class SetAvailabilityDto {
    @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => AvailabilityItemDto) items!: AvailabilityItemDto[];
}

export class CreateTimeOffDto {
    @IsISO8601() startAt!: string;
    @IsISO8601() endAt!: string;
}