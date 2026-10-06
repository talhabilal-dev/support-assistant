import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/api-response.js";
import { requireUser } from "../../utils/require-user.js";
import { parseOrThrow } from "../../utils/validation.js";
import {
	chatRequestSchema,
	conversationParamsSchema,
	conversationQuerySchema,
	createTicketReplySchema,
	createTicketSchema,
	listTicketsQuerySchema,
	ticketParamsSchema,
} from "./assistant.schema.js";
import {
	createTicket,
	createTicketReply,
	getDemoStore,
	getStore,
	getTicket,
	listMessages,
	listTickets,
	streamChat,
} from "./assistant.service.js";

export const getStoreHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const user = requireUser(req);

	sendSuccess(res, await getStore(user.id), "Store");
};

export const getDemoStoreHandler = async (
	_req: Request,
	res: Response,
): Promise<void> => {
	sendSuccess(res, await getDemoStore(), "Demo store");
};

export const chatHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	await streamChat(parseOrThrow(chatRequestSchema, req.body), res);
};

export const listMessagesHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const { conversationId } = parseOrThrow(conversationParamsSchema, req.params);
	const { visitorToken, limit, offset } = parseOrThrow(
		conversationQuerySchema,
		req.query,
	);

	sendSuccess(
		res,
		await listMessages(conversationId, visitorToken, { limit, offset }),
		"Messages",
	);
};

export const createTicketHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	sendSuccess(
		res,
		await createTicket(parseOrThrow(createTicketSchema, req.body)),
		"Ticket created",
		201,
	);
};

export const listTicketsHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const user = requireUser(req);
	const page = parseOrThrow(listTicketsQuerySchema, req.query);

	sendSuccess(res, await listTickets(user.id, page), "Tickets");
};

export const getTicketHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const user = requireUser(req);
	const { ticketId } = parseOrThrow(ticketParamsSchema, req.params);

	sendSuccess(res, await getTicket(user.id, ticketId), "Ticket");
};

export const createTicketReplyHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const user = requireUser(req);
	const { ticketId } = parseOrThrow(ticketParamsSchema, req.params);
	const { body } = parseOrThrow(createTicketReplySchema, req.body);

	sendSuccess(
		res,
		await createTicketReply(user.id, ticketId, { body }),
		"Reply sent",
		201,
	);
};
