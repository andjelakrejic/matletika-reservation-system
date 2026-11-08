import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, ProfessorGuard } from "../auth/guards.js";
import { AdminService } from "./admin.service.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { ManualBookingDto, UpdateStatusDto } from "../bookings/dtos.js";

@UseGuards(JwtAuthGuard, ProfessorGuard)
@Controller('admin')
export class AdminController {
    constructor(private admin: AdminService, private bookings: BookingsService) {}

    @Get('getAllBookings')
    getAllBookings(@Query('status') status?: string) {
        return this.admin.getAllBookings(status);
    }

    @Patch('bookings/:id')
    setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStatusDto) {
        return this.admin.setStatus(id, dto.status);
    }

    @Post('createManual')
    createManual(@Body() dto: ManualBookingDto) {
        return this.bookings.createManual(dto);
    }

    @Get('getSchedule')
    getSchedule(@Query('date') date: string) {
        return this.admin.getSchedule(date);
    }
}