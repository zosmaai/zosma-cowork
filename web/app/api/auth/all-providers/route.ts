import { piAuth } from "@/lib/daemon-client";
import { buildApiKeyProviderList, type ProviderListingInput } from "@/lib/provider-listing";

export const dynamic = "force-dynamic";

// Providers that accept an API key, including dual-auth ones such as anthropic —
// see lib/provider-listing.ts for why membership is capability-based (#309).
export async function GET() {
  const listing = await piAuth("provider-listing") as Array<Record<string, unknown>>;
  return Response.json({ providers: buildApiKeyProviderList(listing as unknown as ProviderListingInput[]) });
}