import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import ProductsClient from "@/components/ProductsClient";
import AdminSidebar from "@/components/AdminSidebar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insumos — FireHub Admin" };

/**
 * Cadastro de insumos da distribuidora — a tela que define o preço que o
 * cliente vê em iceboxdistribuidora.com.br.
 *
 * ── POR QUE ESTA ROTA PRECISOU EXISTIR ──────────────────────────────────────
 *
 * Ela morava em `hakim-portal.vercel.app/admin/products`, um deploy SEPARADO na
 * Vercel, apontando para o banco de antes da migração. O site que o cliente
 * acessa é este aqui, no Coolify, com outro banco. Resultado: todo reajuste
 * lançado no portal ficava invisível para quem compra.
 *
 * Medido em 28/08/2026, comparando o portal com o que o site servia de verdade:
 *
 *     Salsicha 5kg            51,90  =  51,90   ✓
 *     Pastel de Nata 48 und  144,00  = 144,00   ✓
 *     4 Queijos 3kg          168,90  → 134,70   ✗
 *     Queijo Temperado 3kg   152,70  → 116,70   ✗
 *     Queijo Mussarela Base  146,70  → 110,40   ✗
 *
 * Os três que divergiam eram os TRÊS QUEIJOS, todos por cerca de R$ 35: um
 * reajuste de queijo lançado no portal que nunca chegou ao cliente. O que não
 * mudou desde a migração continuava batendo — é a assinatura de dois bancos
 * que nasceram iguais e foram separando.
 *
 * O componente, o botão de excluir e as actions já estavam neste repositório e
 * não tinham chamador nenhum: faltava só a rota. Com ela, o preço que se edita
 * aqui é o mesmo que o cliente lê — não há como divergir de novo.
 */
export default async function AdminProductsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // Mesma guarda das actions de escrita (actions/product.ts): ADMIN, ou STAFF
  // com a permissão "products". Repetida aqui de propósito — a tela some para
  // quem não pode salvar, em vez de deixar a pessoa preencher e tomar erro.
  const role = (session.user as any)?.role;
  const perms = (session.user as any)?.permissions || "";
  if (role !== "ADMIN" && !(role === "STAFF" && hasPermission(perms, "products", role))) {
    redirect("/store");
  }

  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
  });

  // Mesma casca das outras telas do admin (orders): a sidebar já tinha o link
  // para /admin/products apontando para uma rota que não existia.
  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "var(--bg-body)" }}>
      <AdminSidebar />
      <main style={{ flex: 1, marginLeft: "250px", padding: "2rem" }} className="admin-main-content">
        <ProductsClient products={products} />
      </main>
    </div>
  );
}
