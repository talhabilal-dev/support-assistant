import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middlewares/auth.js";
import { documentRateLimiter } from "../../middlewares/rate-limit.js";
import {
	deleteDocumentHandler,
	listDocumentsHandler,
	searchDocumentsHandler,
	uploadDocument,
} from "./document.controller.js";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

export const documentRouter = Router();

documentRouter.use(requireAuth);

documentRouter.post(
	"/",
	documentRateLimiter,
	upload.single("file"),
	uploadDocument,
);
documentRouter.get("/", listDocumentsHandler);
documentRouter.post("/search", documentRateLimiter, searchDocumentsHandler);
documentRouter.delete(
	"/:documentId",
	documentRateLimiter,
	deleteDocumentHandler,
);
