import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import MenuProductManager from "@/components/admin/MenuProductManager";
import IfoodImportButton from "@/components/IfoodImportButton";

export const dynamic = "force-dynamic";

export default async function StoreCardapioPage() {
  // Autenticação FORA de try/catch — redirect() não pode ser capturado
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[Cardapio] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  // Buscar o usuário FORA do try/catch para que redirect() propague
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true },
  }).catch((err) => {
    console.error("[Cardapio] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");

  const targetFranchiseeId = (user as any).ownerId || user.id;

  // ADMIN vê tudo; FRANCHISEE / STAFF só vê os produtos da sua loja
  const franchiseeFilter = user.role === "ADMIN"
    ? {}
    : { franchiseeId: targetFranchiseeId };

  let products: any[] = [];
  let availableItems: any[] = [];
  let categories: any[] = [];

  try {
    [products, availableItems, categories] = await Promise.all([
      prisma.menuProduct.findMany({
        where: franchiseeFilter,
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: {
          comboGroups: {
            orderBy: { sortOrder: "asc" },
            include: {
              items: {
                include: {
                  menuProduct: { select: { id: true, name: true, active: true } },
                },
              },
            },
          },
        },
      }),
      prisma.menuProduct.findMany({
        where: { ...franchiseeFilter, isCombo: false },
        select: { id: true, name: true, active: true },
        orderBy: { name: "asc" },
      }),
      prisma.menuCategory.findMany({
        where: user.role === "ADMIN" ? {} : { franchiseeId: targetFranchiseeId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    ]);
  } catch (err) {
    console.error("[Cardapio] Erro ao buscar dados:", err);
    products = [];
    availableItems = [];
    categories = [];
  }


  return (
    <div className="container" style={{ marginTop: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 className="font-bold" style={{ fontSize: "1.8rem", margin: 0 }}>
            🍽️ Cardápio Digital
          </h1>
          <p className="text-muted" style={{ margin: "4px 0 0" }}>
            Gerencie seus produtos, preços e disponibilidade.
          </p>
        </div>
        <a
          href="/store/cardapio/custos"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            borderRadius: 12,
            background: "linear-gradient(135deg,#0F172A,#1E293B)",
            color: "#fff",
            fontWeight: 700,
            fontSize: "0.88rem",
            textDecoration: "none",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
          }}
        >
          📊 Cadastrar CMV em Massa
        </a>
      </div>

      {/* IMPORTAR DO IFOOD */}
      <IfoodImportButton />

      {/* BANNER DE DICA DE ALTA CONVERSÃO: DESTAQUES DA CASA */}
      <div
        style={{
          background: "linear-gradient(135deg, #FFFBEB, #FEF3C7)",
          border: "1.5px solid #FCD34D",
          borderRadius: 16,
          padding: "14px 18px",
          marginTop: "1rem",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "14px",
          boxShadow: "0 2px 8px rgba(245, 158, 11, 0.08)",
        }}
      >
        <span style={{ fontSize: "1.8rem", flexShrink: 0 }}>💡</span>
        <div>
          <h4 style={{ margin: "0 0 2px 0", fontSize: "0.95rem", fontWeight: 800, color: "#92400E" }}>
            Dica para Aumentar Vendas: Destaques da Casa
          </h4>
          <p style={{ margin: 0, fontSize: "0.84rem", color: "#B45309", lineHeight: 1.4 }}>
            Indique seus itens mais vendidos com a tag <strong>"⭐ Destaque"</strong>. Eles aparecerão no topo da vitrine do seu cardápio digital com fotos em destaque para incentivar seus clientes!
          </p>
        </div>
      </div>

      {products.length === 0 && user.role !== "ADMIN" ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem 1.5rem",
            background: "#fff",
            borderRadius: 16,
            boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
            marginTop: "1rem",
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>🍽️</div>
          <h2
            style={{
              fontSize: "1.2rem",
              fontWeight: 700,
              color: "#1E293B",
              margin: "0 0 0.5rem",
            }}
          >
            Seu cardápio está vazio
          </h2>
          <p style={{ color: "#64748b", fontSize: "0.95rem", margin: 0 }}>
            Adicione seus primeiros produtos clicando no botão abaixo.
          </p>
        </div>
      ) : null}

      <MenuProductManager products={products} availableItems={availableItems} categories={categories} />
    </div>
  );
}
