import { PgBoss, type SendOptions } from "pg-boss";
import { env } from "../config/env.js";
import { AppError } from "../utils/error-handler.js";
import { logger } from "./logger.js";
import { getRequestId } from "./request-context.js";

const STOP_TIMEOUT_MS = 30_000;

export const boss = new PgBoss({ connectionString: env.DATABASE_URL });

boss.on("error", (error) => {
	logger.error({ err: error }, "pg-boss error");
});

boss.on("warning", (warning) => {
	logger.warn({ warning }, "pg-boss warning");
});

export const startQueue = (): Promise<PgBoss> => boss.start();

export const stopQueue = (): Promise<void> =>
	boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });

export const sendJob = async <T extends object>(
	name: string,
	data: T,
	options?: SendOptions,
): Promise<string> => {
	const requestId = getRequestId();

	const jobId = await boss.send(
		name,
		requestId ? { ...data, requestId } : data,
		options,
	);

	if (!jobId) {
		throw new AppError(
			`Queue "${name}" did not accept the job`,
			503,
			"QUEUE_UNAVAILABLE",
		);
	}

	return jobId;
};
