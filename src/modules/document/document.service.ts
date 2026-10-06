import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { PDFParse } from "pdf-parse";
import { DOCUMENT_QUEUE } from "../../jobs/queues.js";
import type { DocumentIngestJob } from "../../jobs/types.js";
import { embeddings } from "../../lib/embeddings.js";
import { logger } from "../../lib/logger.js";
import { sendJob } from "../../lib/queue.js";
import { vectorDb } from "../../lib/vector-db.js";
import { searchChunksByVector } from "../../lib/vector-search.js";
import { AppError } from "../../utils/error-handler.js";
import type { PaginationInput } from "../../utils/pagination.js";
import { document, documentChunk } from "./document.model.js";
import type { SearchDocumentsInput } from "./document.schema.js";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

export const ALLOWED_MIME_TYPES = [
	"application/pdf",
	"text/plain",
	"text/markdown",
];

const splitter = new RecursiveCharacterTextSplitter({
	chunkSize: CHUNK_SIZE,
	chunkOverlap: CHUNK_OVERLAP,
});

type UploadedDocument = {
	buffer: Buffer;
	mimetype: string;
	originalname: string;
	size: number;
};

const extractText = async (
	buffer: Buffer,
	mimetype: string,
): Promise<string> => {
	if (mimetype === "application/pdf") {
		const parser = new PDFParse({ data: buffer });

		try {
			return (await parser.getText()).text;
		} finally {
			await parser.destroy();
		}
	}

	return buffer.toString("utf8");
};

/** Persist the upload and enqueue background embedding; returns immediately. */
export const queueDocumentIngest = async (
	userId: string,
	file: UploadedDocument,
) => {
	const [created] = await vectorDb
		.insert(document)
		.values({
			userId,
			name: file.originalname,
			mimeType: file.mimetype,
			size: file.size,
			status: "pending",
			content: file.buffer,
		})
		.returning({
			id: document.id,
			name: document.name,
			status: document.status,
			chunkCount: document.chunkCount,
			errorMessage: document.errorMessage,
			createdAt: document.createdAt,
		});

	const job: DocumentIngestJob = {
		kind: "document-ingest",
		documentId: created.id,
	};

	try {
		await sendJob(DOCUMENT_QUEUE, job);
	} catch (error) {
		// The job never reached the queue, so drop the row rather than leaving a
		// document stuck on "pending" — and a duplicate behind the client's retry.
		await vectorDb.delete(document).where(eq(document.id, created.id));

		throw error;
	}

	return created;
};

/** Background worker step: extract, chunk, embed, and store the vectors. */
export const processDocumentIngest = async (
	documentId: string,
): Promise<void> => {
	const [row] = await vectorDb
		.select({
			id: document.id,
			mimeType: document.mimeType,
			content: document.content,
		})
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);

	if (!row?.content) {
		throw new AppError(
			"Document not found or already ingested",
			404,
			"DOCUMENT_NOT_FOUND",
		);
	}

	await vectorDb
		.update(document)
		.set({ status: "processing" })
		.where(eq(document.id, documentId));

	try {
		const text = await extractText(row.content, row.mimeType);
		const chunks = await splitter.splitText(text);

		if (chunks.length === 0) {
			await vectorDb
				.update(document)
				.set({
					status: "failed",
					errorMessage: "No extractable text found",
					content: null,
				})
				.where(eq(document.id, documentId));

			return;
		}

		const vectors = await embeddings.embedDocuments(chunks);

		await vectorDb.transaction(async (tx) => {
			await tx
				.insert(documentChunk)
				.values(
					chunks.map((content, index) => ({
						documentId,
						chunkIndex: index,
						content,
						embedding: vectors[index],
					})),
				)
				// A retried attempt overlapping a still-running one must not
				// duplicate chunks.
				.onConflictDoNothing();

			await tx
				.update(document)
				.set({
					status: "ready",
					chunkCount: chunks.length,
					errorMessage: null,
					content: null,
				})
				.where(eq(document.id, documentId));
		});
	} catch (error) {
		await vectorDb
			.update(document)
			.set({
				status: "failed",
				errorMessage:
					error instanceof Error ? error.message : "Ingestion failed",
			})
			.where(eq(document.id, documentId));

		throw error;
	}
};

export const listDocuments = (
	userId: string,
	{ limit, offset }: PaginationInput,
) =>
	vectorDb
		.select({
			id: document.id,
			name: document.name,
			mimeType: document.mimeType,
			size: document.size,
			status: document.status,
			chunkCount: document.chunkCount,
			errorMessage: document.errorMessage,
			createdAt: document.createdAt,
		})
		.from(document)
		.where(eq(document.userId, userId))
		.orderBy(desc(document.createdAt))
		.limit(limit)
		.offset(offset);

export const searchDocuments = (
	userId: string,
	input: SearchDocumentsInput,
): Promise<
	{
		chunkId: string;
		documentId: string;
		documentName: string;
		content: string;
		similarity: number;
	}[]
> => searchChunksByVector(userId, input.query, input.limit, input.minScore);

export const deleteDocument = async (userId: string, documentId: string) => {
	const [existing] = await vectorDb
		.select({ id: document.id })
		.from(document)
		.where(and(eq(document.id, documentId), eq(document.userId, userId)))
		.limit(1);

	if (!existing) {
		throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
	}

	// Chunks (and their vectors) are removed by the cascade on document_id.
	await vectorDb.delete(document).where(eq(document.id, documentId));

	return { id: documentId };
};

// Longer than the ingest job's 600s expiry plus its retries.
const STALE_INGEST_MINUTES = 15;

/** Terminal cleanup for uploads whose ingest job was lost (crash, dead-letter). */
export const reconcileStaleDocuments = async (): Promise<number> => {
	const cutoff = new Date(Date.now() - STALE_INGEST_MINUTES * 60 * 1000);

	const stranded = await vectorDb
		.update(document)
		.set({
			status: "failed",
			errorMessage: "Processing timed out. Please upload the document again.",
			content: null,
		})
		.where(
			and(
				inArray(document.status, ["pending", "processing"]),
				lt(document.createdAt, cutoff),
			),
		)
		.returning({ id: document.id });

	if (stranded.length > 0) {
		logger.warn(
			{ documentIds: stranded.map((row) => row.id) },
			"Marked stranded documents as failed",
		);
	}

	return stranded.length;
};
