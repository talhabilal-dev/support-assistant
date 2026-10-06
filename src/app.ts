import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import { sql } from "drizzle-orm";
import express from "express";
import { env } from "./config/env.js";
import { auth } from "./lib/auth.js";
import { db } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import {
	authRateLimiter,
	otpRateLimiter,
	otpSendPaths,
	sensitiveAuthPaths,
	usernameCheckPaths,
	usernameCheckRateLimiter,
} from "./middlewares/rate-limit.js";
import { requestContext, requestLogger } from "./middlewares/request-logger.js";
import { securityHeaders } from "./middlewares/security-headers.js";
import { assistantRouter } from "./modules/assistant/assistant.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { documentRouter } from "./modules/document/document.routes.js";
import { sendError, sendSuccess } from "./utils/api-response.js";
import { globalErrorHandler } from "./utils/error-handler.js";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const indexHtmlPath = join(publicDir, "index.html");
const hasStaticBuild = existsSync(indexHtmlPath);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY);
app.use(requestContext);
app.use(requestLogger);
app.use(securityHeaders);
app.use(
	cors({
		origin: env.CORS_ORIGIN,
		methods: ["GET", "POST", "PUT", "DELETE"],
		credentials: true,
	}),
);

app.get("/health", (_req, res) => {
	sendSuccess(res, { status: "ok", uptime: process.uptime() }, "OK");
});

// Unlike liveness above, readiness touches a dependency, so a platform can
// hold traffic back until the database actually answers.
app.get("/health/ready", async (_req, res) => {
	try {
		await db.execute(sql`select 1`);

		sendSuccess(res, { status: "ready" }, "Ready");
	} catch (error) {
		logger.error({ err: error }, "Readiness check failed");

		sendError(res, "Dependencies are not ready", 503, "NOT_READY");
	}
});

for (const path of sensitiveAuthPaths) {
	app.use(path, authRateLimiter);
}

for (const path of otpSendPaths) {
	app.use(path, otpRateLimiter);
}

for (const path of usernameCheckPaths) {
	app.use(path, usernameCheckRateLimiter);
}

app.use("/api/v1/auth", express.json({ limit: "32kb" }), authRouter);
app.use("/api/v1/documents", express.json({ limit: "32kb" }), documentRouter);
app.use("/api/v1/assistant", express.json({ limit: "32kb" }), assistantRouter);

app.all("/api/auth/*splat", toNodeHandler(auth));

if (hasStaticBuild) {
	// Vite fingerprints filenames under /assets, so they can be cached forever.
	app.use(
		"/assets",
		express.static(join(publicDir, "assets"), {
			maxAge: "1y",
			immutable: true,
		}),
	);

	// Everything else (index.html included) must revalidate, otherwise a new
	// deploy keeps serving the previous bundle.
	app.use(
		express.static(publicDir, {
			index: false,
			setHeaders: (res) => {
				res.setHeader("Cache-Control", "no-cache");
			},
		}),
	);

	app.get("/{*splat}", (req, res, next) => {
		if (req.path.startsWith("/api")) {
			next();
			return;
		}

		// A missing file is a 404, not a client-side route: only extensionless
		// paths get the SPA shell.
		if (req.path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(req.path)) {
			next();
			return;
		}

		res.sendFile(indexHtmlPath);
	});
} else {
	logger.warn({ publicDir }, "Static build not found; serving API routes only");
}

app.use((req, res) => {
	sendError(
		res,
		`Route not found: ${req.method} ${req.originalUrl}`,
		404,
		"ROUTE_NOT_FOUND",
	);
});

app.use(globalErrorHandler);

export default app;
