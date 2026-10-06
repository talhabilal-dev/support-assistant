import type { OtpEmailType } from "../lib/mailer.js";

/** Attached by `sendJob` so a worker's logs correlate with the request. */
export type JobCorrelation = {
	requestId?: string;
};

export type OtpEmailJob = JobCorrelation & {
	kind: "otp";
	email: string;
	otp: string;
	type: OtpEmailType;
};

export type TicketCreatedEmailJob = JobCorrelation & {
	kind: "ticket-created";
	email: string;
	visitorEmail: string;
	question: string;
	ticketId: string;
};

export type TicketReplyEmailJob = JobCorrelation & {
	kind: "ticket-reply";
	email: string;
	question: string;
	body: string;
	ticketId: string;
};

export type EmailJob =
	| OtpEmailJob
	| TicketCreatedEmailJob
	| TicketReplyEmailJob;

export type DocumentIngestJob = JobCorrelation & {
	kind: "document-ingest";
	documentId: string;
};

export type MaintenanceJob = JobCorrelation & {
	kind: "maintenance";
};
