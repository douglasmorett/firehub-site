import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ 
    dbUrl: process.env.DATABASE_URL?.split('@')[1] || "none" 
  });
}
