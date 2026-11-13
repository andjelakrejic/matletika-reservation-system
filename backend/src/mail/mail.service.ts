import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private readonly transporter?: Transporter;
    private readonly from: string;

    constructor(private config: ConfigService) {
        const host = config.get<string>('SMTP_HOST');
        const port = Number(config.get<string>('SMTP_PORT') ?? 587);
        this.from = config.get<string>('MAIL_FROM') ?? 'no-reply@localhost';
        if (host) {
            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === 465,
                auth: { 
                    user: config.getOrThrow('SMTP_USER'),
                    pass: config.getOrThrow('SMTP_PASS')
                }
            })
        }
    }

    async send(to: string, subject: string, text: string) {
        if(!this.transporter) {
            if(process.env.NODE_ENV !== 'production')
                this.logger.warn(`[DEV_MAIL] to=${to} subject="${subject}"\n${text}`);
            else this.logger.warn(`SMTP not configured, mail was not sent`);
            return;
        }

        try {
            await this.transporter.sendMail({ from: this.from, to, subject, text });
        } catch (err) {
            this.logger.error(`Failed to send mail: ${(err as Error).message}`);
        }
    }

}