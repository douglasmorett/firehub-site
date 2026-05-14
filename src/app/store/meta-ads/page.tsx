import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import TrafegoPagoClient from "@/components/customer/TrafegoPagoClient";

export const metadata = { title: "Tráfego Pago — FireHub" };

export default async function TrafegoPagoPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, storeName: true, slug: true },
  });
  if (!user) redirect("/login");

  return (
    <div style={{ padding: "1.5rem 1rem" }}>
      <TrafegoPagoClient user={user} />
    </div>
  );
}
