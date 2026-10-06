import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config/env.js";

export const embeddings = new OpenAIEmbeddings({
	apiKey: env.OPENAI_API_KEY,
	model: env.OPENAI_EMBEDDING_MODEL,
	dimensions: env.OPENAI_EMBEDDING_DIMENSIONS,
});
