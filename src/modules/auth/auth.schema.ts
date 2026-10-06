import { z } from "zod";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;
const OTP_LENGTH = 6;

const newPasswordSchema = z
	.string()
	.min(PASSWORD_MIN_LENGTH)
	.max(PASSWORD_MAX_LENGTH);

const passwordSchema = z.string().min(1);

const usernameSchema = z
	.string()
	.min(USERNAME_MIN_LENGTH)
	.max(USERNAME_MAX_LENGTH)
	.regex(/^[a-zA-Z0-9_.]+$/);

const otpSchema = z.string().length(OTP_LENGTH);

export const otpTypeSchema = z.enum([
	"sign-in",
	"email-verification",
	"forget-password",
	"change-email",
]);

export const signUpEmailSchema = z.object({
	name: z.string().min(1),
	email: z.email(),
	password: newPasswordSchema,
	image: z.string().optional(),
	username: usernameSchema.optional(),
	displayUsername: z.string().min(1).optional(),
	callbackURL: z.string().optional(),
	rememberMe: z.boolean().optional(),
});

export const signInEmailSchema = z.object({
	email: z.email(),
	password: passwordSchema,
	callbackURL: z.string().optional(),
	rememberMe: z.boolean().optional(),
});

export const signInUsernameSchema = z.object({
	username: usernameSchema,
	password: passwordSchema,
	callbackURL: z.string().optional(),
	rememberMe: z.boolean().optional(),
});

export const signInEmailOtpSchema = z.object({
	email: z.email(),
	otp: otpSchema,
	name: z.string().min(1).optional(),
	image: z.string().optional(),
});

export const sendVerificationOtpSchema = z.object({
	email: z.email(),
	type: otpTypeSchema,
});

export const verifyEmailOtpSchema = z.object({
	email: z.email(),
	otp: otpSchema,
});

export const requestPasswordResetSchema = z.object({
	email: z.email(),
	redirectTo: z.string().optional(),
});

export const resetPasswordSchema = z.object({
	newPassword: newPasswordSchema,
	token: z.string().min(1).optional(),
});

export const isUsernameAvailableSchema = z.object({
	username: usernameSchema,
});

export const updateUserSchema = z
	.object({
		name: z.string().min(1).max(100).optional(),
		username: usernameSchema.optional(),
	})
	.refine((value) => value.name !== undefined || value.username !== undefined, {
		message: "Provide a name or username to update",
		path: ["name"],
	});

export const changePasswordSchema = z.object({
	currentPassword: z.string().min(1),
	newPassword: newPasswordSchema,
	revokeOtherSessions: z.boolean().optional(),
});

export const resetPasswordOtpSchema = z.object({
	email: z.email(),
	otp: otpSchema,
	password: newPasswordSchema,
});

export type SignUpEmailInput = z.infer<typeof signUpEmailSchema>;
export type SignInEmailInput = z.infer<typeof signInEmailSchema>;
export type SignInUsernameInput = z.infer<typeof signInUsernameSchema>;
export type SignInEmailOtpInput = z.infer<typeof signInEmailOtpSchema>;
export type SendVerificationOtpInput = z.infer<
	typeof sendVerificationOtpSchema
>;
export type VerifyEmailOtpInput = z.infer<typeof verifyEmailOtpSchema>;
export type RequestPasswordResetInput = z.infer<
	typeof requestPasswordResetSchema
>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type IsUsernameAvailableInput = z.infer<
	typeof isUsernameAvailableSchema
>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetPasswordOtpInput = z.infer<typeof resetPasswordOtpSchema>;
