import app from "./app.js";
import { env } from "./config/env.js";
import { registerWorkers } from "./jobs/index.js";
import { ensureQueues } from "./jobs/queues.js";
import { logger } from "./lib/logger.js";
import { startQueue, stopQueue } from "./lib/queue.js";
import {
	registerProcessErrorHandlers,
	registerShutdownHandlers,
} from "./utils/error-handler.js";

registerProcessErrorHandlers();

await startQueue();
await ensureQueues();
await registerWorkers();

const server = app.listen(env.PORT, () => {
	logger.info({ port: env.PORT }, "Server listening");
});

const FORCE_CLOSE_TIMEOUT_MS = 5_000;

registerShutdownHandlers(async () => {
	await new Promise<void>((resolve) => {
		// Long-lived SSE connections never end on their own, so give in-flight
		// requests a short grace period and then drop the remaining sockets.
		const forceClose = setTimeout(() => {
			server.closeAllConnections();
		}, FORCE_CLOSE_TIMEOUT_MS);

		server.close(() => {
			clearTimeout(forceClose);
			resolve();
		});

		server.closeIdleConnections();
	});

	await stopQueue();
});
