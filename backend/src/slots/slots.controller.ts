import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards.js";
import { SlotsService } from "./slots.service.js";

@UseGuards(JwtAuthGuard)
@Controller('slots')
export class SlotsController {
    constructor(private slots: SlotsService) {}

    @Get()
    get(@Query('date') date: string) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new BadRequestException('date mora biti YYYY-MM-DD');
        return this.slots.forDate(date);
    }
}