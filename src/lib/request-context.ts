import { AsyncLocalStorage } from "node:async_hooks";

type RequestContext = {
	requestId: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `callback` with the request id available to anything it awaits. */
export const runWithRequestContext = <T>(
	context: RequestContext,
	callback: () => T,
): T => storage.run(context, callback);

/** Undefined outside a request (workers, scripts, startup). */
export const getRequestId = (): string | undefined =>
	storage.getStore()?.requestId;
