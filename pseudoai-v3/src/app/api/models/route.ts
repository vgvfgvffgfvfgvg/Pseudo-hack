import { NextResponse } from "next/server";
import { providerApiKey, probeNova } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports which models this deployment can actually serve, so the UI can
 * disable what won't work instead of failing mid-conversation.
 */
export async function GET() {
  const novaAvailable = await probeNova();

  return NextResponse.json(
    {
      models: {
        flax: {
          available: !!providerApiKey("flax"),
          hint: "Add GROQ_API_KEY in your Vercel project settings to enable Flax.",
        },
        scythe: {
          available: !!providerApiKey("scythe"),
          hint: "Add ZAI_API_KEY in your Vercel project settings to enable Scythe.",
        },
        nova: {
          available: novaAvailable,
          hint: "Nova needs the built-in GLM runtime (.z-ai-config). Use Flax or Scythe on standard hosting.",
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
