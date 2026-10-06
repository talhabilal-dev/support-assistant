import { and, desc, eq, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { vectorDb } from "../../lib/vector-db.js";
import { searchChunksByVector } from "../../lib/vector-search.js";
import { document, documentChunk } from "../document/document.model.js";

export type RetrievedChunk = {
	chunkId: string;
	documentId: string;
	documentName: string;
	content: string;
	score: number;
};

type RankedChunk = Omit<RetrievedChunk, "score">;

// Reciprocal Rank Fusion constant (standard default).
const RRF_K = 60;

const selectColumns = {
	chunkId: documentChunk.id,
	documentId: documentChunk.documentId,
	documentName: document.name,
	content: documentChunk.content,
};

const denseSearch = async (
	userId: string,
	query: string,
	limit: number,
): Promise<RankedChunk[]> => {
	const matches = await searchChunksByVector(userId, query, limit);

	return matches.map((match) => ({
		chunkId: match.chunkId,
		documentId: match.documentId,
		documentName: match.documentName,
		content: match.content,
	}));
};

const sparseSearch = async (
	userId: string,
	query: string,
	limit: number,
): Promise<RankedChunk[]> => {
	const rank = sql<number>`ts_rank(${documentChunk.contentTsv}, websearch_to_tsquery('english', ${query}))`;

	return vectorDb
		.select(selectColumns)
		.from(documentChunk)
		.innerJoin(document, eq(documentChunk.documentId, document.id))
		.where(
			and(
				eq(document.userId, userId),
				sql`${documentChunk.contentTsv} @@ websearch_to_tsquery('english', ${query})`,
			),
		)
		.orderBy(desc(rank))
		.limit(limit);
};

const fuse = (lists: RankedChunk[][], limit: number): RetrievedChunk[] => {
	const fused = new Map<string, RetrievedChunk>();

	for (const list of lists) {
		list.forEach((chunk, index) => {
			const contribution = 1 / (RRF_K + index + 1);
			const existing = fused.get(chunk.chunkId);

			if (existing) {
				existing.score += contribution;
			} else {
				fused.set(chunk.chunkId, { ...chunk, score: contribution });
			}
		});
	}

	return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit);
};

export const retrieveChunks = async (
	userId: string,
	query: string,
	limit = env.RETRIEVAL_TOP_K,
): Promise<RetrievedChunk[]> => {
	const [dense, sparse] = await Promise.all([
		denseSearch(userId, query, limit),
		sparseSearch(userId, query, limit),
	]);

	return fuse([dense, sparse], limit);
};

export const formatContext = (chunks: RetrievedChunk[]): string =>
	chunks
		.map(
			(chunk, index) =>
				`[${index + 1}] (${chunk.documentName})\n${chunk.content}`,
		)
		.join("\n\n");
