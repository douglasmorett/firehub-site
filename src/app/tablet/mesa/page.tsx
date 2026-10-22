/**
 * /tablet/mesa — o cardápio no tablet preso à mesa (lib/tablet-da-mesa).
 *
 * É o cardápio da MESA do QR (app/loja/[slug]/mesa/[codigo]): canal salão,
 * pedido direto na conta da mesa (api/loja/mesa/pedido, que reconhece o
 * cookie do tablet). Em volta, a faixa do tablet (TabletDaMesa.tsx).
 * A mesa vem do banco pelo cookie do tablet, nunca do endereço.
 */
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { propsDoCardapio, SELECT_DA_LOJA_NO_CARDAPIO } from "@/lib/cardapio-publico";
import { codigoDaMesa } from "@/lib/mesa-qr";
import { tabletEstaLigado } from "@/lib/tablet-da-mesa/assinatura";
import { tabletDaRequisicao } from "@/lib/tablet-da-mesa/no-tablet";
import TabletDaMesa from "./TabletDaMesa";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cardápio da mesa", robots: { index: false, follow: false } };

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#0B1220", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 440, textAlign: "center", background: "#fff", borderRadius: 22, padding: "2rem 1.5rem" }}>
        <div style={{ fontSize: 48 }} aria-hidden>🍽️</div>
        <h1 style={{ fontSize: "1.4rem", margin: "0.6rem 0 0.4rem", color: "#0F172A" }}>{titulo}</h1>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>{texto}</p>
      </div>
      {/* Volta sozinho quando a loja religar ou reativar a mesa. */}
      <meta httpEquiv="refresh" content="60" />
    </main>
  );
}

export default async function CardapioDoTablet() {
  const t = await tabletDaRequisicao();
  if (!t) redirect("/tablet");
  if (!(await tabletEstaLigado(t.lojaId))) return <Aviso titulo="Chame o garçom" texto="O pedido pelo tablet está desligado nesta loja agora." />;
  if (!t.mesa.ativa) return <Aviso titulo="Chame o garçom" texto={`A mesa ${t.mesa.numero} não está recebendo pedidos agora.`} />;

  const loja = await prisma.user.findUnique({ where: { id: t.lojaId }, select: SELECT_DA_LOJA_NO_CARDAPIO });
  if (!loja?.slug) return <Aviso titulo="Chame o garçom" texto="O cardápio desta loja não está disponível agora." />;

  const props = await propsDoCardapio(loja, "salao");
  return (
    <TabletDaMesa
      cardapio={props}
      mesa={{ codigo: codigoDaMesa(t.lojaId, t.mesa.id), mesaId: t.mesa.id, numero: t.mesa.numero, rotulo: t.mesa.rotulo }}
      nomeDaLoja={(loja as any).storeName || (loja as any).name || ""}
      logo={(loja as any).storeLogo || null}
    />
  );
}
