/**
 * O comprovante do fiado para o cliente assinar (lib/comprovante-do-fiado.ts).
 *
 *   POST { alvo: "PEDIDO" | "MESA", alvoId, segundaVia? }
 *        → manda para a fila do Assistente (impressora do caixa), como a
 *          sangria. Responde `assistenteOuvindo` para a tela não dizer
 *          "enviado" quando ninguém puxa a fila.
 *   GET  ?alvo=&alvoId=
 *        → o mesmo papel em HTML de bobina, com o desenho da assinatura feita
 *          na tela, e a janela de impressão do navegador abrindo sozinha —
 *          para a loja sem Assistente (tablet, celular) e para o desenho, que
 *          o papel térmico da fila não leva.
 *
 * O papel é REMONTADO do banco a cada impressão (como a 2ª via do caixa): o
 * saldo é o de agora, e a reimpressão nunca diverge do que está gravado.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FUSO_PADRAO } from "@/lib/fuso";
import { cupomDoFiado, htmlDoComprovanteDoFiado } from "@/lib/comprovante-do-fiado";
import { acessoAoFiado, assinaturasDosLancamentos, lancamentoDoFiado, lerAlvo, saldoDoClienteDoFiado } from "@/lib/fiado-para-assinar";
import { enfileirarCupomDoCaixa, assistenteOuvindoAFila } from "@/lib/imprimir-caixa";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Monta o cupom do lançamento pedido. Erro já vem com status e texto. */
async function montarComprovante(email: string, employeeId: string, alvoBruto: unknown, alvoIdBruto: unknown, o: { segundaVia: boolean; comImagem: boolean }) {
  const acesso = await acessoAoFiado(email, employeeId);
  if (!acesso.ok) return { ok: false, erro: acesso.erro, status: acesso.status } as const;
  const alvo = lerAlvo(alvoBruto);
  const alvoId = String(alvoIdBruto || "").trim();
  if (!alvo || !alvoId) return { ok: false, erro: "Informe qual lançamento do fiado imprimir.", status: 400 } as const;

  const lancamento = await lancamentoDoFiado(acesso.cliente.id, alvo, alvoId);
  if (!lancamento) return { ok: false, erro: "Lançamento do fiado não encontrado.", status: 404 } as const;

  const [dono, saldo, assinaturas] = await Promise.all([
    prisma.user.findUnique({ where: { id: acesso.lojaId }, select: { storeName: true, storeTimezone: true } }),
    saldoDoClienteDoFiado(acesso.cliente.id),
    assinaturasDosLancamentos([alvoId], o.comImagem),
  ]);
  const assinatura = assinaturas.get(alvoId) || null;
  const cupom = cupomDoFiado({
    loja: dono?.storeName || "",
    fuso: dono?.storeTimezone || FUSO_PADRAO,
    operador: acesso.quem,
    cliente: { nome: acesso.cliente.name, cargo: acesso.cliente.role },
    lancamento,
    saldo,
    assinatura: assinatura ? { nome: assinatura.nome, em: assinatura.createdAt } : null,
    segundaVia: o.segundaVia,
  });
  return { ok: true, cupom, acesso, loja: dono?.storeName || "", imagem: assinatura?.imagem || null } as const;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));

  // O papel térmico não leva o desenho: a imagem nem sai do banco.
  const r = await montarComprovante(session.user.email, id, body?.alvo, body?.alvoId, { segundaVia: body?.segundaVia === true, comImagem: false });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });

  const ok = await enfileirarCupomDoCaixa(r.acesso.lojaId, r.cupom, r.acesso.quem);
  if (!ok) return NextResponse.json({ error: "Não consegui enviar para a impressora." }, { status: 500 });
  return NextResponse.json({ ok: true, assistenteOuvindo: await assistenteOuvindoAFila(r.acesso.lojaId) });
}

const pagina = (status: number, texto: string) =>
  new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovante de fiado</title></head>` +
      `<body style="font-family:Arial,sans-serif;padding:24px;color:#111">${texto}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } }
  );

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return pagina(401, "Entre no FireHub para imprimir o comprovante.");
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const r = await montarComprovante(session.user.email, id, sp.get("alvo"), sp.get("alvoId"), { segundaVia: sp.get("segundaVia") === "1", comImagem: true });
  // O texto do erro é nosso (montarComprovante), não vem do navegador.
  if (!r.ok) return pagina(r.status, r.erro);
  return new NextResponse(htmlDoComprovanteDoFiado(r.cupom, { loja: r.loja, imagemDaAssinatura: r.imagem }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
