import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderByCardapio } from "@/lib/menu-order";
import { SEM_ESPELHO } from "@/lib/espelho-de-integracao";
import { lojaDoCardapioDaSessao } from "@/lib/loja-do-cardapio";
import BotaoCopiar from "./BotaoCopiar";

export const dynamic = "force-dynamic";

/**
 * "Código PDV": o número de cada produto da loja (`MenuProduct.codigoPDV`),
 * listado por categoria na ordem do cardápio — o mesmo desenho da aba "PDV"
 * do Portal do Parceiro do iFood, onde o lojista digita esse número. O pedido
 * volta com ele em `externalCode` e entra ligado ao produto certo
 * (lib/espelho-de-integracao.ts, `produtoRealDoItem`).
 */

type Produto = { id: string; name: string; imageUrl: string | null; category: string; codigoPDV: number | null; apenasEmCombo: boolean };

export default async function CodigoPDVPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session) redirect("/login");

  const lojaId = await lojaDoCardapioDaSessao();

  let produtos: Produto[] = [];
  let categorias: { name: string }[] = [];
  if (lojaId) {
    try {
      [produtos, categorias] = await Promise.all([
        prisma.menuProduct.findMany({
          where: { franchiseeId: lojaId, ...SEM_ESPELHO },
          select: { id: true, name: true, imageUrl: true, category: true, codigoPDV: true, apenasEmCombo: true },
          orderBy: await orderByCardapio(),
        }),
        prisma.menuCategory.findMany({
          where: { franchiseeId: lojaId },
          select: { name: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
      ]);
    } catch (err) {
      console.error("[CodigoPDV] Erro ao buscar produtos:", err);
    }
  }

  // Categorias na ordem do cardápio; produto cuja categoria não está cadastrada
  // em MenuCategory vai no fim, para não sumir. Complementos ficam numa seção só.
  const avulsos = produtos.filter((p) => !p.apenasEmCombo);
  const complementos = produtos.filter((p) => p.apenasEmCombo);
  const nomes = categorias.map((c) => c.name);
  const foraDaOrdem = [...new Set(avulsos.map((p) => p.category).filter((c) => !nomes.includes(c)))];
  const secoes = [...nomes, ...foraDaOrdem]
    .map((nome) => ({ nome, itens: avulsos.filter((p) => p.category === nome) }))
    .filter((s) => s.itens.length > 0);
  if (complementos.length) secoes.push({ nome: "Complementos (opções das perguntas)", itens: complementos });

  return (
    <div className="container" style={{ marginTop: "1.5rem", maxWidth: 820 }}>
      <Link href="/store/cardapio" className="text-muted" style={{ fontSize: "0.85rem", textDecoration: "none" }}>
        ← Voltar ao cardápio
      </Link>
      <h1 className="font-bold" style={{ fontSize: "1.8rem", margin: "0.5rem 0 0" }}>🔢 Código PDV</h1>
      <p className="text-muted" style={{ margin: "6px 0 1.5rem", maxWidth: 640, lineHeight: 1.5 }}>
        É o número de cada item na sua loja. Digite ele no campo Código PDV do iFood (aba PDV do cardápio) e o pedido já
        entra ligado ao produto certo, sem item repetido.
      </p>

      {!lojaId && <p className="text-muted">Escolha uma loja para ver os códigos.</p>}
      {lojaId && secoes.length === 0 && <p className="text-muted">Nenhum produto cadastrado ainda.</p>}

      {secoes.map((secao) => (
        <section key={secao.nome} style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 800, color: "#0F172A", margin: "0 0 0.5rem", textTransform: "uppercase", letterSpacing: 0.4 }}>
            {secao.nome}
          </h2>
          <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, background: "#FFF", overflow: "hidden" }}>
            {secao.itens.map((p, i) => (
              <div
                key={p.id}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderTop: i ? "1px solid #F1F5F9" : "none" }}
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: "#F1F5F9", flexShrink: 0 }} />
                )}
                <span style={{ flex: 1, fontWeight: 600, color: "#1E293B", fontSize: "0.92rem", minWidth: 0 }}>{p.name}</span>
                <span style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "1.15rem", fontWeight: 800, color: p.codigoPDV == null ? "#94A3B8" : "#0F172A", minWidth: 48, textAlign: "right" }}>
                  {p.codigoPDV ?? "—"}
                </span>
                {p.codigoPDV != null && <BotaoCopiar texto={String(p.codigoPDV)} />}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
