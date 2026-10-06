import { auth } from "../../lib/auth.js";
import type {
	ChangePasswordInput,
	IsUsernameAvailableInput,
	RequestPasswordResetInput,
	ResetPasswordInput,
	ResetPasswordOtpInput,
	SendVerificationOtpInput,
	SignInEmailInput,
	SignInEmailOtpInput,
	SignInUsernameInput,
	SignUpEmailInput,
	UpdateUserInput,
	VerifyEmailOtpInput,
} from "./auth.schema.js";

export type ApiResult = {
	status: number;
	headers: Headers;
	body: unknown;
};

const callApi = async (request: Promise<Response>): Promise<ApiResult> => {
	const response = await request;

	return {
		status: response.status,
		headers: response.headers,
		body: await response.json().catch(() => null),
	};
};

export const signUp = (body: SignUpEmailInput, headers: Headers) =>
	callApi(auth.api.signUpEmail({ body, headers, asResponse: true }));

export const signIn = (body: SignInEmailInput, headers: Headers) =>
	callApi(auth.api.signInEmail({ body, headers, asResponse: true }));

export const signInEmailOtp = (body: SignInEmailOtpInput, headers: Headers) =>
	callApi(auth.api.signInEmailOTP({ body, headers, asResponse: true }));

export const signInUsername = (body: SignInUsernameInput, headers: Headers) =>
	callApi(auth.api.signInUsername({ body, headers, asResponse: true }));

export const requestPasswordReset = (
	body: RequestPasswordResetInput,
	headers: Headers,
) =>
	callApi(auth.api.requestPasswordReset({ body, headers, asResponse: true }));

export const resetPassword = (body: ResetPasswordInput, headers: Headers) =>
	callApi(auth.api.resetPassword({ body, headers, asResponse: true }));

export const resetPasswordEmailOtp = (
	body: ResetPasswordOtpInput,
	headers: Headers,
) =>
	callApi(auth.api.resetPasswordEmailOTP({ body, headers, asResponse: true }));

export const verifyEmailOtp = (body: VerifyEmailOtpInput, headers: Headers) =>
	callApi(auth.api.verifyEmailOTP({ body, headers, asResponse: true }));

export const isUsernameAvailable = (
	body: IsUsernameAvailableInput,
	headers: Headers,
) => callApi(auth.api.isUsernameAvailable({ body, headers, asResponse: true }));

export const sendVerificationOtp = (
	body: SendVerificationOtpInput,
	headers: Headers,
) => callApi(auth.api.sendVerificationOTP({ body, headers, asResponse: true }));

export const updateUser = (body: UpdateUserInput, headers: Headers) =>
	callApi(auth.api.updateUser({ body, headers, asResponse: true }));

export const changePassword = (body: ChangePasswordInput, headers: Headers) =>
	callApi(auth.api.changePassword({ body, headers, asResponse: true }));

export const revokeOtherSessions = (headers: Headers) =>
	callApi(auth.api.revokeOtherSessions({ headers, asResponse: true }));

export const listSessions = (headers: Headers) =>
	callApi(auth.api.listSessions({ headers, asResponse: true }));

export const getSession = (headers: Headers) =>
	auth.api.getSession({ headers });

export const signOut = (headers: Headers) =>
	callApi(auth.api.signOut({ headers, asResponse: true }));
