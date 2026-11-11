import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, ProfessorGuard } from "../auth/guards.js";
import { AdminService } from "./admin.service.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { ManualBookingDto, UpdateStatusDto } from "../bookings/dtos.js";
import { CreateTimeOffDto, SetAvailabilityDto } from "./dtos.js";

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

    @Get('getAvailability')
    getAvailability() {
        return this.admin.getAvailability();
    }

    @Put('setAvailability')
    setAvailability(@Body() dto: SetAvailabilityDto) {
        return this.admin.setAvailability(dto.items); 
    }

    @Get('getTimeOff')
    getTimeOff() {
        return this.admin.getTimeOff();
    }
    
    @Post('createTimeOff')
    createTimeOff(@Body() dto: CreateTimeOffDto) {
        return this.admin.createTimeOff(dto);
    }

    @Delete('deleteTimeOff/:id')
    deleteTimeOff(@Param('id', ParseIntPipe) id: number) {
        return this.admin.deleteTimeOff(id);
    }


}