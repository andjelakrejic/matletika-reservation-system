import { Module } from "@nestjs/common";
import { BookingsModule } from "../bookings/bookings.module.js";
import { BookingsController } from "../bookings/bookings.controller.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";


@Module({
    imports: [BookingsModule, NotificationsModule],
    controllers: [BookingsController],
    providers: [BookingsService]
})
export class AdminModule {}