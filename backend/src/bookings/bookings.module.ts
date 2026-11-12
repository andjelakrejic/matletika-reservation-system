import { Module } from "@nestjs/common";
import { SlotsModule } from "../slots/slots.module.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";

@Module({
    imports: [SlotsModule, NotificationsModule],
    controllers: [BookingsController],
    providers: [BookingsService],
    exports: [BookingsService],
})
export class BookingsModule {}