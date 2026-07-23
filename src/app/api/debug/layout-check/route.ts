import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const result: any = { steps: [] };

  // Step 1: getServerSession (same as layout.tsx)
  let session: any = null;
  try {
    session = await getServerSession(authOptions);
    result.steps.push({ step: "getServerSession", ok: true, session: session ? { email: session.user?.email, role: (session.user as any)?.role } : null });
  } catch (err: any) {
    result.steps.push({ step: "getServerSession", ok: false, error: err?.message });
    return NextResponse.json(result);
  }

  if (!session) {
    result.steps.push({ step: "session-null-check", ok: false, wouldRedirect: true });
    return NextResponse.json(result);
  }

  const role = (session.user as any)?.role;
  result.steps.push({ step: "role-check", role, allowed: role === "FRANCHISEE" || role === "ADMIN" || role === "STAFF" });

  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") {
    result.steps.push({ step: "role-blocked", wouldRedirect: true });
    return NextResponse.json(result);
  }

  // Step 2: prisma user lookup (same as layout.tsx)
  let user: any = null;
  try {
    user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, name: true, email: true, city: true, slug: true, role: true, ownerId: true, cpfCnpj: true, storeOpen: true, cashOpen: true, createdAt: true, isFranqueadoHakim: true },
    });
    result.steps.push({ step: "prisma-user", ok: true, userId: user?.id, role: user?.role, ownerId: user?.ownerId });
  } catch (err: any) {
    result.steps.push({ step: "prisma-user", ok: false, error: err?.message });
  }

  // Step 3: storeOwner lookup
  let storeOwner = user;
  if (user?.ownerId) {
    try {
      const owner = await prisma.user.findUnique({
        where: { id: user.ownerId },
        select: { id: true, name: true, email: true, city: true, slug: true, role: true },
      });
      if (owner) storeOwner = owner;
      result.steps.push({ step: "storeOwner-lookup", ok: true, ownerId: owner?.id, ownerName: owner?.name });
    } catch (err: any) {
      result.steps.push({ step: "storeOwner-lookup", ok: false, error: err?.message });
    }
  }

  // Step 4: store/page.tsx user lookup
  try {
    const pageUser = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: {
        id: true, slug: true, ownerId: true,
        storeLogo: true, storeBanner: true, storeHours: true,
        paymentFees: true, deliveryZones: true, storeOrderCount: true,
      }
    });
    const targetFranchiseeId = (pageUser as any)?.ownerId || pageUser?.id;
    result.steps.push({ step: "page-user", ok: true, targetFranchiseeId });
  } catch (err: any) {
    result.steps.push({ step: "page-user", ok: false, error: err?.message });
  }

  result.conclusion = "All steps passed - layout should NOT redirect";
  return NextResponse.json(result);
}
