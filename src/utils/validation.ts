import type { ZodType } from "zod";
import { AppError } from "./error-handler.js";

export const parseOrThrow = <T>(schema: ZodType<T>, data: unknown): T => {
	const parsed = schema.safeParse(data);

	if (!parsed.success) {
		throw new AppError(
			"Validation failed",
			400,
			"VALIDATION_ERROR",
			parsed.error.issues,
		);
	}

	return parsed.data;
};
