import { Router } from "express";
import * as controller from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/sign-up", controller.signUp);
authRouter.post("/sign-in", controller.signIn);
authRouter.post("/sign-in/email-otp", controller.signInEmailOtp);
authRouter.post("/sign-in/username", controller.signInUsername);
authRouter.post("/request-password-reset", controller.requestPasswordReset);
authRouter.post("/reset-password", controller.resetPassword);
authRouter.post("/otp/send", controller.sendOtp);
authRouter.post("/otp/verify", controller.verifyOtp);
authRouter.post("/otp/reset-password", controller.resetPasswordOtp);
authRouter.post("/is-username-available", controller.isUsernameAvailable);
authRouter.get("/session", controller.session);
authRouter.get("/sessions", controller.sessions);
authRouter.post("/update-user", controller.updateUser);
authRouter.post("/change-password", controller.changePassword);
authRouter.post("/revoke-other-sessions", controller.revokeOtherSessions);
authRouter.post("/sign-out", controller.signOut);
