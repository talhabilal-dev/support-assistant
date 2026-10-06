CREATE TYPE "document_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "status" "document_status" DEFAULT 'pending'::"document_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "chunk_count" integer;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "content" bytea;