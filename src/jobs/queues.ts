import type { Queue } from "pg-boss";
import { logger } from "../lib/logger.js";
import { boss } from "../lib/queue.js";

export const EMAIL_QUEUE = "email";
const EMAIL_DEAD_LETTER_QUEUE = "email-dead-letter";

export const DOCUMENT_QUEUE = "document";
const DOCUMENT_DEAD_LETTER_QUEUE = "document-dead-letter";

// Periodic housekeeping: stranded documents and dead-letter backlog.
export const MAINTENANCE_QUEUE = "maintenance";
const MAINTENANCE_CRON = "*/5 * * * *";

const DEAD_LETTER_RETENTION_SECONDS = 60 * 60 * 24 * 14;

const queues: Queue[] = [
	{
		name: EMAIL_DEAD_LETTER_QUEUE,
		retentionSeconds: DEAD_LETTER_RETENTION_SECONDS,
	},
	{
		name: EMAIL_QUEUE,
		retryLimit: 5,
		retryDelay: 30,
		retryBackoff: true,
		expireInSeconds: 300,
		deadLetter: EMAIL_DEAD_LETTER_QUEUE,
	},
	{
		name: DOCUMENT_DEAD_LETTER_QUEUE,
		retentionSeconds: DEAD_LETTER_RETENTION_SECONDS,
	},
	{
		name: DOCUMENT_QUEUE,
		retryLimit: 3,
		retryDelay: 30,
		retryBackoff: true,
		expireInSeconds: 600,
		deadLetter: DOCUMENT_DEAD_LETTER_QUEUE,
	},
	{
		name: MAINTENANCE_QUEUE,
		retryLimit: 1,
		expireInSeconds: 60,
	},
];

const DEAD_LETTER_QUEUES = [
	EMAIL_DEAD_LETTER_QUEUE,
	DOCUMENT_DEAD_LETTER_QUEUE,
];

export const ensureQueues = async (): Promise<void> => {
	for (const { name, ...options } of queues) {
		if (await boss.getQueue(name)) {
			await boss.updateQueue(name, options);
		} else {
			await boss.createQueue(name, options);
		}
	}

	// Idempotent: re-registering the same schedule just updates it.
	await boss.schedule(MAINTENANCE_QUEUE, MAINTENANCE_CRON, {
		kind: "maintenance",
	});
};

/** Anything sitting in a dead-letter queue is a failure nobody was told about. */
export const reportDeadLetterBacklog = async (): Promise<void> => {
	for (const name of DEAD_LETTER_QUEUES) {
		const queue = await boss.getQueue(name);
		const backlog = queue?.queuedCount ?? 0;

		if (backlog > 0) {
			logger.error(
				{ queue: name, backlog },
				"Dead-letter queue has unprocessed jobs",
			);
		}
	}
};
