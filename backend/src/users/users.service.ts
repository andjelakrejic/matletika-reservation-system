import { BadRequestException, Injectable } from "@nestjs/common";
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

    getBookings(userId: number, when: 'upcoming' | 'past' | 'all') {
        const now = new Date();
        const where =
            when === 'upcoming'? { 
                studentId: userId, startAt: { gte: now }, status: { not: 'CANCELLED' as const } 
            }
            : when === 'past' ? { 
                studentId: userId, OR: [{ startAt: { lt: now } }, { status: 'CANCELLED' as const }] 
            }
            : { studentId: userId };

        return this.prisma.booking.findMany({
            where,
            orderBy: { 
                startAt: when === 'upcoming' ? 'asc' : 'desc' 
            },
        });
    }
}