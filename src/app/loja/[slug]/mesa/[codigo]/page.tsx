/**
 * O cardápio da MESA — o que abre quando o cliente escaneia o QR colado na
 * mesa. Mesmo cardápio do site, com três diferenças:
 *  - o canal é o SALÃO: os produtos e os preços que o garçom lança;
 *  - o pedido não tem entrega, pagamento nem telefone: entra na conta da
 *    mesa e o garçom fecha no fim (api/loja/mesa/pedido);
 *  - a mesa vem do código assinado do link (lib/mesa-qr.ts), nunca de um
 *    número que o cliente possa trocar no endereço.
 *
 * Dinâmica (sem o cache de 60 s do /loja/[slug]): mesa desativada ou apagada
 * tem que parar de receber pedido na hora.
 */
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { slugAtualDeUmAntigo } from "@/lib/slug-da-loja";
import CustomerStorePage from "@/components/customer/CustomerStorePage";
import { propsDoCardapio, SELECT_DA_LOJA_NO_CARDAPIO } from "@/lib/cardapio-publico";
import { lerCodigo, valeParaALoja, valeParaAMesa } from "@/lib/mesa-qr";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

function QrQueNaoVale({ texto }: { texto: string }) {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F8FAFC", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 380, textAlign: "center", background: "#fff", borderRadius: 18, padding: "2rem 1.5rem", boxShadow: "0 8px 30px rgba(15,23,42,0.08)" }}>
        <div style={{ fontSize: 44 }} aria-hidden>🍽️</div>
        <h1 style={{ fontSize: "1.2rem", margin: "0.6rem 0 0.4rem", color: "#0F172A" }}>Este QR Code não está valendo</h1>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>{texto}</p>
      </div>
    </main>
  );
}

export default async function CardapioDaMesa({ params }: { params: Promise<{ slug: string; codigo: string }> }) {
  const { slug, codigo } = await params;
  const lido = lerCodigo(codigo);
  if (!lido) return <QrQueNaoVale texto="Chame o garçom para fazer o seu pedido." />;

  if (lido.tipo === "mesa") {
    const mesa = await prisma.table.findUnique({
      where: { id: lido.tableId },
      select: { id: true, number: true, label: true, isActive: true, franchiseeId: true },
    });
    if (!mesa || !valeParaAMesa(lido, mesa.franchiseeId)) {
      return <QrQueNaoVale texto="Chame o garçom para fazer o seu pedido." />;
    }
    const loja = await prisma.user.findUnique({ where: { id: mesa.franchiseeId }, select: SELECT_DA_LOJA_NO_CARDAPIO });
    if (!loja?.slug) return <QrQueNaoVale texto="Chame o garçom para fazer o seu pedido." />;
    // A loja é a da MESA, não a do link: o nome da loja mudou depois de o QR
    // ser impresso (ou alguém trocou o começo do endereço) — vai para o certo.
    if (loja.slug !== slug) redirect(`/loja/${loja.slug}/mesa/${codigo}`);
    if (!mesa.isActive) return <QrQueNaoVale texto={`A mesa ${mesa.number} não está recebendo pedidos agora. Chame o garçom.`} />;

    const props = await propsDoCardapio(loja, "salao");
    return (
      <CustomerStorePage
        {...props}
        mesa={{ codigo, mesaId: mesa.id, numero: mesa.number, rotulo: mesa.label || null, mesas: [] }}
      />
    );
  }

  // QR geral: a loja é a do link, e a assinatura tem que ser DELA.
  let loja = await prisma.user.findUnique({ where: { slug }, select: SELECT_DA_LOJA_NO_CARDAPIO });
  if (!loja) {
    const atual = await slugAtualDeUmAntigo(prisma as any, slug);
    if (atual) redirect(`/loja/${atual}/mesa/${codigo}`);
  }
  if (!loja || !valeParaALoja(lido, loja.id)) return <QrQueNaoVale texto="Chame o garçom para fazer o seu pedido." />;

  const mesas = await prisma.table.findMany({
    where: { franchiseeId: loja.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    select: { id: true, number: true, label: true },
  });
  if (mesas.length === 0) return <QrQueNaoVale texto="Esta loja ainda não cadastrou as mesas. Chame o garçom." />;

  const props = await propsDoCardapio(loja, "salao");
  return (
    <CustomerStorePage
      {...props}
      mesa={{ codigo, mesaId: null, numero: null, rotulo: null, mesas: mesas.map((m) => ({ id: m.id, numero: m.number, rotulo: m.label || null })) }}
    />
  );
}
