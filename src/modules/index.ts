import { defineRelations } from "drizzle-orm";
import {
	conversation,
	message,
	ticket,
	ticketReply,
} from "./assistant/assistant.model.js";
import { account, session, user, verification } from "./auth/auth.model.js";

export const relations = defineRelations(
	{
		user,
		session,
		account,
		verification,
		conversation,
		message,
		ticket,
		ticketReply,
	},
	(r) => ({
		user: {
			sessions: r.many.session(),
			accounts: r.many.account(),
			conversations: r.many.conversation(),
			tickets: r.many.ticket(),
		},
		session: {
			user: r.one.user({
				from: r.session.userId,
				to: r.user.id,
			}),
		},
		account: {
			user: r.one.user({
				from: r.account.userId,
				to: r.user.id,
			}),
		},
		conversation: {
			user: r.one.user({
				from: r.conversation.userId,
				to: r.user.id,
			}),
			messages: r.many.message(),
			tickets: r.many.ticket(),
		},
		message: {
			conversation: r.one.conversation({
				from: r.message.conversationId,
				to: r.conversation.id,
			}),
		},
		ticket: {
			user: r.one.user({
				from: r.ticket.userId,
				to: r.user.id,
			}),
			conversation: r.one.conversation({
				from: r.ticket.conversationId,
				to: r.conversation.id,
			}),
			replies: r.many.ticketReply(),
		},
		ticketReply: {
			ticket: r.one.ticket({
				from: r.ticketReply.ticketId,
				to: r.ticket.id,
			}),
		},
	}),
);

export * from "./assistant/assistant.model.js";
export * from "./auth/auth.model.js";
export * from "./document/document.model.js";
