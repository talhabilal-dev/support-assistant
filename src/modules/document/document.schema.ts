import { z } from "zod";
import { paginationSchema } from "../../utils/pagination.js";

export const searchDocumentsSchema = z.object({
	query: z.string().min(1),
	limit: z.coerce.number().int().min(1).max(50).default(10),
	minScore: z.coerce.number().min(0).max(1).default(0),
});

export const documentParamsSchema = z.object({
	documentId: z.uuid(),
});

export const listDocumentsQuerySchema = paginationSchema;

export type SearchDocumentsInput = z.infer<typeof searchDocumentsSchema>;
