import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/api-response.js";
import { AppError } from "../../utils/error-handler.js";
import { requireUser } from "../../utils/require-user.js";
import { parseOrThrow } from "../../utils/validation.js";
import {
	documentParamsSchema,
	listDocumentsQuerySchema,
	searchDocumentsSchema,
} from "./document.schema.js";
import {
	ALLOWED_MIME_TYPES,
	deleteDocument,
	listDocuments,
	queueDocumentIngest,
	searchDocuments,
} from "./document.service.js";

export const uploadDocument = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const user = requireUser(req);

	if (!req.file) {
		throw new AppError("No file uploaded", 400, "FILE_REQUIRED");
	}

	if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
		throw new AppError(
			`Unsupported file type: ${req.file.mimetype}`,
			415,
			"UNSUPPORTED_MEDIA_TYPE",
		);
	}

	if (
		req.file.mimetype === "application/pdf" &&
		!req.file.buffer.subarray(0, 5).toString("latin1").startsWith("%PDF-")
	) {
		throw new AppError(
			"File content does not match its declared type",
			415,
			"UNSUPPORTED_MEDIA_TYPE",
		);
	}

	const result = await queueDocumentIngest(user.id, {
		buffer: req.file.buffer,
		mimetype: req.file.mimetype,
		originalname: req.file.originalname,
		size: req.file.size,
	});

	sendSuccess(res, result, "Document queued for indexing", 202);
};

export const listDocumentsHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const user = requireUser(req);
	const page = parseOrThrow(listDocumentsQuerySchema, req.query);

	sendSuccess(res, await listDocuments(user.id, page), "Documents");
};

export const searchDocumentsHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const user = requireUser(req);
	const input = parseOrThrow(searchDocumentsSchema, req.body);

	sendSuccess(res, await searchDocuments(user.id, input), "Document matches");
};

export const deleteDocumentHandler = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const user = requireUser(req);
	const { documentId } = parseOrThrow(documentParamsSchema, req.params);

	sendSuccess(
		res,
		await deleteDocument(user.id, documentId),
		"Document deleted",
	);
};
