import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth/auth.model.js";

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

export const ticketStatusEnum = pgEnum("ticket_status", [
	"open",
	"replied",
	"closed",
]);

export const ticketReplyRoleEnum = pgEnum("ticket_reply_role", [
	"owner",
	"visitor",
]);

export const conversation = pgTable(
	"conversation",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("conversation_userId_idx").on(table.userId)],
);

export const message = pgTable(
	"message",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		role: messageRoleEnum("role").notNull(),
		content: text("content").notNull(),
		citations: jsonb("citations"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		// Covers the conversation history read, which orders by created_at.
		index("message_conversationId_createdAt_idx").on(
			table.conversationId,
			table.createdAt,
		),
	],
);

export const ticket = pgTable(
	"ticket",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		question: text("question").notNull(),
		visitorEmail: text("visitor_email").notNull(),
		status: ticketStatusEnum("status").notNull().default("open"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		// Both list/lookup paths order by created_at.
		index("ticket_userId_createdAt_idx").on(table.userId, table.createdAt),
		index("ticket_conversationId_createdAt_idx").on(
			table.conversationId,
			table.createdAt,
		),
	],
);

export const ticketReply = pgTable(
	"ticket_reply",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ticketId: uuid("ticket_id")
			.notNull()
			.references(() => ticket.id, { onDelete: "cascade" }),
		authorRole: ticketReplyRoleEnum("author_role").notNull().default("owner"),
		body: text("body").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("ticket_reply_ticketId_idx").on(table.ticketId)],
);
