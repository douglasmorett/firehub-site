import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");
  const pwd = searchParams.get("pwd");

  if (!email) {
    return NextResponse.json({ error: "email required" });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, password: true, ownerId: true }
  });

  if (!user) {
    return NextResponse.json({ found: false, message: "Usuário NÃO encontrado" });
  }

  const result: any = {
    found: true,
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    ownerId: (user as any).ownerId,
    hasPassword: !!user.password,
    passwordLength: user.password?.length || 0,
    passwordPrefix: user.password?.substring(0, 7) || "",
  };

  if (pwd) {
    result.passwordMatch = await bcrypt.compare(pwd, user.password);
  }

  return NextResponse.json(result);
}
