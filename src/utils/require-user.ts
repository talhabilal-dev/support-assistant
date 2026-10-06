import type { Request } from "express";
import { AppError } from "./error-handler.js";

export const requireUser = (req: Request) => {
	if (!req.user) {
		throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
	}

	return req.user;
};
