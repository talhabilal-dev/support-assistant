DROP INDEX "message_conversationId_idx";--> statement-breakpoint
DROP INDEX "ticket_userId_idx";--> statement-breakpoint
DROP INDEX "ticket_conversationId_idx";--> statement-breakpoint
DROP INDEX "document_chunk_documentId_idx";--> statement-breakpoint
CREATE INDEX "message_conversationId_createdAt_idx" ON "message" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_userId_createdAt_idx" ON "ticket" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_conversationId_createdAt_idx" ON "ticket" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "document_userId_idx" ON "document" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunk_documentId_chunkIndex_idx" ON "document_chunk" ("document_id","chunk_index");