"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SignJWT } from "jose";

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || "fallback-secret");

async function getFranchiseeId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Não autenticado");
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, ownerId: true }
  });
  if (!user) throw new Error("Usuário não encontrado");
  return user.role === "STAFF" && user.ownerId ? user.ownerId : user.id;
}

export async function toggleTotemModule(enabled: boolean) {
  const franchiseeId = await getFranchiseeId();
  await prisma.user.update({
    where: { id: franchiseeId },
    data: { totemEnabled: enabled }
  });
  return { success: true };
}

export async function createTotemLicense(label: string) {
  const franchiseeId = await getFranchiseeId();

  const store = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { slug: true, totemEnabled: true }
  });

  if (!store?.totemEnabled) {
    throw new Error("Módulo Totem não está ativado");
  }

  // Create license first to get ID
  const license = await prisma.totemLicense.create({
    data: {
      franchiseeId,
      label: label || "Novo Totem",
      token: "temp", // Will be updated
    }
  });

  // Generate JWT token with license ID
  const token = await new SignJWT({
    licenseId: license.id,
    franchiseeId,
    slug: store.slug,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(secret);

  // Update with real token
  await prisma.totemLicense.update({
    where: { id: license.id },
    data: { token }
  });

  const rawTotemBase = process.env.NEXTAUTH_URL || "";
  const totemBaseUrl = (rawTotemBase && !rawTotemBase.includes("[SENSITIVE]") && rawTotemBase.startsWith("http"))
    ? rawTotemBase.replace(/\/$/, "")
    : "https://www.firehubfood.com.br";

  return { 
    success: true, 
    license: { 
      id: license.id, 
      label: license.label, 
      token,
      url: `${totemBaseUrl}/totem/${store.slug}?token=${token}`
    } 
  };
}

export async function toggleTotemLicense(licenseId: string, active: boolean) {
  const franchiseeId = await getFranchiseeId();
  await prisma.totemLicense.updateMany({
    where: { id: licenseId, franchiseeId },
    data: { active }
  });
  return { success: true };
}

export async function unbindTotemDevice(licenseId: string) {
  const franchiseeId = await getFranchiseeId();
  await prisma.totemLicense.updateMany({
    where: { id: licenseId, franchiseeId },
    data: { deviceFingerprint: null, lastHeartbeat: null, lastIp: null, userAgent: null }
  });
  return { success: true };
}

export async function deleteTotemLicense(licenseId: string) {
  const franchiseeId = await getFranchiseeId();
  await prisma.totemLicense.deleteMany({
    where: { id: licenseId, franchiseeId }
  });
  return { success: true };
}

export async function updateTotemConfig(config: Record<string, any>) {
  const franchiseeId = await getFranchiseeId();
  await prisma.user.update({
    where: { id: franchiseeId },
    data: { totemConfig: config }
  });
  return { success: true };
}
