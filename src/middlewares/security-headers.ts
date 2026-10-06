import helmet from "helmet";
import { isProduction } from "../config/env.js";

// Spelled out rather than merged over helmet's defaults so the enforcing header
// (once we get there) can't surprise us with rules we didn't pick — notably
// `upgrade-insecure-requests`, which breaks local http dev.
const CSP_DIRECTIVES = {
	"default-src": ["'self'"],
	"base-uri": ["'self'"],
	"form-action": ["'self'"],
	"frame-ancestors": ["'none'"],
	"object-src": ["'none'"],
	"img-src": ["'self'", "data:"],
	"font-src": ["'self'", "data:"],
	"style-src": ["'self'", "'unsafe-inline'"],
	"script-src": ["'self'"],
	"connect-src": ["'self'"],
};

export const securityHeaders = helmet({
	// Report-only until it has been observed in a real browser: an enforcing CSP
	// that is even slightly too strict white-screens the whole SPA, so this one
	// is deliberately not allowed to break rendering yet.
	contentSecurityPolicy: {
		reportOnly: true,
		useDefaults: false,
		directives: CSP_DIRECTIVES,
	},
	referrerPolicy: { policy: "strict-origin-when-cross-origin" },
	xFrameOptions: { action: "deny" },
	// HSTS on a local http server would pin the browser to https for localhost.
	strictTransportSecurity: isProduction
		? { maxAge: 31_536_000, includeSubDomains: true }
		: false,
});
