import { registerDocumentWorker } from "./workers/document.worker.js";
import { registerEmailWorker } from "./workers/email.worker.js";
import { registerMaintenanceWorker } from "./workers/maintenance.worker.js";

export const registerWorkers = async (): Promise<void> => {
	await registerEmailWorker();
	await registerDocumentWorker();
	await registerMaintenanceWorker();
};
