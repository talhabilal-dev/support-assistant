import type { Response } from "express";

type ApiSuccessResponse<T> = {
	success: true;
	message: string;
	data: T;
};

type ApiErrorResponse = {
	success: false;
	error: {
		message: string;
		code: string;
		details?: unknown;
	};
};

export const sendSuccess = <T>(
	res: Response,
	data: T,
	message = "Success",
	statusCode = 200,
): Response => {
	const body: ApiSuccessResponse<T> = {
		success: true,
		message,
		data,
	};

	return res.status(statusCode).json(body);
};

export const sendError = (
	res: Response,
	message: string,
	statusCode = 500,
	code = "INTERNAL_SERVER_ERROR",
	details?: unknown,
): Response => {
	const body: ApiErrorResponse = {
		success: false,
		error: {
			message,
			code,
			...(details !== undefined ? { details } : {}),
		},
	};

	return res.status(statusCode).json(body);
};
