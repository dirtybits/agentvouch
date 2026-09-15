import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";
import { getConfiguredSolanaChainContext } from "@/lib/chains";
import { getErrorMessage } from "@/lib/errors";

type CountRow = { count: string };
type SkillIdRow = { id: string };

// Operator-only endpoint: it writes demo seed rows into the live database.
// Auth matches /api/github/skills/discover: a Bearer CRON_SECRET, compared in
// constant time, that fails closed on any deployed Vercel environment
// (production and preview are both internet-reachable). The endpoint stays
// open in local development so the local dev flow is unchanged.
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    return timingSafeStringEqual(
      request.headers.get("authorization") ?? "",
      `Bearer ${secret}`
    );
  }
  // No secret configured: fail closed on any deployed Vercel environment.
  // Preview deployments are internet-reachable, so "not production" is not a
  // safe reason to skip auth. Only allow the open path in local development.
  const deployed =
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";
  if (deployed) {
    console.error(
      "[api/seed] CRON_SECRET is not set in a deployed environment; refusing request."
    );
    return false;
  }
  console.warn(
    "[api/seed] CRON_SECRET is not set; running without auth (local development only)."
  );
  return true;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const chainContext = getConfiguredSolanaChainContext();
    const existingRows = await sql()<CountRow>`
      SELECT COUNT(*) as count FROM skills
    `;

    if (parseInt(existingRows[0]?.count) > 0) {
      return NextResponse.json({
        message: "Seed data already exists",
        skipped: true,
      });
    }

    const skillRows = await sql()<SkillIdRow>`
      INSERT INTO skills (skill_id, author_pubkey, name, description, tags, current_version, chain_context)
      VALUES (
        'solana-dev-skill',
        '11111111111111111111111111111111',
        'Solana Developer Skill',
        'Core Solana development concepts, APIs, and SDK usage for AI agents.',
        ARRAY['solana', 'blockchain', 'development'],
        1,
        ${chainContext}
      )
      RETURNING id
    `;
    const skill = skillRows[0];

    await sql()`
      INSERT INTO skill_versions (skill_id, version, content, changelog)
      VALUES (
        ${skill.id}::uuid,
        1,
        ${SEED_CONTENT},
        'Initial release'
      )
    `;

    return NextResponse.json({ success: true, skill_id: skill.id });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

const SEED_CONTENT = `# Solana Developer Skill

Summarizes Solana core concepts and answers questions using the Solana core docs.

## When to Use

Use when the user asks about:
- Solana core concepts
- Accounts, transactions, fees
- Programs, PDAs, CPI
- Tokens, clusters
- Core documentation

## Key Concepts

### Accounts
Everything on Solana is an account. Accounts store state and are owned by programs.

### Transactions
Instructions grouped into transactions. Each instruction targets a program.

### Programs
On-chain code (smart contracts). Written in Rust, deployed as BPF bytecode.

### PDAs
Program Derived Addresses - deterministic addresses owned by programs, not keypairs.
`;
