import { NextResponse } from "next/server";
import { bootstrapDatabase } from "@/lib/databaseBootstrap";
import { getErrorMessage } from "@/lib/errors";

export async function POST() {
  try {
    await bootstrapDatabase();
    return NextResponse.json({
      success: true,
      message: "Database tables created",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
