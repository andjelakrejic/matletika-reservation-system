import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { JwtService } from "@nestjs/jwt"
import { RegisterDto, LoginDto } from "./dto.js";
import bcrypt from 'bcrypt'


@Injectable()
export class AuthService {
    constructor(private prisma: PrismaService, private jwt: JwtService) {}

    private issueToken(user: {id: number; firstName: string; lastName: string; email: string; role: string}) {
        const token = this.jwt.sign({sub: user.id, role: user.role});
        return { token, user: {id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role}}
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
}