import {
	ipKeyGenerator,
	type RateLimitExceededEventHandler,
	rateLimit,
} from "express-rate-limit";
import { env } from "../config/env.js";
import { sendError } from "../utils/api-response.js";

const exceededHandler =
	(label: string, message: string): RateLimitExceededEventHandler =>
	(req, res) => {
		req.log.warn({ ip: req.ip, path: req.originalUrl }, label);

		sendError(res, message, 429, "TOO_MANY_REQUESTS");
	};

export const sensitiveAuthPaths = [
	"/api/auth/sign-in",
	"/api/auth/sign-up",
	"/api/auth/email-otp",
	"/api/auth/forget-password",
	"/api/auth/reset-password",
	"/api/auth/verify-email",
	"/api/v1/auth/sign-in",
	"/api/v1/auth/sign-up",
	"/api/v1/auth/request-password-reset",
	"/api/v1/auth/reset-password",
	"/api/v1/auth/otp",
];

// Username availability is polled while typing, so it gets its own,
// more generous limit than the sensitive auth endpoints (stops enumeration
// from being free without breaking the signup form).
export const usernameCheckPaths = [
	"/api/auth/is-username-available",
	"/api/v1/auth/is-username-available",
];

export const otpSendPaths = [
	"/api/v1/auth/otp/send",
	"/api/auth/email-otp/send-verification-otp",
	"/api/auth/email-otp/request-password-reset",
	"/api/auth/email-otp/request-email-change",
	"/api/auth/forget-password/email-otp",
];

export const authRateLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	limit: env.RATE_LIMIT_MAX,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	handler: exceededHandler(
		"Rate limit exceeded",
		"Too many requests, please try again later.",
	),
});

export const otpRateLimiter = rateLimit({
	windowMs: env.OTP_RATE_LIMIT_WINDOW_MS,
	limit: env.OTP_RATE_LIMIT_MAX,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	handler: exceededHandler(
		"OTP rate limit exceeded",
		"Too many code requests, please try again later.",
	),
});

export const documentRateLimiter = rateLimit({
	windowMs: env.DOCUMENT_RATE_LIMIT_WINDOW_MS,
	limit: env.DOCUMENT_RATE_LIMIT_MAX,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	keyGenerator: (req) => {
		if (req.user) {
			return req.user.id;
		}

		return req.ip ? ipKeyGenerator(req.ip) : "anonymous";
	},
	handler: exceededHandler(
		"Document rate limit exceeded",
		"Too many requests, please try again later.",
	),
});

export const chatRateLimiter = rateLimit({
	windowMs: env.CHAT_RATE_LIMIT_WINDOW_MS,
	limit: env.CHAT_RATE_LIMIT_MAX,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	keyGenerator: (req) => (req.ip ? ipKeyGenerator(req.ip) : "anonymous"),
	handler: exceededHandler(
		"Chat rate limit exceeded",
		"Too many messages, please try again later.",
	),
});

export const ticketRateLimiter = rateLimit({
	windowMs: env.TICKET_RATE_LIMIT_WINDOW_MS,
	limit: env.TICKET_RATE_LIMIT_MAX,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	keyGenerator: (req) => (req.ip ? ipKeyGenerator(req.ip) : "anonymous"),
	handler: exceededHandler(
		"Ticket rate limit exceeded",
		"Too many requests, please try again later.",
	),
});

export const ticketReplyRateLimiter = rateLimit({
	windowMs: env.TICKET_REPLY_RATE_LIMIT_WINDOW_MS,
	limit: env.TICKET_REPLY_RATE_LIMIT_MAX,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	keyGenerator: (req) =>
		req.user?.id ?? (req.ip ? ipKeyGenerator(req.ip) : "anonymous"),
	handler: exceededHandler(
		"Ticket reply rate limit exceeded",
		"Too many requests, please try again later.",
	),
});

export const usernameCheckRateLimiter = rateLimit({
	windowMs: env.USERNAME_CHECK_RATE_LIMIT_WINDOW_MS,
	limit: env.USERNAME_CHECK_RATE_LIMIT_MAX,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	handler: exceededHandler(
		"Username check rate limit exceeded",
		"Too many requests, please try again later.",
	),
});

// Fixed guard (no env var) for unauthenticated reads that only touch the store
// slug — cheap, and generous enough for the marketing widget.
export const publicReadRateLimiter = rateLimit({
	windowMs: 60_000,
	limit: 60,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	keyGenerator: (req) => (req.ip ? ipKeyGenerator(req.ip) : "anonymous"),
	handler: exceededHandler(
		"Public read rate limit exceeded",
		"Too many requests, please try again later.",
	),
});
