import { Body, Controller, Delete, Param, ParseIntPipe, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards.js";
import { BookingsService } from "./bookings.service.js";
import { CreateBookingDto } from "./dtos.js";

@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
    constructor(private bookings: BookingsService) {}

    @Post()
    create(@Req() req: any, @Body() dto: CreateBookingDto) {
        return this.bookings.create(req.user.id, dto);
    }

    @Delete(':id')
    cancel(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
        return this.bookings.cancel(req.user, id);
    }
}
