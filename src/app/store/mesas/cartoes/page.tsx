/**
 * /store/mesas/cartoes?de=101&ate=300 — os cartões de comanda para imprimir
 * (lib/comanda.ts): tamanho de cartão de crédito (85,6 × 54 mm), número
 * grande e o código de barras Code 39 que o leitor USB lê.
 *
 * Na impressão só os cartões saem (o menu do painel some pelo CSS de print).
 */
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TIPO_COMANDA, barrasCode39 } from "@/lib/comanda";
import BotaoImprimir from "./BotaoImprimir";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub — Cartões de comanda" };

export default async function CartoesDeComanda({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) redirect("/login");
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  if (!u) redirect("/login");
  const franchiseeId = u.ownerId || u.id;
  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeName: true, name: true } });

  const { de, ate } = await searchParams;
  const min = Number(de) || 0;
  const max = Number(ate) || Number.MAX_SAFE_INTEGER;
  const comandas = await prisma.table.findMany({
    where: { franchiseeId, tipo: TIPO_COMANDA, number: { gte: min, lte: max } },
    select: { number: true },
    orderBy: { number: "asc" },
  });
  const nomeDaLoja = loja?.storeName || loja?.name || "";

  return (
    <div className="cartoes-de-comanda" style={{ padding: 16 }}>
      <style>{`
        .cartoes-grade { display: grid; grid-template-columns: repeat(auto-fill, 85.6mm); gap: 4mm; }
        .cartao { width: 85.6mm; height: 54mm; box-sizing: border-box; border: 0.3mm dashed #94A3B8; border-radius: 3mm;
          padding: 3mm 4mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
          background: #fff; color: #0F172A; break-inside: avoid; font-family: Arial, sans-serif; }
        @media print {
          @page { size: A4; margin: 8mm; }
          body * { visibility: hidden; }
          .cartoes-de-comanda, .cartoes-de-comanda * { visibility: visible; }
          .cartoes-de-comanda { position: absolute; left: 0; top: 0; padding: 0 !important; }
          .sem-impressao { display: none !important; }
        }
      `}</style>
      <div className="sem-impressao" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 18 }}>{comandas.length} cartões de comanda</strong>
        <BotaoImprimir />
        <span style={{ fontSize: 13, color: "#64748B" }}>A4, 8 por folha. Recorte na linha tracejada.</span>
      </div>
      {comandas.length === 0 ? (
        <p>Nenhum cartão nessa faixa. Cadastre em Mesas › ⚙️ › 🎫 Comandas.</p>
      ) : (
        <div className="cartoes-grade">
          {comandas.map(({ number }) => {
            const { barras, total } = barrasCode39(number);
            return (
              <div key={number} className="cartao">
                <div style={{ fontSize: "3.2mm", fontWeight: 700, letterSpacing: "0.3mm", textTransform: "uppercase" }}>{nomeDaLoja}</div>
                <div style={{ fontSize: "17mm", fontWeight: 900, lineHeight: 1 }}>{number}</div>
                <svg viewBox={`0 0 ${total} 10`} preserveAspectRatio="none" style={{ width: "62mm", height: "10mm" }} aria-label={`Código ${number}`}>
                  {barras.map((b, i) => <rect key={i} x={b.x} y={0} width={b.largura} height={10} fill="#000" />)}
                </svg>
                <div style={{ fontSize: "2.6mm", color: "#475569" }}>Comanda · não perca este cartão</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
