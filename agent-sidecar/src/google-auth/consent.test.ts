import { describe, expect, it } from "vitest";
import type { EmbeddedClient } from "./broker.js";
import { buildAuthUrl, consentTargets } from "./consent.js";

const brokered: EmbeddedClient = {
	clientId: "zosma-id",
	clientSecret: "",
	brokerUrl: "https://broker.example.app",
};
const byo: EmbeddedClient = { clientId: "byo-id", clientSecret: "byo-secret", brokerUrl: "" };

describe("consentTargets", () => {
	it("uses the broker /callback redirect for the brokered Zosma client", () => {
		const t = consentTargets(brokered, 5123);
		expect(t.useBroker).toBe(true);
		expect(t.redirectUri).toBe("https://broker.example.app/callback");
	});

	it("uses the loopback redirect for a bring-your-own client (direct)", () => {
		const t = consentTargets(byo, 5123);
		expect(t.useBroker).toBe(false);
		expect(t.redirectUri).toBe("http://127.0.0.1:5123/oauth2callback");
	});
});

describe("buildAuthUrl", () => {
	it("requests exactly the resolved scope list", () => {
		const url = new URL(
			buildAuthUrl({
				clientId: "zosma-id",
				redirectUri: "https://broker.example.app/callback",
				scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"],
				challenge: "chal",
				state: "st",
			}),
		);
		expect(url.searchParams.get("scope")).toBe(
			"openid email https://www.googleapis.com/auth/calendar.readonly",
		);
		expect(url.searchParams.get("client_id")).toBe("zosma-id");
		expect(url.searchParams.get("redirect_uri")).toBe("https://broker.example.app/callback");
		expect(url.searchParams.get("code_challenge")).toBe("chal");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("access_type")).toBe("offline");
		expect(url.searchParams.get("prompt")).toBe("consent");
	});
});
