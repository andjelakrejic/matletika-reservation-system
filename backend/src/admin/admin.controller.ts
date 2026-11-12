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

    @Patch('setBookingStatus/:id')
    setBookingStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStatusDto) {
        return this.admin.setBookingStatus(id, dto.status);
    }

    @Post('createManualBooking')
    createManual(@Body() dto: ManualBookingDto) {
        return this.bookings.createManualBooking(dto);
    }

    @Get('getSchedule')
    getSchedule(@Query('date') date: string) {
        return this.admin.getSchedule(date);
    }

    @Get('availability')
    getAvailability() {
        return this.admin.getAvailability();
    }

    @Put('availability')
    setAvailability(@Body() dto: SetAvailabilityDto) {
        return this.admin.setAvailability(dto.items); 
    }

    @Get('time-off')
    getTimeOff() {
        return this.admin.getTimeOff();
    }
    
    @Post('time-off')
    createTimeOff(@Body() dto: CreateTimeOffDto) {
        return this.admin.createTimeOff(dto);
    }

    @Delete('time-off/:id')
    deleteTimeOff(@Param('id', ParseIntPipe) id: number) {
        return this.admin.deleteTimeOff(id);
    }


}