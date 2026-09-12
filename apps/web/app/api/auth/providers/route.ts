import { piAuth } from "@/lib/daemon-client";
import { buildOAuthProviderList, type ProviderListingInput } from "@/lib/provider-listing";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309). The daemon builds
// the provider listing from ModelRuntime; this route filters to OAuth.
export async function GET() {
  const listing = await piAuth("provider-listing") as Array<Record<string, unknown>>;
  return Response.json({ providers: buildOAuthProviderList(listing as unknown as ProviderListingInput[]) });
}