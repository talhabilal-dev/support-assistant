import type { RequestHandler } from "express";
import { auth } from "../lib/auth.js";
import { sendError } from "../utils/api-response.js";
import { toHeaders } from "../utils/request-headers.js";

const getSession = (headers: Headers) => auth.api.getSession({ headers });

type AuthSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;

declare global {
	namespace Express {
		interface Request {
			user?: AuthSession["user"];
			session?: AuthSession["session"];
		}
	}
}

export const requireAuth: RequestHandler = async (req, res, next) => {
	const authSession = await getSession(toHeaders(req));

	if (!authSession) {
		sendError(res, "Unauthorized", 401, "UNAUTHORIZED");
		return;
	}

	req.user = authSession.user;
	req.session = authSession.session;

	next();
};
