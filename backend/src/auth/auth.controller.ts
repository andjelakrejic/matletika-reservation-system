import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "./auth.service.js";
import { LoginDto, RegisterDto } from "./dto.js";
import { JwtAuthGuard } from "./guards.js";


@Controller()
export class AuthController {
    constructor(private auth: AuthService, private prisma: PrismaService) {}

    @Post('auth/register')
    register(@Body() dto: RegisterDto) {
        return this.auth.register(dto);
    }

    @Post('auth/login')
    login(@Body() dto: LoginDto) {
        return this.auth.login(dto);
    }
}