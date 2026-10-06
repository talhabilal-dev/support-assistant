import type { ErrorRequestHandler } from "express";
import { isProduction } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { sendError } from "./api-response.js";

export class AppError extends Error {
	readonly statusCode: number;
	readonly code: string;
	readonly details?: unknown;

	constructor(
		message: string,
		statusCode = 500,
		code = "INTERNAL_SERVER_ERROR",
		details?: unknown,
	) {
		super(message);
		this.name = "AppError";
		this.statusCode = statusCode;
		this.code = code;
		this.details = details;
	}
}

const normalizeError = (error: unknown): Error => {
	if (error instanceof Error) {
		return error;
	}

	return new Error(typeof error === "string" ? error : "Unknown error");
};

export const globalErrorHandler: ErrorRequestHandler = (
	error,
	req,
	res,
	next,
) => {
	const normalized = normalizeError(error);
	const isAppError = normalized instanceof AppError;

	req.log.error(
		{ err: normalized, context: `${req.method} ${req.originalUrl}` },
		normalized.message,
	);

	if (res.headersSent) {
		next(normalized);
		return;
	}

	const statusCode = isAppError ? normalized.statusCode : 500;
	const code = isAppError ? normalized.code : "INTERNAL_SERVER_ERROR";
	const message =
		isAppError || !isProduction ? normalized.message : "Internal server error";
	const details = isAppError ? normalized.details : undefined;

	sendError(res, message, statusCode, code, details);
};

const handleFatalError = (context: string, error: unknown): never => {
	const normalized = normalizeError(error);

	logger.fatal({ err: normalized, context }, normalized.message);

	process.exit(1);
};

export const registerProcessErrorHandlers = (): void => {
	process.on("uncaughtException", (error) => {
		handleFatalError("uncaughtException", error);
	});

	process.on("unhandledRejection", (reason) => {
		handleFatalError("unhandledRejection", reason);
	});
};

const SHUTDOWN_TIMEOUT_MS = 30_000;

export const registerShutdownHandlers = (
	onShutdown: () => Promise<unknown>,
): void => {
	let shuttingDown = false;

	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (shuttingDown) {
			return;
		}

		shuttingDown = true;
		logger.info({ signal }, "Shutting down");

		const forceExit = setTimeout(() => {
			logger.error({ signal }, "Shutdown timed out, forcing exit");
			process.exit(1);
		}, SHUTDOWN_TIMEOUT_MS);

		try {
			await onShutdown();
		} catch (error) {
			logger.error({ err: error }, "Shutdown failed");
		} finally {
			clearTimeout(forceExit);
		}

		process.exit(0);
	};

	process.on("SIGTERM", () => {
		void shutdown("SIGTERM");
	});

	process.on("SIGINT", () => {
		void shutdown("SIGINT");
	});
};
