/**
 * /api/store/meu-aplicativo/clube — a aba Clube do Meu aplicativo.
 *
 * GET  → config, quem cobra (Asaas da loja pronto? / URL do webhook da Cakto),
 *        números do mês, sócio × não sócio e a lista de sócios.
 * POST { ativo, cobranca, valor, percentual, teto, nome, chamada, acumulaComCupom, linkDoCheckout, segredoDaCakto? }
 * POST { acao: "cancelar", assinanteId } → a loja cancela um sócio do Asaas.
 *
 * Só o dono (ou o ADMIN na loja que abriu) e só com o plano do app ligado —
 * a mesma porta da tela (lib/assessor/loja-da-sessao.ts). O clube é da marca:
 * mora na principal do grupo (`app.chave`), vale em todas as unidades, e a
 * mensalidade no cartão cai no Asaas dessa loja principal. O FireHub não cobra
 * nada pelo clube (faz parte do plano do app): sem split na mensalidade.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { appDaConta } from "@/lib/app-da-loja/instalacoes";
import {
  asaasProntoNaMarca,
  assinantePorId,
  assinantesDoClube,
  gravarClube,
  lerClube,
  mensalidadesPagasDesde,
  paraAssinatura,
  pedidosComTelefone,
  pedidosDoClube,
} from "@/lib/clube/no-banco";
import { lerConfigDoClube, linkDeCheckoutValido, problemaDaConfig, situacaoDaAssinatura } from "@/lib/clube/regras";
import { resumoDoMes, socioXNaoSocio } from "@/lib/clube/painel";
import { cancelarSocio } from "@/lib/clube/assinatura-asaas";
import { decifrar } from "@/lib/cofre";
import { garantirEventosNoWebhook } from "@/lib/asaas-da-loja";
import { consertarAvisosDaLoja } from "@/lib/pix-online-pedido";
import { naLoja } from "@/lib/relatorios/base";
import { inicioDoDiaOperacional } from "@/lib/numeros-do-inicio";

export const dynamic = "force-dynamic";

async function contexto() {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return { erro: NextResponse.json({ error: "Só o dono da loja abre o Meu aplicativo." }, { status: 403 }) };
  const app = await appDaConta(s.franchiseeId);
  if (!app?.ativo) return { erro: NextResponse.json({ error: "O aplicativo desta loja ainda não está ativo.", irPara: "/store/aplicativo" }, { status: 403 }) };
  return { s, app };
}

function urlDoWebhook(chave: string, segredo: string | null): string | null {
  // A Cakto só chama endereço público: fora de produção (http/localhost) mostra o do site.
  const doAmbiente = (process.env.NEXTAUTH_URL || "").trim().replace(/\/$/, "");
  const base = /^https:\/\//i.test(doAmbiente) && !/localhost|127\.0\.0\.1/.test(doAmbiente) ? doAmbiente : "https://firehubfood.com.br";
  if (!segredo) return null;
  return `${base}/api/webhooks/cakto-clube/${encodeURIComponent(chave)}?s=${encodeURIComponent(segredo)}`;
}

/** Telefone do assinante com o meio escondido: o painel identifica sem expor. */
function telefoneMascarado(t: string): string {
  const d = String(t || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length < 8) return d;
  return `(${d.slice(0, 2)}) ${d.length > 10 ? d.slice(2, 3) : ""}••••-${d.slice(-4)}`;
}

/** O Asaas da loja principal: conectado, de quem é a conta e se o aviso de pagamento está ligado. */
async function asaasDaMarca(chave: string) {
  const loja = await prisma.user.findUnique({ where: { id: chave }, select: { storeName: true, asaasChaveCifrada: true, asaasConexao: true } });
  const conexao = (loja?.asaasConexao as any) || {};
  return {
    pronto: await asaasProntoNaMarca(chave),
    conta: conexao.nome ? String(conexao.nome) : null,
    ambiente: conexao.ambiente === "sandbox" ? "sandbox" : conexao.ambiente === "producao" ? "producao" : null,
    avisoLigado: Boolean(conexao.webhookId),
    lojaDaConta: (loja?.storeName || "").trim() || null,
  };
}

async function resposta(app: { chave: string; tz: string | null; lojaIds: string[] }) {
  const { chave, tz } = app;
  const clube = await lerClube(chave);
  const agora = new Date();
  // O mês da loja (fuso dela, dia que vira às 5h — lib/relatorios/base.ts).
  const hoje = naLoja(agora, tz).dia;
  const primeiroDia = `${hoje.slice(0, 8)}01`;
  const desde = inicioDoDiaOperacional(primeiroDia, tz);
  const trintaDias = new Date(agora.getTime() - 30 * 86_400_000);
  const [lista, mes, mensalidades, asaas, pedidos] = await Promise.all([
    assinantesDoClube(chave),
    pedidosDoClube(chave, desde),
    mensalidadesPagasDesde(chave, primeiroDia),
    asaasDaMarca(chave),
    pedidosComTelefone(app.lojaIds, trintaDias).catch(() => []),
  ]);
  const assinantes = lista.map((a) => ({
    id: a.id,
    nome: a.nome || "Cliente",
    telefone: telefoneMascarado(a.telefone),
    telefoneFinal: String(a.telefone || "").replace(/\D/g, "").slice(-8),
    situacao: situacaoDaAssinatura(paraAssinatura(a), agora),
    cancelado: a.status === "CANCELADO",
    cobranca: a.cobranca,
    desde: a.desde,
    canceladoEm: a.canceladoEm,
    pagoAte: a.pagoAte,
    pagamentos: a.pagamentos,
    ultimoEvento: a.ultimoEvento,
  }));
  const resumo = resumoDoMes({ socios: assinantes, inicioDoMes: desde, mensalidades, descontoNoMes: mes.desconto });
  const ativos = new Set(assinantes.filter((a) => a.situacao === "ativo").map((a) => a.telefoneFinal));
  return {
    config: clube.config,
    asaas,
    webhookUrl: urlDoWebhook(chave, clube.segredoDaUrl),
    temSegredoDaCakto: clube.temSegredoDaCakto,
    numeros: {
      ...resumo,
      pendentes: resumo.semPagamento,
      encerrados: assinantes.filter((a) => a.situacao === "encerrado").length,
      // Cakto: a receita não chega ao FireHub; a estimativa é sócios × mensalidade.
      mensalidades: Math.round(resumo.ativos * clube.config.valor * 100) / 100,
      pedidosNoMes: mes.pedidos,
      descontoNoMes: Math.round(mes.desconto * 100) / 100,
      faturamentoNoMes: Math.round(mes.faturamento * 100) / 100,
    },
    comparacao: socioXNaoSocio(pedidos, ativos),
    assinantes: assinantes.map(({ telefoneFinal: _t, ...a }) => ({ ...a, podeCancelar: a.cobranca === "asaas" && !a.cancelado && a.situacao !== "encerrado" })),
  };
}

/** Clube no cartão ligado: o webhook da loja precisa dos eventos da assinatura. Devolve um aviso, ou null. */
async function garantirAvisosDoClube(chave: string): Promise<string | null> {
  const loja = await prisma.user.findUnique({ where: { id: chave }, select: { asaasChaveCifrada: true, asaasConexao: true } });
  const conexao = (loja?.asaasConexao as any) || {};
  const chaveDoAsaas = decifrar(loja?.asaasChaveCifrada);
  if (!chaveDoAsaas) return null;
  const r = conexao.webhookId ? await garantirEventosNoWebhook(chaveDoAsaas, conexao.webhookId) : "sumiu";
  if (r === "ok" || r === "atualizado") return null;
  const c = await consertarAvisosDaLoja(chave).catch(() => "falha" as const);
  return c === "falha" || c === "sem_chave"
    ? "O aviso automático do Asaas não foi ligado agora: o status dos sócios é conferido quando eles abrem o app. Tente salvar de novo mais tarde."
    : null;
}

export async function GET() {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  return NextResponse.json(await resposta(c.app));
}

export async function POST(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const body = await req.json().catch(() => ({}));

  if (body?.acao === "cancelar") {
    const socio = typeof body.assinanteId === "string" ? await assinantePorId(c.app.chave, body.assinanteId) : null;
    if (!socio) return NextResponse.json({ error: "Sócio não encontrado." }, { status: 404 });
    const r = await cancelarSocio(c.app.chave, socio, "loja");
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json(await resposta(c.app));
  }

  if (body.linkDoCheckout && !linkDeCheckoutValido(body.linkDoCheckout)) {
    return NextResponse.json({ error: "Cole o link do checkout da Cakto (https://pay.cakto.com.br/…)." }, { status: 400 });
  }
  const config = lerConfigDoClube(body);
  const asaasPronto = config.cobranca === "asaas" ? await asaasProntoNaMarca(c.app.chave) : false;
  const problema = problemaDaConfig(config, body, asaasPronto);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });
  try {
    await gravarClube(c.app.chave, config, {
      segredoDaCakto: typeof body.segredoDaCakto === "string" ? body.segredoDaCakto : undefined,
    });
    const aviso = config.ativo && config.cobranca === "asaas" ? await garantirAvisosDoClube(c.app.chave) : null;
    return NextResponse.json({ ...(await resposta(c.app)), aviso });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Não deu para salvar agora." }, { status: 500 });
  }
}
