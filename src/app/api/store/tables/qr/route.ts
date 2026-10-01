/**
 * GET /api/store/tables/qr — os links assinados dos QR Codes das mesas
 * (lib/mesa-qr.ts): um por mesa e o geral (o cliente escolhe a mesa).
 *
 * Só o painel: o código é a chave que deixa qualquer um com o celular pedir
 * na conta da mesa, e quem imprime o QR é a gestão, não o garçom pelo link.
 * O QR em si é desenhado na tela (a lib `qrcode` no navegador); aqui só sai
 * o caminho — o domínio é o `origin` de quem abriu o painel.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { caminhoDoQr, codigoDaMesa, codigoGeral } from "@/lib/mesa-qr";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (operador.tipo === "garcom") {
      return NextResponse.json({ error: "O QR Code das mesas é gerado pelo painel, não pelo acesso do garçom" }, { status: 403 });
    }
    const franchiseeId = operador.franchiseeId;

    const [loja, mesas] = await Promise.all([
      prisma.user.findUnique({ where: { id: franchiseeId }, select: { slug: true, storeName: true, name: true } }),
      prisma.table.findMany({
        where: { franchiseeId },
        orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
        select: { id: true, number: true, label: true, isActive: true },
      }),
    ]);
    if (!loja?.slug) {
      return NextResponse.json({ error: "A loja ainda não tem o endereço do cardápio. Configure em Minha Loja." }, { status: 409 });
    }

    return NextResponse.json({
      loja: loja.storeName || loja.name,
      geral: caminhoDoQr(loja.slug, codigoGeral(franchiseeId)),
      mesas: mesas.map((m) => ({
        id: m.id,
        numero: m.number,
        rotulo: m.label || null,
        ativa: m.isActive,
        caminho: caminhoDoQr(loja.slug!, codigoDaMesa(franchiseeId, m.id)),
      })),
    });
  } catch (err) {
    console.error("[Mesa QR] links:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
