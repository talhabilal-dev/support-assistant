import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.js";

export type ChatModelOptions = {
	model?: string;
	temperature?: number;
	maxOutputTokens?: number;
};

export const createChatModel = (options: ChatModelOptions = {}) =>
	new ChatOpenAI({
		model: options.model ?? env.CHAT_MODEL,
		apiKey: env.OPENAI_API_KEY,
		temperature: options.temperature,
		maxTokens: options.maxOutputTokens ?? env.ASSISTANT_MAX_OUTPUT_TOKENS,
	});
