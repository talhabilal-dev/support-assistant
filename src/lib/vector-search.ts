import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { document, documentChunk } from "../modules/document/document.model.js";
import { embeddings } from "./embeddings.js";
import { vectorDb } from "./vector-db.js";

type VectorMatch = {
	chunkId: string;
	documentId: string;
	documentName: string;
	content: string;
	similarity: number;
};

export const searchChunksByVector = async (
	userId: string,
	query: string,
	limit: number,
	minScore?: number,
): Promise<VectorMatch[]> => {
	const queryVector = await embeddings.embedQuery(query);
	const similarity = sql<number>`1 - (${cosineDistance(documentChunk.embedding, queryVector)})`;

	const condition =
		minScore === undefined
			? eq(document.userId, userId)
			: and(eq(document.userId, userId), gt(similarity, minScore));

	return vectorDb
		.select({
			chunkId: documentChunk.id,
			documentId: documentChunk.documentId,
			documentName: document.name,
			content: documentChunk.content,
			similarity,
		})
		.from(documentChunk)
		.innerJoin(document, eq(documentChunk.documentId, document.id))
		.where(condition)
		.orderBy(desc(similarity))
		.limit(limit);
};
