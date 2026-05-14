import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import MenuProductManager from "@/components/admin/MenuProductManager";
import IfoodImportButton from "@/components/IfoodImportButton";

export default async function StoreCardapioPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN") redirect("/");

  const products = await prisma.menuProduct.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: {
      comboGroups: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            include: { menuProduct: { select: { id: true, name: true, active: true } } }
          }
        }
      }
    }
  });

  const availableItems = await prisma.menuProduct.findMany({
    where: { isCombo: false },
    select: { id: true, name: true, active: true },
    orderBy: { name: "asc" }
  });

  return (
    <div className="container" style={{ marginTop: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <h1 className="font-bold" style={{ fontSize: "1.8rem", margin: 0 }}>🍽️ Cardápio Digital</h1>
          <p className="text-muted" style={{ margin: "4px 0 0" }}>Gerencie seus produtos, preços e disponibilidade.</p>
        </div>
        <a
          href="/store/cardapio/custos"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "10px 20px", borderRadius: 12,
            background: "linear-gradient(135deg,#0F172A,#1E293B)",
            color: "#fff", fontWeight: 700, fontSize: "0.88rem",
            textDecoration: "none", whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
          }}
        >
          📊 Cadastrar CMV em Massa
        </a>
      </div>

      {/* IMPORTAR DO IFOOD */}
      <IfoodImportButton />

      <MenuProductManager products={products} availableItems={availableItems} />
    </div>
  );
}
