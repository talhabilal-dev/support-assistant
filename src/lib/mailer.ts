import { readFileSync } from "node:fs";
import { Resend } from "resend";
import { env } from "../config/env.js";
import { AppError } from "../utils/error-handler.js";

const resend = new Resend(env.RESEND_API_KEY);

const templateCache = new Map<string, string>();

const loadTemplate = (name: string): string => {
	const cached = templateCache.get(name);
	if (cached) {
		return cached;
	}

	const html = readFileSync(
		new URL(`../../emails/${name}.html`, import.meta.url),
		"utf8",
	);

	templateCache.set(name, html);

	return html;
};

const escapeHtml = (value: string): string =>
	value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});

const renderTemplate = (
	template: string,
	data: Record<string, string | number>,
): string =>
	Object.entries(data).reduce(
		(html, [key, value]) => html.replaceAll(`{{${key}}}`, String(value)),
		template,
	);

type SendEmailOptions = {
	to: string;
	subject: string;
	html: string;
};

const sendEmail = async ({
	to,
	subject,
	html,
}: SendEmailOptions): Promise<void> => {
	const { error } = await resend.emails.send({
		from: env.EMAIL_FROM,
		to,
		subject,
		html,
	});

	if (error) {
		throw new AppError(
			`Failed to send email: ${error.message}`,
			502,
			"EMAIL_SEND_FAILED",
		);
	}
};

const emailTemplates = {
	"sign-in": { template: "otp-sign-in", subject: "Your sign-in code" },
	"email-verification": {
		template: "otp-email-verification",
		subject: "Verify your email address",
	},
	"forget-password": {
		template: "otp-forget-password",
		subject: "Reset your password",
	},
	"change-email": {
		template: "otp-change-email",
		subject: "Confirm your new email",
	},
} as const;

export type OtpEmailType = keyof typeof emailTemplates;

type SendOtpEmailOptions = {
	email: string;
	otp: string;
	type: OtpEmailType;
};

export const sendOtpEmail = async ({
	email,
	otp,
	type,
}: SendOtpEmailOptions): Promise<void> => {
	const { template, subject } = emailTemplates[type];

	await sendEmail({
		to: email,
		subject,
		html: renderTemplate(loadTemplate(template), {
			otp,
			email,
			year: new Date().getFullYear(),
		}),
	});
};

type SendTicketCreatedEmailOptions = {
	email: string;
	visitorEmail: string;
	question: string;
	ticketId: string;
};

export const sendTicketCreatedEmail = async ({
	email,
	visitorEmail,
	question,
	ticketId,
}: SendTicketCreatedEmailOptions): Promise<void> => {
	await sendEmail({
		to: email,
		subject: "New support ticket",
		html: renderTemplate(loadTemplate("ticket-created"), {
			question: escapeHtml(question),
			visitorEmail: escapeHtml(visitorEmail),
			ticketId,
			year: new Date().getFullYear(),
		}),
	});
};

type SendTicketReplyEmailOptions = {
	email: string;
	question: string;
	body: string;
	ticketId: string;
};

export const sendTicketReplyEmail = async ({
	email,
	question,
	body,
	ticketId,
}: SendTicketReplyEmailOptions): Promise<void> => {
	await sendEmail({
		to: email,
		subject: "Reply to your question",
		html: renderTemplate(loadTemplate("ticket-reply"), {
			question: escapeHtml(question),
			body: escapeHtml(body).replaceAll("\n", "<br>"),
			ticketId,
			year: new Date().getFullYear(),
		}),
	});
};
