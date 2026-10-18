/**
 * /api/store/meu-aplicativo/clube — a aba Clube do Meu aplicativo.
 *
 * GET  → config, a URL do webhook para colar na Cakto, números do mês e assinantes.
 * POST { ativo, valor, percentual, teto, linkDoCheckout, nome, segredoDaCakto? }
 *
 * Só o dono (ou o ADMIN na loja que abriu) e só com o plano do app ligado —
 * a mesma porta da tela (lib/assessor/loja-da-sessao.ts). O clube é da marca:
 * mora na principal do grupo (`app.chave`), vale em todas as unidades.
 */
import { NextRequest, NextResponse } from "next/server";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { appDaConta } from "@/lib/app-da-loja/instalacoes";
import { assinantesDoClube, gravarClube, lerClube, paraAssinatura, pedidosDoClube } from "@/lib/clube/no-banco";
import { lerConfigDoClube, linkDeCheckoutValido, situacaoDaAssinatura } from "@/lib/clube/regras";
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

async function resposta(chave: string, tz: string | null) {
  const clube = await lerClube(chave);
  const agora = new Date();
  // O mês da loja (fuso dela, dia que vira às 5h — lib/relatorios/base.ts).
  const hoje = naLoja(agora, tz).dia;
  const desde = inicioDoDiaOperacional(`${hoje.slice(0, 8)}01`, tz);
  const [lista, mes] = await Promise.all([assinantesDoClube(chave), pedidosDoClube(chave, desde)]);
  const assinantes = lista.map((a) => ({
    id: a.id,
    nome: a.nome || "Cliente",
    telefone: telefoneMascarado(a.telefone),
    situacao: situacaoDaAssinatura(paraAssinatura(a), agora),
    desde: a.desde,
    pagoAte: a.pagoAte,
    pagamentos: a.pagamentos,
    ultimoEvento: a.ultimoEvento,
  }));
  const ativos = assinantes.filter((a) => a.situacao === "ativo").length;
  return {
    config: clube.config,
    webhookUrl: urlDoWebhook(chave, clube.segredoDaUrl),
    temSegredoDaCakto: clube.temSegredoDaCakto,
    numeros: {
      ativos,
      pendentes: assinantes.filter((a) => a.situacao === "pendente").length,
      encerrados: assinantes.filter((a) => a.situacao === "encerrado").length,
      mensalidades: Math.round(ativos * clube.config.valor * 100) / 100,
      pedidosNoMes: mes.pedidos,
      descontoNoMes: Math.round(mes.desconto * 100) / 100,
      faturamentoNoMes: Math.round(mes.faturamento * 100) / 100,
    },
    assinantes,
  };
}

export async function GET() {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  return NextResponse.json(await resposta(c.app.chave, c.app.tz));
}

export async function POST(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const body = await req.json().catch(() => ({}));
  if (body.linkDoCheckout && !linkDeCheckoutValido(body.linkDoCheckout)) {
    return NextResponse.json({ error: "Cole o link do checkout da Cakto (https://pay.cakto.com.br/…)." }, { status: 400 });
  }
  const config = lerConfigDoClube(body);
  if (config.ativo && !config.linkDoCheckout) {
    return NextResponse.json({ error: "Para ligar o clube, cole antes o link do checkout da assinatura na Cakto." }, { status: 400 });
  }
  try {
    await gravarClube(c.app.chave, config, {
      segredoDaCakto: typeof body.segredoDaCakto === "string" ? body.segredoDaCakto : undefined,
    });
    return NextResponse.json(await resposta(c.app.chave, c.app.tz));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Não deu para salvar agora." }, { status: 500 });
  }
}
