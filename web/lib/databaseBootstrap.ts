import { ensureAgentIdentitySchema } from "@/lib/agentIdentity";
import { initializeDatabase } from "@/lib/db";
import { ensureUsdcPurchaseSchema } from "@/lib/usdcPurchases";

export async function bootstrapDatabase() {
  await initializeDatabase();
  await ensureUsdcPurchaseSchema();
  await ensureAgentIdentitySchema();
}
