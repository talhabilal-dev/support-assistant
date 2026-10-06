import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pinoHttp } from "pino-http";
import { logger } from "../lib/logger.js";
import { getRequestId, runWithRequestContext } from "../lib/request-context.js";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Accepts a caller-supplied request id (so a proxy or the client can correlate
 * a request through the whole hop chain), otherwise mints one, echoes it back,
 * and makes it available to everything downstream via AsyncLocalStorage.
 */
export const requestContext = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	const header = req.headers[REQUEST_ID_HEADER];
	const requestId =
		(Array.isArray(header) ? header[0] : header) ?? randomUUID();

	res.setHeader(REQUEST_ID_HEADER, requestId);
	runWithRequestContext({ requestId }, next);
};

export const requestLogger = pinoHttp({
	logger,
	genReqId: () => getRequestId() ?? randomUUID(),
});
