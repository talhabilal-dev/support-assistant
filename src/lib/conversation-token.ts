import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "sha256";
const DIGEST = "hex";

const sign = (purpose: string, conversationId: string): string =>
	createHmac(ALGORITHM, env.CHAT_TOKEN_SECRET)
		.update(`${purpose}:${conversationId}`)
		.digest(DIGEST);

export const createVisitorToken = (conversationId: string): string =>
	sign("visitor", conversationId);

export const verifyVisitorToken = (
	conversationId: string,
	token: string,
): boolean => {
	const expected = Buffer.from(createVisitorToken(conversationId), DIGEST);
	const provided = Buffer.from(token, DIGEST);

	if (expected.length !== provided.length) {
		return false;
	}

	return timingSafeEqual(expected, provided);
};
