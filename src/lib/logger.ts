import pino from "pino";
import { env, isProduction } from "../config/env.js";

export const logger = pino({
	level: env.LOG_LEVEL,
	redact: {
		paths: [
			"req.headers.authorization",
			"req.headers['proxy-authorization']",
			"req.headers.cookie",
			"req.headers['set-cookie']",
			"req.headers['x-api-key']",
			"req.headers['x-auth-token']",
			"req.headers['x-access-token']",
			"req.headers['x-refresh-token']",
			"res.headers['set-cookie']",
			"password",
			"*.password",
			"token",
			"*.token",
			"secret",
			"*.secret",
			"accessToken",
			"*.accessToken",
			"refreshToken",
			"*.refreshToken",
			"idToken",
			"*.idToken",
			"apiKey",
			"*.apiKey",
			"api_key",
			"*.api_key",
		],
		censor: "[Redacted]",
	},
	transport: isProduction
		? undefined
		: {
				target: "pino-pretty",
				options: {
					colorize: true,
					translateTime: "SYS:standard",
					ignore: "pid,hostname",
				},
			},
});
