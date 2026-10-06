import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { emailOTP, username } from "better-auth/plugins";
import { env } from "../config/env.js";
import { EMAIL_QUEUE } from "../jobs/queues.js";
import type { EmailJob } from "../jobs/types.js";
import { db } from "./db.js"; // your drizzle instance
import { sendJob } from "./queue.js";

const authWindowSeconds = Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000);
const otpWindowSeconds = Math.ceil(env.OTP_RATE_LIMIT_WINDOW_MS / 1000);

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg", // or "mysql", "sqlite"
	}),
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
	emailVerification: {
		// Verifying via OTP signs the user in, so signup -> verify lands them in.
		autoSignInAfterVerification: true,
	},
	session: {
		// Keep sessions "fresh" for their whole lifetime (better-auth defaults to
		// 1 day). Otherwise listing sessions and changing the password 403 with
		// SESSION_NOT_FRESH once a login is older than a day.
		freshAge: 0,
	},
	rateLimit: {
		enabled: true,
		window: 60,
		max: 100,
		customRules: {
			"/sign-up/email": {
				window: authWindowSeconds,
				max: env.RATE_LIMIT_MAX,
			},
			"/sign-in/email": {
				window: authWindowSeconds,
				max: env.RATE_LIMIT_MAX,
			},
			"/sign-in/username": {
				window: authWindowSeconds,
				max: env.RATE_LIMIT_MAX,
			},
			"/sign-in/email-otp": {
				window: authWindowSeconds,
				max: env.RATE_LIMIT_MAX,
			},
			"/forget-password": {
				window: authWindowSeconds,
				max: env.RATE_LIMIT_MAX,
			},
			"/reset-password": {
				window: authWindowSeconds,
				max: env.RATE_LIMIT_MAX,
			},
			"/email-otp/send-verification-otp": {
				window: otpWindowSeconds,
				max: env.OTP_RATE_LIMIT_MAX,
			},
			"/email-otp/request-password-reset": {
				window: otpWindowSeconds,
				max: env.OTP_RATE_LIMIT_MAX,
			},
			"/email-otp/request-email-change": {
				window: otpWindowSeconds,
				max: env.OTP_RATE_LIMIT_MAX,
			},
			"/forget-password/email-otp": {
				window: otpWindowSeconds,
				max: env.OTP_RATE_LIMIT_MAX,
			},
		},
	},
	plugins: [
		username(),
		emailOTP({
			async sendVerificationOTP({ email, otp, type }) {
				const job: EmailJob = { kind: "otp", email, otp, type };

				await sendJob(EMAIL_QUEUE, job);
			},
		}),
	],
});
