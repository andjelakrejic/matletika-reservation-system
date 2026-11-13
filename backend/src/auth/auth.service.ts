import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { JwtService } from "@nestjs/jwt"
import { RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto } from "./dto.js";
import bcrypt from 'bcrypt'
import { MailService } from "../mail/mail.service.js";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { RESET_CODE_TTL_MS, RESET_MAX_ATTEMPTS } from "../config.js";


@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwt: JwtService,
        private mail: MailService,
        private config: ConfigService
    ) {}

    private issueToken(user: {id: number; firstName: string; lastName: string; email: string; role: string}) {
        const token = this.jwt.sign({sub: user.id, role: user.role});
        return { token, user: {id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role}}
    }

    private hashCode(code: string) {
        return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET')).update(code).digest('hex');
    }

    async register (dto: RegisterDto) {
        const email = dto.email.toLowerCase();
        if (await this.prisma.user.findUnique({where: {email}}))
            throw new ConflictException("This email is already registered.");

        const user = await this.prisma.user.create({
            data: {
                firstName: dto.firstName,
                lastName: dto.lastName,
                email,
                password: await bcrypt.hash(dto.password, 10)
            }
        })

        return this.issueToken(user);
    }

    async login (dto: LoginDto) {
        const user = await this.prisma.user.findUnique({ where: {email: dto.email.toLowerCase() }});
        if (!user || !(await bcrypt.compare(dto.password, user.password)))
            throw new UnauthorizedException('Incorrect email or password');
        return this.issueToken(user);
    }


    async forgotPassword(dto: ForgotPasswordDto) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
        if (!user) return { ok: true }; // do not reveal whether the email exists

        // Cooldown: at most one code per minute per user
        const recent = await this.prisma.passwordReset.findFirst({
            where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } },
        });
        if (recent) return { ok: true };

        const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
        await this.prisma.$transaction([
            this.prisma.passwordReset.deleteMany({ where: { userId: user.id } }),
            this.prisma.passwordReset.create({
            data: {
                userId: user.id,
                codeHash: this.hashCode(code),
                expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
            },
            }),
        ]);

        await this.mail.send(
            user.email,
            'Matletika: code for password change',
            `Your code to change your password is: ${code}. It lasts 15 minutes. If you didn't request to change your password, ignore this message.`,
        );
        return { ok: true };
    }

    async resetPassword(dto: ResetPasswordDto) {
        if (dto.newPassword !== dto.confirmedPassword) throw new BadRequestException('Passwords do not match');
        const invalid = new BadRequestException('Invalid or expired code');

        const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
        if (!user) throw invalid;

        const reset = await this.prisma.passwordReset.findFirst({
            where: { userId: user.id, expiresAt: { gt: new Date() }, attempts: { lt: RESET_MAX_ATTEMPTS } },
            orderBy: { createdAt: 'desc' },
        });
        if (!reset) throw invalid;

        const given = Buffer.from(this.hashCode(dto.code));
        const stored = Buffer.from(reset.codeHash);
        if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
            await this.prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
            throw invalid;
        }

        const password = await bcrypt.hash(dto.newPassword, 10);
        await this.prisma.$transaction([
            this.prisma.user.update({ where: { id: user.id }, data: { password } }),
            this.prisma.passwordReset.deleteMany({ where: { userId: user.id } }),
        ]);
        return { ok: true };
    }
}