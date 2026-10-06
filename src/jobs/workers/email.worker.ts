import { logger } from "../../lib/logger.js";
import {
	sendOtpEmail,
	sendTicketCreatedEmail,
	sendTicketReplyEmail,
} from "../../lib/mailer.js";
import { boss } from "../../lib/queue.js";
import { EMAIL_QUEUE } from "../queues.js";
import type { EmailJob } from "../types.js";

const deliver = async (job: EmailJob): Promise<void> => {
	switch (job.kind) {
		case "otp":
			await sendOtpEmail({ email: job.email, otp: job.otp, type: job.type });
			return;
		case "ticket-created":
			await sendTicketCreatedEmail({
				email: job.email,
				visitorEmail: job.visitorEmail,
				question: job.question,
				ticketId: job.ticketId,
			});
			return;
		case "ticket-reply":
			await sendTicketReplyEmail({
				email: job.email,
				question: job.question,
				body: job.body,
				ticketId: job.ticketId,
			});
			return;
	}
};

export const registerEmailWorker = async (): Promise<void> => {
	await boss.work<EmailJob>(
		EMAIL_QUEUE,
		{ localConcurrency: 2 },
		async ([job]) => {
			try {
				await deliver(job.data);
				logger.info({ jobId: job.id, kind: job.data.kind }, "Email sent");
			} catch (error) {
				logger.error(
					{
						err: error,
						jobId: job.id,
						kind: job.data.kind,
						requestId: job.data.requestId,
						retryCount: job.retryCount,
					},
					"Failed to send email",
				);

				throw error;
			}
		},
	);
};
