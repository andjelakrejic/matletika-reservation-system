import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "./auth.service.js";
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from "./dto.js";
import { JwtAuthGuard } from "./guards.js";


@Controller('auth')
export class AuthController {
    constructor(private auth: AuthService, private prisma: PrismaService) {}

    @Post('register')
    register(@Body() dto: RegisterDto) {
        return this.auth.register(dto);
    }

    @Post('login')
    login(@Body() dto: LoginDto) {
        return this.auth.login(dto);
    }

    @Post('forgot-password')
    forgotPassword(@Body() dto: ForgotPasswordDto) { 
        return this.auth.forgotPassword(dto); 
    }

    @Post('reset-password')
    resetPassword(@Body() dto: ResetPasswordDto) { 
        return this.auth.resetPassword(dto); 
    }
}