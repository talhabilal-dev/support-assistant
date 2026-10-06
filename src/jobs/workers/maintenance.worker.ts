import { logger } from "../../lib/logger.js";
import { boss } from "../../lib/queue.js";
import { reconcileStaleDocuments } from "../../modules/document/document.service.js";
import { MAINTENANCE_QUEUE, reportDeadLetterBacklog } from "../queues.js";
import type { MaintenanceJob } from "../types.js";

export const registerMaintenanceWorker = async (): Promise<void> => {
	await boss.work<MaintenanceJob>(
		MAINTENANCE_QUEUE,
		{ localConcurrency: 1 },
		async () => {
			try {
				const reconciled = await reconcileStaleDocuments();

				await reportDeadLetterBacklog();

				if (reconciled > 0) {
					logger.info({ reconciled }, "Reconciled stranded documents");
				}
			} catch (error) {
				logger.error({ err: error }, "Maintenance run failed");

				throw error;
			}
		},
	);
};
