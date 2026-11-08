import { Module } from "@nestjs/common";
import { SlotsModule } from "../slots/slots.module.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";

@Module({
    imports: [SlotsModule],
    controllers: [BookingsController],
    providers: [BookingsService],
    exports: [BookingsService],
})
export class BookingsModule {}