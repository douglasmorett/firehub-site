import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import FireCheckClient from "@/components/customer/FireCheckClient";

export const metadata = { title: "FireCheck — Checklist e Ponto Inteligente" };

export default async function FireCheckPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, storeName: true, email: true },
  });

  if (!user) redirect("/login");

  return (
    <div style={{ padding: "1.5rem 1rem" }}>
      <FireCheckClient user={user} />
    </div>
  );
}
