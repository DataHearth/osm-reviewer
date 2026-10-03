import { OAuth2Server } from "oauth2-mock-server";

const PORT = 4174;
export const IDP_ISSUER = `http://127.0.0.1:${PORT}`;

/**
 * A stand-in OpenID provider. It signs a real ID token, checks PKCE and echoes the nonce,
 * so the app's half of the exchange runs unmodified; the account it answers with is
 * whatever the last `as()` set.
 */
export async function startIdp() {
	const server = new OAuth2Server();
	await server.issuer.keys.generate("RS256");
	await server.start(PORT, "127.0.0.1");
	// The mock names itself after the address it bound, which need not be the URL the app
	// is configured with — and OIDC discovery refuses an issuer that differs from it.
	server.issuer.url = IDP_ISSUER;

	return {
		as(claims: { sub: string; [claim: string]: unknown }) {
			server.service.removeAllListeners("beforeTokenSigning");
			server.service.removeAllListeners("beforeUserinfo");
			server.service.on("beforeTokenSigning", (token) => {
				token.payload.sub = claims.sub;
				// openid-client form-encodes the client id in Basic auth (RFC 6749 §2.3.1), so
				// `osm-reviewer` arrives as `osm%2Dreviewer`; the mock copies it into the ID
				// token's `aud` without decoding, where a real provider would decode it.
				if (typeof token.payload.aud === "string") {
					token.payload.aud = decodeURIComponent(token.payload.aud);
				}
			});
			server.service.on("beforeUserinfo", (res) => {
				res.body = claims;
			});
		},
		stop: () => server.stop(),
	};
}
