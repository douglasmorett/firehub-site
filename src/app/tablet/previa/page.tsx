/**
 * /tablet/previa — o cardápio do tablet como a mesa vê, para o dono montar
 * banners e recomendados na aba Tablet na mesa (EditorDaTelaDoTablet), que a
 * abre numa moldura e manda o rascunho por postMessage. Não envia pedido.
 *
 * Só o dono (a mesma porta da aba); a moldura é liberada só para esta rota e
 * só do próprio domínio (next.config.ts e proxy.ts).
 */
import { prisma } from "@/lib/prisma";
import { propsDoCardapio, SELECT_DA_LOJA_NO_CARDAPIO } from "@/lib/cardapio-publico";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { lerVitrine } from "@/lib/tablet-da-mesa/vitrine-no-banco";
import PreviaDoTablet from "./PreviaDoTablet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prévia do tablet", robots: { index: false, follow: false } };

export default async function PaginaDaPrevia() {
  const s = await lojaDoAssessorDaSessao();
  const loja = s ? await prisma.user.findUnique({ where: { id: s.franchiseeId }, select: SELECT_DA_LOJA_NO_CARDAPIO }) : null;
  if (!loja?.slug) {
    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#120D0A", color: "#fff", fontFamily: "system-ui, sans-serif" }}>Entre no painel da loja para ver a prévia.</main>;
  }
  const [cardapio, vitrine] = await Promise.all([propsDoCardapio(loja, "salao"), lerVitrine(loja.id)]);
  return <PreviaDoTablet cardapio={cardapio} vitrine={vitrine} />;
}
