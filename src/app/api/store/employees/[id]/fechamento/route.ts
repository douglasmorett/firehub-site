/**
 * O fiado do PERÍODO para a pessoa assinar (lib/comprovante-do-fiado.ts →
 * cupomDoFechamentoDoFiado). Pedido do Douglas e do Victor (19/11/2026): o
 * mês fechado do que a pessoa consumiu, com o total, o pendente e a aba de
 * assinatura.
 *
 *   POST { de?, ate?, impressora?, previa? }
 *        de/ate = dias puros (YYYY-MM-DD), ancorados no fuso da loja; vazios =
 *        todas as datas.
 *        previa: true → só devolve o cupom (a tela desenha o papel com o
 *        mesmo código do Assistente), nada vai para a fila.
 *        Sem prévia → fila do Assistente como papel de caixa (CAIXA_FIADO),
 *        na impressora escolhida (`impressoraAlvo`, só uma das cadastradas da
 *        loja) ou, sem escolha, na do caixa.
 *   GET  ?de=&ate= → o mesmo papel em HTML de bobina, para o navegador.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FUSO_PADRAO } from "@/lib/fuso";
import { limiteDeDia } from "@/lib/timezone";
import { cupomDoFechamentoDoFiado, htmlDoComprovanteDoFiado, periodoPorExtenso } from "@/lib/comprovante-do-fiado";
import { acessoAoFiado, fiadoDoPeriodo } from "@/lib/fiado-para-assinar";
import { enfileirarCupomDoCaixa, assistenteOuvindoAFila } from "@/lib/imprimir-caixa";
import type { CupomDoCaixa } from "@/lib/cupom-do-caixa";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

async function montarFechamento(email: string, employeeId: string, deBruto: unknown, ateBruto: unknown) {
  const acesso = await acessoAoFiado(email, employeeId);
  if (!acesso.ok) return { ok: false, erro: acesso.erro, status: acesso.status } as const;
  const dono = await prisma.user.findUnique({ where: { id: acesso.lojaId }, select: { storeName: true, storeTimezone: true, printerConfig: true } });
  const fuso = dono?.storeTimezone || FUSO_PADRAO;
  const de = dia(deBruto);
  const ate = dia(ateBruto);
  const { lancamentos, saldoTotal } = await fiadoDoPeriodo(acesso.cliente.id, limiteDeDia(de, fuso, "inicio"), limiteDeDia(ate, fuso, "fim"));
  const cupom = cupomDoFechamentoDoFiado({
    loja: dono?.storeName || "",
    fuso,
    operador: acesso.quem,
    cliente: { id: acesso.cliente.id, nome: acesso.cliente.name, cargo: acesso.cliente.role },
    periodo: periodoPorExtenso(de, ate),
    lancamentos,
    saldoTotal,
  });
  const printers: any[] = Array.isArray((dono?.printerConfig as any)?.printers) ? (dono!.printerConfig as any).printers : [];
  const soma = (f: (l: (typeof lancamentos)[number]) => number) => Math.round(lancamentos.reduce((s, l) => s + Math.round(f(l) * 100), 0)) / 100;
  const resumo = { periodo: periodoPorExtenso(de, ate), qtd: lancamentos.length, consumo: soma((l) => l.valor), pendente: soma((l) => l.restante), saldoTotal };
  return { ok: true, cupom, acesso, loja: dono?.storeName || "", printers, resumo } as const;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));

  const r = await montarFechamento(session.user.email, id, body?.de, body?.ate);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
  if (body?.previa === true) return NextResponse.json({ ok: true, cupom: r.cupom, loja: r.loja, resumo: r.resumo });

  // Só uma impressora cadastrada da loja (o nome vem do navegador).
  const impressora = typeof body?.impressora === "string" ? body.impressora.trim() : "";
  if (impressora && !r.printers.some((p) => String(p?.name || "").trim() === impressora)) {
    return NextResponse.json({ error: "Essa impressora não está cadastrada na loja." }, { status: 400 });
  }
  // `impressoraAlvo` viaja no payload: o print-queue manda o papel do caixa para ela.
  const cupom: CupomDoCaixa & { impressoraAlvo?: string } = impressora ? { ...r.cupom, impressoraAlvo: impressora } : r.cupom;
  const ok = await enfileirarCupomDoCaixa(r.acesso.lojaId, cupom, r.acesso.quem);
  if (!ok) return NextResponse.json({ error: "Não consegui enviar para a impressora." }, { status: 500 });
  return NextResponse.json({ ok: true, assistenteOuvindo: await assistenteOuvindoAFila(r.acesso.lojaId) });
}

const pagina = (status: number, texto: string) =>
  new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Fiado do período</title></head>` +
      `<body style="font-family:Arial,sans-serif;padding:24px;color:#111">${texto}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } }
  );

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return pagina(401, "Entre no FireHub para imprimir o fiado.");
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const r = await montarFechamento(session.user.email, id, sp.get("de"), sp.get("ate"));
  // O texto do erro é nosso (acessoAoFiado), não vem do navegador.
  if (!r.ok) return pagina(r.status, r.erro);
  return new NextResponse(htmlDoComprovanteDoFiado(r.cupom, { loja: r.loja }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
