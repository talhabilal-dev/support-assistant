import type { AIMessageChunk } from "@langchain/core/messages";
import {
	AIMessage,
	HumanMessage,
	SystemMessage,
} from "@langchain/core/messages";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { Response } from "express";
import { env } from "../../config/env.js";
import { EMAIL_QUEUE } from "../../jobs/queues.js";
import type {
	TicketCreatedEmailJob,
	TicketReplyEmailJob,
} from "../../jobs/types.js";
import { createChatModel } from "../../lib/chat.js";
import {
	createVisitorToken,
	verifyVisitorToken,
} from "../../lib/conversation-token.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { sendJob } from "../../lib/queue.js";
import { AppError } from "../../utils/error-handler.js";
import type { PaginationInput } from "../../utils/pagination.js";
import { initSse, sseSend } from "../../utils/sse.js";
import { user } from "../auth/auth.model.js";
import { runRetrievalGraph } from "./assistant.graph.js";
import {
	conversation,
	message,
	ticket,
	ticketReply,
} from "./assistant.model.js";
import { formatContext, type RetrievedChunk } from "./assistant.retrieval.js";
import type {
	ChatRequestInput,
	CreateTicketInput,
	CreateTicketReplyInput,
} from "./assistant.schema.js";

type Citation = {
	index: number;
	chunkId: string;
	documentId: string;
	documentName: string;
};

type ChatTurn = { role: "user" | "assistant"; content: string };

const ESCALATION_MESSAGE =
	"I couldn't find an answer to that in the knowledge base. If you leave your email address, I'll pass your question to the team and they'll get back to you.";

// Cheap, deterministic guard so greetings/meta questions don't open tickets.
const SMALL_TALK_MAX_LENGTH = 60;
const GREETING_PATTERN =
	/^(hi|hey|hello|yo|howdy|good (morning|afternoon|evening))[!.,\s]*$/i;
const THANKS_PATTERN = /^(thanks|thank you|ty|cheers|appreciate it)[!.,\s]*$/i;
const META_PATTERN =
	/^(what can you (do|help( me)?( with)?)|who are you|what are you|how (do|does) (you|this|it) work|what is this|how do i (get )?start(ed)?|what can i ask( you)?)[?!.,\s]*$/i;

const smallTalkReply = (raw: string): string | null => {
	const text = raw.trim();

	if (text.length === 0 || text.length > SMALL_TALK_MAX_LENGTH) {
		return null;
	}

	if (THANKS_PATTERN.test(text)) {
		return "You're welcome! Ask me anything else about the documents.";
	}

	if (GREETING_PATTERN.test(text) || META_PATTERN.test(text)) {
		return "Hi! I answer questions about this store's documents, with citations. Ask me something specific and I'll look it up — or I can pass it to a human if it isn't covered.";
	}

	return null;
};

const generationSystemPrompt = (chunks: RetrievedChunk[]): string =>
	`You are a helpful support assistant. Answer the user's question using ONLY the context below. Cite the sources you use inline as [1], [2], etc. matching the numbered context entries (for example: "...as described in [2]."). If the answer is not in the context, say you don't know.\n\nContext:\n${formatContext(chunks)}`;

const chunkText = (chunk: AIMessageChunk): string => {
	const { content } = chunk;

	if (typeof content === "string") {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.map((part) =>
				typeof part === "string"
					? part
					: "text" in part && typeof part.text === "string"
						? part.text
						: "",
			)
			.join("");
	}

	return "";
};

const resolveConversation = async (
	userId: string,
	conversationId: string | undefined,
	visitorToken: string | undefined,
): Promise<string> => {
	if (conversationId) {
		if (!visitorToken || !verifyVisitorToken(conversationId, visitorToken)) {
			throw new AppError("Invalid visitor token", 403, "INVALID_VISITOR_TOKEN");
		}

		const existing = await db
			.select({ id: conversation.id })
			.from(conversation)
			.where(
				and(
					eq(conversation.id, conversationId),
					eq(conversation.userId, userId),
				),
			)
			.limit(1);

		if (!existing[0]) {
			throw new AppError(
				"Conversation not found",
				404,
				"CONVERSATION_NOT_FOUND",
			);
		}

		return existing[0].id;
	}

	const [created] = await db
		.insert(conversation)
		.values({ userId })
		.returning({ id: conversation.id });

	return created.id;
};

const touchConversation = async (conversationId: string): Promise<void> => {
	await db
		.update(conversation)
		.set({ updatedAt: new Date() })
		.where(eq(conversation.id, conversationId));
};

const loadHistory = async (conversationId: string): Promise<ChatTurn[]> => {
	const rows = await db
		.select({ role: message.role, content: message.content })
		.from(message)
		.where(eq(message.conversationId, conversationId))
		.orderBy(desc(message.createdAt), desc(message.id))
		.limit(env.CHAT_HISTORY_LIMIT);

	return rows.reverse();
};

const buildGenerationMessages = (
	chunks: RetrievedChunk[],
	history: ChatTurn[],
) => [
	new SystemMessage(generationSystemPrompt(chunks)),
	...history.map((entry) =>
		entry.role === "user"
			? new HumanMessage(entry.content)
			: new AIMessage(entry.content),
	),
];

const extractCitations = (
	answer: string,
	chunks: RetrievedChunk[],
): Citation[] => {
	const seen = new Set<number>();
	const citations: Citation[] = [];

	for (const match of answer.matchAll(/\[(\d+)\]/g)) {
		const index = Number(match[1]);

		if (seen.has(index)) {
			continue;
		}

		const chunk = chunks[index - 1];

		if (!chunk) {
			continue;
		}

		seen.add(index);
		citations.push({
			index,
			chunkId: chunk.chunkId,
			documentId: chunk.documentId,
			documentName: chunk.documentName,
		});
	}

	return citations;
};

export const streamChat = async (
	input: ChatRequestInput,
	res: Response,
): Promise<void> => {
	const [owner] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.storeSlug, input.storeSlug))
		.limit(1);

	if (!owner) {
		throw new AppError("Store not found", 404, "STORE_NOT_FOUND");
	}

	const conversationId = await resolveConversation(
		owner.id,
		input.conversationId,
		input.visitorToken,
	);

	const visitorToken = createVisitorToken(conversationId);

	const [userMessage] = await db
		.insert(message)
		.values({ conversationId, role: "user", content: input.message })
		.returning({ id: message.id });

	await touchConversation(conversationId);

	// Greetings/meta questions get a conversational reply, not a retrieval miss.
	const canned = smallTalkReply(input.message);

	if (canned) {
		await db.insert(message).values({
			conversationId,
			role: "assistant",
			content: canned,
		});
		await touchConversation(conversationId);
		initSse(res);
		sseSend(res, "token", { text: canned });
		sseSend(res, "done", {
			conversationId,
			visitorToken,
			citations: [],
			escalated: false,
		});
		res.end();
		return;
	}

	const rollbackUserMessage = async (): Promise<void> => {
		try {
			await db.delete(message).where(eq(message.id, userMessage.id));
		} catch (error) {
			logger.error(
				{ err: error, messageId: userMessage.id },
				"Failed to roll back chat message",
			);
		}
	};

	// Resolve retrieval + history before responding; on failure drop the
	// just-persisted user turn so no unanswered message is left behind.
	const { history, retrieval } = await (async () => {
		try {
			return {
				history: await loadHistory(conversationId),
				retrieval: await runRetrievalGraph(owner.id, input.message, {
					storeSlug: input.storeSlug,
				}),
			};
		} catch (error) {
			await rollbackUserMessage();
			throw error;
		}
	})();

	initSse(res);

	const controller = new AbortController();
	res.on("close", () => {
		controller.abort();
	});

	if (!retrieval.sufficient) {
		sseSend(res, "token", { text: ESCALATION_MESSAGE });
		await db.insert(message).values({
			conversationId,
			role: "assistant",
			content: ESCALATION_MESSAGE,
		});
		await touchConversation(conversationId);
		sseSend(res, "done", {
			conversationId,
			visitorToken,
			citations: [],
			escalated: true,
		});
		res.end();
		return;
	}

	try {
		const model = createChatModel({
			temperature: 0.2,
			maxOutputTokens: env.ASSISTANT_MAX_OUTPUT_TOKENS,
		});

		const stream = await model.stream(
			buildGenerationMessages(retrieval.chunks, history),
			{
				signal: controller.signal,
				runName: "assistant-generation",
				tags: ["assistant", "generation"],
				metadata: { conversationId, storeSlug: input.storeSlug },
			},
		);

		let answer = "";

		for await (const chunk of stream) {
			if (controller.signal.aborted) {
				break;
			}

			const text = chunkText(chunk);

			if (!text) {
				continue;
			}

			answer += text;
			sseSend(res, "token", { text });
		}

		if (controller.signal.aborted) {
			return;
		}

		const citations = extractCitations(answer, retrieval.chunks);

		await db.insert(message).values({
			conversationId,
			role: "assistant",
			content: answer,
			citations,
		});

		await touchConversation(conversationId);

		sseSend(res, "done", {
			conversationId,
			visitorToken,
			citations,
			escalated: false,
		});
	} catch (error) {
		if (controller.signal.aborted) {
			logger.info("Chat stream aborted by client");
		} else {
			logger.error({ err: error }, "Chat generation failed");
			await rollbackUserMessage();
			sseSend(res, "error", {
				message: "Failed to generate a response",
				code: "GENERATION_FAILED",
			});
		}
	} finally {
		res.end();
	}
};

export const listMessages = async (
	conversationId: string,
	visitorToken: string,
	{ limit, offset }: PaginationInput,
) => {
	if (!verifyVisitorToken(conversationId, visitorToken)) {
		throw new AppError("Invalid visitor token", 403, "INVALID_VISITOR_TOKEN");
	}

	const [conversationRow] = await db
		.select({ id: conversation.id })
		.from(conversation)
		.where(eq(conversation.id, conversationId))
		.limit(1);

	if (!conversationRow) {
		throw new AppError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
	}

	// Newest first so a page limit returns the latest turns, then flipped back
	// into chronological order for display.
	const messages = await db
		.select({
			id: message.id,
			role: message.role,
			content: message.content,
			citations: message.citations,
			createdAt: message.createdAt,
		})
		.from(message)
		.where(eq(message.conversationId, conversationId))
		.orderBy(desc(message.createdAt), desc(message.id))
		.limit(limit)
		.offset(offset);

	return { conversationId, messages: messages.reverse() };
};

export const getStore = async (userId: string) => {
	const [row] = await db
		.select({ storeSlug: user.storeSlug })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (!row) {
		throw new AppError("Store not found", 404, "STORE_NOT_FOUND");
	}

	return row;
};

/**
 * Public demo store for the marketing site's chat widget. Store slugs are
 * public identifiers, so this exposes no secret — it just picks the earliest
 * store (single-tenant assumption for the demo).
 */
export const getDemoStore = async () => {
	const [row] = await db
		.select({ storeSlug: user.storeSlug })
		.from(user)
		.orderBy(asc(user.createdAt))
		.limit(1);

	if (!row) {
		throw new AppError("No store available", 404, "STORE_NOT_FOUND");
	}

	return row;
};

const enqueueTicketCreatedEmail = async (params: {
	ticketId: string;
	ownerId: string;
	question: string;
	visitorEmail: string;
}): Promise<void> => {
	const [owner] = await db
		.select({ email: user.email })
		.from(user)
		.where(eq(user.id, params.ownerId))
		.limit(1);

	if (!owner) {
		logger.error(
			{ ticketId: params.ticketId },
			"Ticket owner not found; notification not queued",
		);

		return;
	}

	const job: TicketCreatedEmailJob = {
		kind: "ticket-created",
		email: owner.email,
		visitorEmail: params.visitorEmail,
		question: params.question,
		ticketId: params.ticketId,
	};

	try {
		await sendJob(EMAIL_QUEUE, job);
	} catch (error) {
		logger.error(
			{ err: error, ticketId: params.ticketId },
			"Failed to queue the ticket notification email",
		);
	}
};

export const createTicket = async (input: CreateTicketInput) => {
	if (!verifyVisitorToken(input.conversationId, input.visitorToken)) {
		throw new AppError("Invalid visitor token", 403, "INVALID_VISITOR_TOKEN");
	}

	const [conversationRow] = await db
		.select({ id: conversation.id, userId: conversation.userId })
		.from(conversation)
		.where(eq(conversation.id, input.conversationId))
		.limit(1);

	if (!conversationRow) {
		throw new AppError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
	}

	// Idempotent escalation: keep a single active ticket per conversation so
	// repeated requests can't spam the owner's inbox.
	const [existing] = await db
		.select({
			id: ticket.id,
			status: ticket.status,
			createdAt: ticket.createdAt,
			question: ticket.question,
			visitorEmail: ticket.visitorEmail,
		})
		.from(ticket)
		.where(
			and(
				eq(ticket.conversationId, conversationRow.id),
				ne(ticket.status, "closed"),
			),
		)
		.orderBy(desc(ticket.createdAt))
		.limit(1);

	if (existing) {
		// The ticket already exists, but its notification may have failed to
		// enqueue on an earlier attempt — send it again rather than lose it.
		await enqueueTicketCreatedEmail({
			ticketId: existing.id,
			ownerId: conversationRow.userId,
			question: existing.question,
			visitorEmail: existing.visitorEmail,
		});

		return {
			id: existing.id,
			status: existing.status,
			createdAt: existing.createdAt,
		};
	}

	const [lastQuestion] = await db
		.select({ content: message.content })
		.from(message)
		.where(
			and(
				eq(message.conversationId, conversationRow.id),
				eq(message.role, "user"),
			),
		)
		.orderBy(desc(message.createdAt))
		.limit(1);

	const question = lastQuestion?.content ?? "New question";

	const [created] = await db
		.insert(ticket)
		.values({
			userId: conversationRow.userId,
			conversationId: conversationRow.id,
			question,
			visitorEmail: input.email,
		})
		.returning({
			id: ticket.id,
			status: ticket.status,
			createdAt: ticket.createdAt,
		});

	await enqueueTicketCreatedEmail({
		ticketId: created.id,
		ownerId: conversationRow.userId,
		question,
		visitorEmail: input.email,
	});

	return created;
};

export const listTickets = async (
	userId: string,
	{ limit, offset }: PaginationInput,
) => {
	return db
		.select({
			id: ticket.id,
			question: ticket.question,
			visitorEmail: ticket.visitorEmail,
			status: ticket.status,
			createdAt: ticket.createdAt,
		})
		.from(ticket)
		.where(eq(ticket.userId, userId))
		.orderBy(desc(ticket.createdAt))
		.limit(limit)
		.offset(offset);
};

export const getTicket = async (userId: string, ticketId: string) => {
	const [ticketRow] = await db
		.select()
		.from(ticket)
		.where(and(eq(ticket.id, ticketId), eq(ticket.userId, userId)))
		.limit(1);

	if (!ticketRow) {
		throw new AppError("Ticket not found", 404, "TICKET_NOT_FOUND");
	}

	const replies = await db
		.select()
		.from(ticketReply)
		.where(eq(ticketReply.ticketId, ticketId))
		.orderBy(ticketReply.createdAt, ticketReply.id);

	return { ...ticketRow, replies };
};

export const createTicketReply = async (
	userId: string,
	ticketId: string,
	input: CreateTicketReplyInput,
) => {
	const [ticketRow] = await db
		.select()
		.from(ticket)
		.where(and(eq(ticket.id, ticketId), eq(ticket.userId, userId)))
		.limit(1);

	if (!ticketRow) {
		throw new AppError("Ticket not found", 404, "TICKET_NOT_FOUND");
	}

	// All writes commit together, so a reply can never exist without its status
	// change, its mirrored message, and the conversation touch.
	const reply = await db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(ticketReply)
			.values({ ticketId, authorRole: "owner", body: input.body })
			.returning();

		await tx
			.update(ticket)
			.set({ status: "replied" })
			.where(eq(ticket.id, ticketId));

		// Mirror the reply into the conversation so a returning visitor sees it.
		await tx.insert(message).values({
			conversationId: ticketRow.conversationId,
			role: "assistant",
			content: input.body,
		});

		await tx
			.update(conversation)
			.set({ updatedAt: new Date() })
			.where(eq(conversation.id, ticketRow.conversationId));

		return inserted;
	});

	const job: TicketReplyEmailJob = {
		kind: "ticket-reply",
		email: ticketRow.visitorEmail,
		question: ticketRow.question,
		body: input.body,
		ticketId,
	};

	// The reply is already committed, so a queue failure must not surface as an
	// error the owner would "fix" by posting the reply a second time.
	try {
		await sendJob(EMAIL_QUEUE, job);
	} catch (error) {
		logger.error(
			{ err: error, ticketId },
			"Failed to queue the ticket reply email",
		);
	}

	return reply;
};
