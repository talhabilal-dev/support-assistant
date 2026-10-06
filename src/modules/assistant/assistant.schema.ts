import { z } from "zod";
import { paginationSchema } from "../../utils/pagination.js";

export const chatRequestSchema = z
	.object({
		storeSlug: z.string().min(1),
		conversationId: z.uuid().optional(),
		visitorToken: z.string().min(1).optional(),
		message: z.string().min(1).max(4000),
	})
	.refine((value) => !value.conversationId || Boolean(value.visitorToken), {
		message: "visitorToken is required when conversationId is provided",
		path: ["visitorToken"],
	});

export const createTicketSchema = z.object({
	conversationId: z.uuid(),
	visitorToken: z.string().min(1),
	email: z.email(),
});

export const ticketParamsSchema = z.object({
	ticketId: z.uuid(),
});

export const conversationParamsSchema = z.object({
	conversationId: z.uuid(),
});

export const conversationQuerySchema = paginationSchema.extend({
	visitorToken: z.string().min(1),
});

export const listTicketsQuerySchema = paginationSchema;

export const createTicketReplySchema = z.object({
	body: z.string().min(1).max(5000),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type CreateTicketReplyInput = z.infer<typeof createTicketReplySchema>;
