import { z } from "zod";
import { EMBEDDING_DIMENSIONS } from "./embedding.js";

try {
	process.loadEnvFile();
} catch {
	// .env is optional here; rely on already-set environment variables.
}

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PORT: z.coerce.number().int().positive().default(3000),
	TRUST_PROXY: z.coerce.number().int().min(0).default(0),
	LOG_LEVEL: z
		.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
		.default("info"),
	RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
	RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
	OTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
	OTP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
	USERNAME_CHECK_RATE_LIMIT_WINDOW_MS: z.coerce
		.number()
		.int()
		.positive()
		.default(60_000),
	USERNAME_CHECK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
	DOCUMENT_RATE_LIMIT_WINDOW_MS: z.coerce
		.number()
		.int()
		.positive()
		.default(900_000),
	DOCUMENT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
	CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
	CHAT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
	TICKET_RATE_LIMIT_WINDOW_MS: z.coerce
		.number()
		.int()
		.positive()
		.default(900_000),
	TICKET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
	TICKET_REPLY_RATE_LIMIT_WINDOW_MS: z.coerce
		.number()
		.int()
		.positive()
		.default(900_000),
	TICKET_REPLY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(50),
	RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(5),
	RETRIEVAL_CANDIDATES: z.coerce.number().int().positive().default(12),
	CRAG_MAX_REWRITES: z.coerce.number().int().min(0).default(0),
	CHAT_HISTORY_LIMIT: z.coerce.number().int().positive().default(10),
	ASSISTANT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2000),
	LANGSMITH_TRACING: z
		.enum(["true", "false"])
		.default("false")
		.transform((value) => value === "true"),
	LANGSMITH_API_KEY: z.string().default(""),
	LANGSMITH_PROJECT: z.string().min(1).default("support-assistant"),
	DATABASE_SSL: z
		.enum(["true", "false"])
		.default("true")
		.transform((value) => value === "true"),
	DATABASE_URL: z.string().min(1, { message: "DATABASE_URL is required" }),
	BETTER_AUTH_URL: z.url({ message: "BETTER_AUTH_URL must be a valid URL" }),
	BETTER_AUTH_SECRET: z
		.string()
		.min(1, { message: "BETTER_AUTH_SECRET is required" }),
	CHAT_TOKEN_SECRET: z
		.string()
		.min(1, { message: "CHAT_TOKEN_SECRET is required" }),
	OPENAI_API_KEY: z.string().min(1, { message: "OPENAI_API_KEY is required" }),
	CHAT_MODEL: z.string().min(1).default("gpt-4o-mini"),
	PIPELINE_MODEL: z.string().min(1).default("gpt-4o-mini"),
	OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
	OPENAI_EMBEDDING_DIMENSIONS: z.coerce
		.number()
		.int()
		.positive()
		.default(EMBEDDING_DIMENSIONS),
	RESEND_API_KEY: z.string().min(1, { message: "RESEND_API_KEY is required" }),
	EMAIL_FROM: z
		.string()
		.min(1)
		.default("Support Assistant <onboarding@resend.dev>"),
	CORS_ORIGIN: z
		.string()
		.default("")
		.transform((value) =>
			value
				.split(",")
				.map((origin) => origin.trim())
				.filter((origin) => origin.length > 0),
		),
});

export const env = envSchema.parse(process.env);

// LangChain reads these straight from process.env when it records a run.
if (env.LANGSMITH_TRACING && env.LANGSMITH_API_KEY.length > 0) {
	process.env.LANGSMITH_TRACING = "true";
	process.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
	process.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
} else {
	if (env.LANGSMITH_TRACING) {
		console.warn(
			"LANGSMITH_TRACING is enabled but LANGSMITH_API_KEY is empty; tracing is off.",
		);
	}

	delete process.env.LANGSMITH_TRACING;
}

export const isProduction = env.NODE_ENV === "production";
