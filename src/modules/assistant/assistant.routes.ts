import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import {
	chatRateLimiter,
	publicReadRateLimiter,
	ticketRateLimiter,
	ticketReplyRateLimiter,
} from "../../middlewares/rate-limit.js";
import {
	chatHandler,
	createTicketHandler,
	createTicketReplyHandler,
	getDemoStoreHandler,
	getStoreHandler,
	getTicketHandler,
	listMessagesHandler,
	listTicketsHandler,
} from "./assistant.controller.js";

export const assistantRouter = Router();

// Public: powers the marketing site's chat widget (slug is not a secret).
assistantRouter.get("/demo-store", publicReadRateLimiter, getDemoStoreHandler);

assistantRouter.get("/store", requireAuth, getStoreHandler);

assistantRouter.post("/chat", chatRateLimiter, chatHandler);
assistantRouter.post("/tickets", ticketRateLimiter, createTicketHandler);

assistantRouter.get(
	"/conversations/:conversationId/messages",
	chatRateLimiter,
	listMessagesHandler,
);

assistantRouter.get("/tickets", requireAuth, listTicketsHandler);
assistantRouter.get("/tickets/:ticketId", requireAuth, getTicketHandler);
assistantRouter.post(
	"/tickets/:ticketId/replies",
	requireAuth,
	ticketReplyRateLimiter,
	createTicketReplyHandler,
);
