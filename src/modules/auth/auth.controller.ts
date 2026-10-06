import type { Request, Response } from "express";
import { sendError, sendSuccess } from "../../utils/api-response.js";
import { toHeaders } from "../../utils/request-headers.js";
import { parseOrThrow } from "../../utils/validation.js";
import {
	changePasswordSchema,
	isUsernameAvailableSchema,
	requestPasswordResetSchema,
	resetPasswordOtpSchema,
	resetPasswordSchema,
	sendVerificationOtpSchema,
	signInEmailOtpSchema,
	signInEmailSchema,
	signInUsernameSchema,
	signUpEmailSchema,
	updateUserSchema,
	verifyEmailOtpSchema,
} from "./auth.schema.js";
import * as service from "./auth.service.js";

// Framing/hop-by-hop headers describe better-auth's original body, which we
// replace with our own envelope, so they must not be forwarded as-is.
const SKIPPED_RESPONSE_HEADERS = new Set([
	"set-cookie",
	"content-length",
	"content-encoding",
	"transfer-encoding",
	"connection",
]);

const forwardHeaders = (res: Response, headers: Headers): void => {
	for (const [key, value] of headers.entries()) {
		if (!SKIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
			res.setHeader(key, value);
		}
	}

	const cookies = headers.getSetCookie();

	if (cookies.length > 0) {
		res.setHeader("set-cookie", cookies);
	}
};

const respond = (
	res: Response,
	result: service.ApiResult,
	message: string,
): void => {
	forwardHeaders(res, result.headers);

	if (result.status >= 200 && result.status < 300) {
		sendSuccess(res, result.body, message, result.status);
		return;
	}

	const body = result.body as { message?: string; code?: string } | null;

	sendError(
		res,
		body?.message ?? "Request failed",
		result.status,
		body?.code ?? "REQUEST_FAILED",
	);
};

export const signUp = async (req: Request, res: Response): Promise<void> => {
	const body = parseOrThrow(signUpEmailSchema, req.body);

	respond(res, await service.signUp(body, toHeaders(req)), "Account created");
};

export const signIn = async (req: Request, res: Response): Promise<void> => {
	const body = parseOrThrow(signInEmailSchema, req.body);

	respond(res, await service.signIn(body, toHeaders(req)), "Signed in");
};

export const signInEmailOtp = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const body = parseOrThrow(signInEmailOtpSchema, req.body);

	respond(res, await service.signInEmailOtp(body, toHeaders(req)), "Signed in");
};

export const signInUsername = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const body = parseOrThrow(signInUsernameSchema, req.body);

	respond(res, await service.signInUsername(body, toHeaders(req)), "Signed in");
};

export const requestPasswordReset = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const body = parseOrThrow(requestPasswordResetSchema, req.body);

	respond(
		res,
		await service.requestPasswordReset(body, toHeaders(req)),
		"Password reset requested",
	);
};

export const resetPassword = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const body = parseOrThrow(resetPasswordSchema, req.body);

	respond(
		res,
		await service.resetPassword(body, toHeaders(req)),
		"Password reset",
	);
};

export const resetPasswordOtp = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const body = parseOrThrow(resetPasswordOtpSchema, req.body);

	respond(
		res,
		await service.resetPasswordEmailOtp(body, toHeaders(req)),
		"Password reset",
	);
};

export const sendOtp = async (req: Request, res: Response): Promise<void> => {
	const body = parseOrThrow(sendVerificationOtpSchema, req.body);

	respond(
		res,
		await service.sendVerificationOtp(body, toHeaders(req)),
		"Code sent",
	);
};

export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
	const body = parseOrThrow(verifyEmailOtpSchema, req.body);

	respond(
		res,
		await service.verifyEmailOtp(body, toHeaders(req)),
		"Email verified",
	);
};

export const isUsernameAvailable = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const body = parseOrThrow(isUsernameAvailableSchema, req.body);

	respond(
		res,
		await service.isUsernameAvailable(body, toHeaders(req)),
		"Username availability",
	);
};

export const session = async (req: Request, res: Response): Promise<void> => {
	const result = await service.getSession(toHeaders(req));

	sendSuccess(res, result ?? null, "Session");
};

export const updateUser = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const body = parseOrThrow(updateUserSchema, req.body);

	respond(
		res,
		await service.updateUser(body, toHeaders(req)),
		"Profile updated",
	);
};

export const changePassword = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const body = parseOrThrow(changePasswordSchema, req.body);

	respond(
		res,
		await service.changePassword(body, toHeaders(req)),
		"Password changed",
	);
};

export const revokeOtherSessions = async (
	req: Request,
	res: Response,
): Promise<void> => {
	respond(
		res,
		await service.revokeOtherSessions(toHeaders(req)),
		"Other sessions signed out",
	);
};

export const sessions = async (req: Request, res: Response): Promise<void> => {
	respond(res, await service.listSessions(toHeaders(req)), "Sessions");
};

export const signOut = async (req: Request, res: Response): Promise<void> => {
	respond(res, await service.signOut(toHeaders(req)), "Signed out");
};
