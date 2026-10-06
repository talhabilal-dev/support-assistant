import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
	END,
	type GraphNode,
	START,
	StateGraph,
	StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import { env } from "../../config/env.js";
import { createChatModel } from "../../lib/chat.js";
import { retrieveChunks } from "./assistant.retrieval.js";

const chunkSchema = z.object({
	chunkId: z.string(),
	documentId: z.string(),
	documentName: z.string(),
	content: z.string(),
	score: z.number(),
});

const retrievalState = new StateSchema({
	userId: z.string(),
	query: z.string(),
	chunks: z.array(chunkSchema).default(() => []),
	sufficient: z.boolean().default(false),
	rewrites: z.number().default(0),
	reason: z.string().default(""),
});

type RetrievalGraphState = typeof retrievalState.State;

const rewriteResultSchema = z.object({
	query: z.string(),
});

// The gate steps never write the answer, so they run on the fast model.
const pipelineModel = createChatModel({ model: env.PIPELINE_MODEL });

const rewriteModel = pipelineModel.withStructuredOutput(rewriteResultSchema);

const retrieveNode: GraphNode<typeof retrievalState> = async (state) => ({
	chunks: await retrieveChunks(
		state.userId,
		state.query,
		env.RETRIEVAL_CANDIDATES,
	),
});

// Selection and the sufficiency verdict share one prompt and one round trip.
// Only the needed indices are requested: asking for a full permutation of every
// candidate made the completion large, and output tokens dominate latency.
const assessResultSchema = z.object({
	relevant: z
		.array(z.number().int())
		.describe(
			"Indices of the candidate passages needed to answer the question, most relevant first. Include only relevant passages.",
		),
	sufficient: z
		.boolean()
		.describe("Whether those passages contain enough information."),
	reason: z.string().describe("One short sentence, no explanation."),
});

const assessModel = pipelineModel.withStructuredOutput(assessResultSchema);

const ASSESS_SNIPPET_LENGTH = 400;

const assessNode: GraphNode<typeof retrievalState> = async (state) => {
	const candidates = state.chunks;

	if (candidates.length === 0) {
		return { sufficient: false, reason: "No documents matched the question." };
	}

	const listing = candidates
		.map(
			(chunk, index) =>
				`[${index + 1}] ${chunk.content.slice(0, ASSESS_SNIPPET_LENGTH)}`,
		)
		.join("\n\n");

	const result = await assessModel.invoke([
		new SystemMessage(
			`You assess retrieved passages for a support assistant. From the numbered candidates, pick the passages that answer the question — most relevant first, at most ${env.RETRIEVAL_TOP_K}, and only the ones actually needed. Then decide whether those passages contain enough information to answer. Be strict: if the answer is missing, mark it insufficient. Be terse.`,
		),
		new HumanMessage(`Question:\n${state.query}\n\nCandidates:\n${listing}`),
	]);

	const seen = new Set<number>();
	const selected: typeof candidates = [];

	for (const value of result.relevant) {
		if (
			!Number.isInteger(value) ||
			value < 1 ||
			value > candidates.length ||
			seen.has(value)
		) {
			continue;
		}

		seen.add(value);
		selected.push(candidates[value - 1]);
	}

	const chunks = selected.slice(0, env.RETRIEVAL_TOP_K);

	return {
		chunks,
		sufficient: chunks.length > 0 && result.sufficient,
		reason: result.reason,
	};
};

const rewriteNode: GraphNode<typeof retrievalState> = async (state) => {
	const result = await rewriteModel.invoke([
		new SystemMessage(
			"Rewrite the user's question into a better search query that is more likely to retrieve the answer. Return a single search query, no explanation.",
		),
		new HumanMessage(
			`Question: ${state.query}\nWhy retrieval fell short: ${state.reason}`,
		),
	]);

	return { query: result.query, rewrites: state.rewrites + 1 };
};

const routeAfterAssess = (state: RetrievalGraphState): string => {
	if (state.sufficient || state.rewrites >= env.CRAG_MAX_REWRITES) {
		return END;
	}

	return "rewrite";
};

const retrievalGraph = new StateGraph(retrievalState)
	.addNode("retrieve", retrieveNode)
	.addNode("assess", assessNode)
	.addNode("rewrite", rewriteNode)
	.addEdge(START, "retrieve")
	.addEdge("retrieve", "assess")
	.addConditionalEdges("assess", routeAfterAssess)
	.addEdge("rewrite", "retrieve")
	.compile();

export const runRetrievalGraph = async (
	userId: string,
	query: string,
	metadata: Record<string, unknown> = {},
) => {
	return retrievalGraph.invoke(
		{ userId, query },
		{
			runName: "crag-retrieval",
			tags: ["assistant", "retrieval"],
			metadata: { userId, ...metadata },
		},
	);
};
