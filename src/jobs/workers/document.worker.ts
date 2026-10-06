import { logger } from "../../lib/logger.js";
import { boss } from "../../lib/queue.js";
import { processDocumentIngest } from "../../modules/document/document.service.js";
import { DOCUMENT_QUEUE } from "../queues.js";
import type { DocumentIngestJob } from "../types.js";

export const registerDocumentWorker = async (): Promise<void> => {
	await boss.work<DocumentIngestJob>(
		DOCUMENT_QUEUE,
		{ localConcurrency: 2 },
		async ([job]) => {
			try {
				await processDocumentIngest(job.data.documentId);
				logger.info(
					{ jobId: job.id, documentId: job.data.documentId },
					"Document ingested",
				);
			} catch (error) {
				logger.error(
					{
						err: error,
						jobId: job.id,
						documentId: job.data.documentId,
						requestId: job.data.requestId,
						retryCount: job.retryCount,
					},
					"Failed to ingest document",
				);

				throw error;
			}
		},
	);
};
