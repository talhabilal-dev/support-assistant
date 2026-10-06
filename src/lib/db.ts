import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../config/env.js";
import { relations } from "../modules/index.js";

export const db = drizzle({
	connection: {
		url: env.DATABASE_URL,
		ssl: env.DATABASE_SSL,
	},
	relations,
});
