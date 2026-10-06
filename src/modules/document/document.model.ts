import { sql } from "drizzle-orm";
import {
	customType,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "../../config/embedding.js";
import { user } from "../auth/auth.model.js";

const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector";
	},
});

const bytea = customType<{ data: Buffer }>({
	dataType() {
		return "bytea";
	},
});

export const documentStatusEnum = pgEnum("document_status", [
	"pending",
	"processing",
	"ready",
	"failed",
]);

export const document = pgTable(
	"document",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		mimeType: text("mime_type").notNull(),
		size: integer("size").notNull(),
		status: documentStatusEnum("status").notNull().default("pending"),
		chunkCount: integer("chunk_count"),
		errorMessage: text("error_message"),
		// Raw upload, held until the background ingest job has embedded it.
		content: bytea("content"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("document_userId_idx").on(table.userId)],
);

export const documentChunk = pgTable(
	"document_chunk",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		documentId: uuid("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		chunkIndex: integer("chunk_index").notNull(),
		content: text("content").notNull(),
		contentTsv: tsvector("content_tsv").generatedAlwaysAs(
			sql`to_tsvector('english', "content")`,
		),
		embedding: vector("embedding", {
			dimensions: EMBEDDING_DIMENSIONS,
		}).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		// Unique so an overlapping retry cannot double-insert a document's chunks.
		uniqueIndex("document_chunk_documentId_chunkIndex_idx").on(
			table.documentId,
			table.chunkIndex,
		),
		index("document_chunk_content_tsv_idx").using("gin", table.contentTsv),
		index("document_chunk_embedding_idx").using(
			"hnsw",
			table.embedding.op("vector_cosine_ops"),
		),
	],
);
