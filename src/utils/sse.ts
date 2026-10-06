import type { Response } from "express";

const SSE_HEARTBEAT_MS = 15_000;

export const initSse = (res: Response): void => {
	res.status(200);
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache, no-transform");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no");
	res.flushHeaders();

	// Keep the connection alive through intermediaries during idle gaps.
	const heartbeat = setInterval(() => {
		if (!res.writableEnded && !res.destroyed) {
			res.write(": heartbeat\n\n");
		}
	}, SSE_HEARTBEAT_MS);

	heartbeat.unref();

	res.on("close", () => clearInterval(heartbeat));
	res.on("finish", () => clearInterval(heartbeat));
};

export const sseSend = (res: Response, event: string, data: unknown): void => {
	if (res.writableEnded || res.destroyed) {
		return;
	}

	res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};
