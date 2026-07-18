import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest, NextResponse } from "next/server";
import { deleteBuyerAccountForIdentity } from "@/lib/buyerAccounts";
import { getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest) {
  let event;
  try {
    event = await verifyWebhook(request);
  } catch (error) {
    return NextResponse.json(
      { error: `Webhook verification failed: ${getErrorMessage(error)}` },
      { status: 400 }
    );
  }

  if (event.type !== "user.deleted") {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const providerSubject = event.data.id?.trim();
  if (!providerSubject) {
    return NextResponse.json(
      { error: "Verified Clerk user.deleted event is missing a user id." },
      { status: 400 }
    );
  }

  try {
    const result = await deleteBuyerAccountForIdentity({
      provider: "clerk",
      providerSubject,
    });
    return NextResponse.json({
      received: true,
      deleted: Boolean(result.accountId),
      identityLinksRemoved: result.identityLinksRemoved,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(
          error,
          "Unable to reconcile the deleted buyer identity."
        ),
      },
      { status: 500 }
    );
  }
}
