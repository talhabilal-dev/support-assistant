import { logger } from "../lib/logger.js";
import { vectorDb } from "../lib/vector-db.js";
import { document } from "../modules/document/document.model.js";

/**
 * Wipes every document (and its chunks/vectors). Destructive — pass --yes.
 *
 *   pnpm clear:vectors -- --yes
 */
const main = async () => {
	if (!process.argv.includes("--yes")) {
		logger.warn(
			"This deletes every document and its vectors. Re-run with --yes.",
		);
		process.exit(1);
	}

	const deleted = await vectorDb
		.delete(document)
		.returning({ id: document.id });

	logger.info({ count: deleted.length }, "Cleared documents and vectors");

	process.exit(0);
};

await main();
