/** POST /api/garcom/logout — apaga o cookie do garçom. */
import { NextResponse } from "next/server";
import { COOKIE_DO_GARCOM, opcoesDoCookieDoGarcom } from "@/lib/garcom-auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_DO_GARCOM, "", opcoesDoCookieDoGarcom(0));
  return res;
}
