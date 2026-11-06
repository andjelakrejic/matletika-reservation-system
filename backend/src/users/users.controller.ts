import { Body, Controller, Get, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards.js";
import { UsersService } from "./users.service.js";
import { ChangePasswordDto, UpdateProfileDto } from "./dto.js";

@UseGuards(JwtAuthGuard)
@Controller('me')
export class UsersController {

    constructor(private users: UsersService) {}

    @Get()
    getMe(@Req() req: any) {
        return this.users.getMe(req.user.id)
    }

    @Patch()
    update(@Req() req: any, @Body() dto: UpdateProfileDto) {
        return this.users.update(req.user.id, dto);
    }

    @Patch('password') 
    changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
        return this.users.changePassword(req.user.id, dto);
    }

    @Get('bookings')
    getBookings(@Req() req: any, @Query('when') when: 'upcoming' | 'past' | 'all' = 'all') {
        return this.users.getBookings(req.user.id, when);
    }

}