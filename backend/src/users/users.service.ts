import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { ChangePasswordDto, UpdateProfileDto } from "./dto.js";
import bcrypt from 'bcrypt'

const PROFILE_SELECT = {
  id: true, 
  firstName: true, 
  lastName: true, 
  email: true, 
  role: true, 
  createdAt: true,
} as const;

@Injectable()
export class UsersService {

    constructor(private prisma: PrismaService) {}

    getMe(id: number) {
        return this.prisma.user.findUniqueOrThrow({ where: { id }, select: PROFILE_SELECT });
    }

    async updateProfile (id: number, dto: UpdateProfileDto) {
        let data: { firstName?: string, lastName?: string } = {}

        if (dto.firstName) data.firstName = dto.firstName;
        if (dto.lastName) data.lastName = dto.lastName;

        return this.prisma.user.update({ where: { id }, data, select: PROFILE_SELECT });
    } 

    async changePassword(id: number, dto: ChangePasswordDto) {
        if (dto.newPassword !== dto.confirmPassword)
            throw new BadRequestException('The passwords do not match.');

        const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
        if (!(await bcrypt.compare(dto.currentPassword, user.password)))
            throw new BadRequestException('The current password is not correct');
        if (dto.newPassword === dto.currentPassword)
            throw new BadRequestException('The new password must be different from the old one');

        await this.prisma.user.update({
            where: { id },
            data: { password: await bcrypt.hash(dto.newPassword, 10) },
        });
        return { ok: true };
    }

    async getBookings(userId: number, when: 'upcoming' | 'past' | 'all') {
        if (!['upcoming', 'past', 'all'].includes(when)) {
            throw new BadRequestException('Invalid when parameter. Allowed values: upcoming, past, all');
        }

        const now = new Date();

        const where =
            when === 'upcoming'
                ? { studentId: userId, endAt: { gt: now }, status: { not: 'CANCELLED' as const }}
            : when === 'past'
                ? {studentId: userId, OR: 
                    [
                        { endAt: { lte: now } },
                        { status: 'CANCELLED' as const },
                    ],
                }
            : { studentId: userId };

        return this.prisma.booking.findMany({
            where,
            orderBy: {
                startAt: when === 'upcoming' ? 'asc' : 'desc',
            },
        });
    }

    async deleteAccont(id: number, password: string) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: {id} });

        if (user.role === "PROFESSOR") throw new ForbiddenException("The professor account cannot be deleted here.");
        if (!(await bcrypt.compare(password, user.password)))
            throw new BadRequestException('The password is incorrect.');

        // The incoming bookings are automatically cancelled since the account has been deleted
        await this.prisma.$transaction([ // if one operation fails, rollback happens (omogucava atomicne operacije)
            this.prisma.booking.updateMany({
                where: { studentId: id, status: {not: 'CANCELLED'}, startAt: { gt: new Date() } },
                data: { status: 'CANCELLED' }
            }),
            this.prisma.user.delete({ where: {id} })
        ]);
        return { ok: true };
    }

    setPushToken(id: number, token: string | null) {
        return this.prisma.user.update({
            where: { id },
            data: { pushToken: token },
            select: { id: true }
        })
    }
}