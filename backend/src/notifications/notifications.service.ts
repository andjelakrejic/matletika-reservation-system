import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";


const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
type PushTicket = {
    status: string;
    message?: string;
    details?: { error?: string};
};

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(private prisma: PrismaService) {}

    async send(
        user: { id: number, pushToken: string | null },
        title: string,
        body: string,
        data: Record<string, unknown> = {},
    ) {
        if (!user.pushToken) return;

        try{
            const res = await fetch(EXPO_PUSH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify([{ to: user.pushToken, title, body, sound: 'default', data }]),
            });
            const json = (await res.json()) as { data?: PushTicket[] };
            const ticket = json.data?.[0];
            
            if (ticket?.status === 'error') {
                this.logger.warn(`Push failed for user ${user.id}: ${ticket.message}`);
                // The app was uninstalled or the token expired, so stop using it
                if (ticket.details?.error === 'DeviceNotRegistered')
                    await this.prisma.user.update({ where: { id: user.id }, data: { pushToken: null } });
            }
        } catch (err) {
            this.logger.warn(`Push request failed for user ${user.id}: ${(err as Error).message}`);
        }
    }
}