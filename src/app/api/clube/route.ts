/**
 * /api/clube — o Clube do aplicativo visto pelo cardápio.
 *
 * GET  ?loja=<id>  (header `x-sessao-cliente`: a sessão do login, lib/sessao-do-cliente.ts)
 *   → { clube: {nome, valor, percentual, teto, cobranca, acumulaComCupom, chamada} | null,
 *       cliente, situacao, pagoAte, cancelado, temCadastroNoAsaas }
 *   O cliente volta preenchido quando a sessão é válida: é assim que o login
 *   sobrevive a fechar e abrir o app. No clube do Asaas, quem não está em dia
 *   tem a assinatura relida no Asaas (voltou do checkout, cartão aceito numa
 *   nova tentativa) — lib/clube/assinatura-asaas.ts.
 * POST { loja, sessao, instalacao?, cpf? } → { checkout } — o link do
 *   pagamento: a Cakto com o cliente preenchido e o `callback`, ou o checkout
 *   recorrente do Asaas da loja (o cartão é digitado na página do Asaas).
 *   Só com login; no Asaas, só de dentro do app (instalação da marca).
 * POST { acao: "cancelar", loja, sessao } → { ok } — o sócio cancela no app
 *   (Asaas); o que já foi pago vale até acabar.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { lerSessaoDoCliente } from "@/lib/sessao-do-cliente";
import { finalDoTelefone } from "@/lib/pedidos-do-telefone";
import {
  assinanteDoTelefone,
  clubeValendoNaLoja,
  instalacaoDaMarca,
  paraAssinatura,
  prepararAssinatura,
} from "@/lib/clube/no-banco";
import { linkDoCheckoutDoCliente } from "@/lib/clube/cakto";
import { ehDoAplicativo, instalacaoDoCorpo, situacaoDaAssinatura } from "@/lib/clube/regras";
import { assinarNoAsaas, cancelarSocio, sincronizarSeVelho } from "@/lib/clube/assinatura-asaas";

export const dynamic = "force-dynamic";

async function clienteDaSessao(token: unknown) {
  const sessao = lerSessaoDoCliente(token);
  if (!sessao) return null;
  const c = await prisma.storeCustomer.findUnique({
    where: { id: sessao.clienteId },
    select: { id: true, name: true, phone: true, address: true, birthDate: true },
  });
  // Conta excluída ou telefone trocado: a sessão antiga deixa de valer.
  if (!c || finalDoTelefone(c.phone) !== finalDoTelefone(sessao.telefone)) return null;
  return c;
}

async function nomeDaLoja(lojaId: string): Promise<string> {
  const l = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeName: true, name: true } });
  return (l?.storeName || l?.name || "da loja").trim();
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`clube:${ip}`, { windowMs: 60_000, maxRequests: 30 }).allowed) {
    return NextResponse.json({ error: "Muitas consultas. Aguarde 1 minuto." }, { status: 429 });
  }
  const lojaId = req.nextUrl.searchParams.get("loja") || "";
  if (!lojaId) return NextResponse.json({ clube: null, cliente: null, situacao: "nao_assinante" });

  const [clube, cliente] = await Promise.all([
    clubeValendoNaLoja(lojaId),
    clienteDaSessao(req.headers.get("x-sessao-cliente")),
  ]);
  if (!clube) return NextResponse.json({ clube: null, cliente, situacao: "nao_assinante", pagoAte: null });

  let assinante = cliente ? await assinanteDoTelefone(clube.chave, cliente.phone) : null;
  if (assinante && clube.config.cobranca === "asaas") assinante = await sincronizarSeVelho(clube.chave, assinante);
  const situacao = assinante ? situacaoDaAssinatura(paraAssinatura(assinante)) : "nao_assinante";
  return NextResponse.json({
    clube: {
      nome: clube.config.nome || `Clube ${await nomeDaLoja(lojaId)}`,
      valor: clube.config.valor,
      percentual: clube.config.percentual,
      teto: clube.config.teto,
      cobranca: clube.config.cobranca,
      acumulaComCupom: clube.config.acumulaComCupom,
      chamada: clube.config.chamada,
    },
    cliente,
    situacao,
    pagoAte: assinante?.pagoAte ?? null,
    // Cancelou e ainda está no período pago: o app mostra "vale até…", sem o botão de cancelar.
    cancelado: assinante?.status === "CANCELADO",
    // Já tem o cadastro no Asaas da loja: não pede o CPF de novo.
    temCadastroNoAsaas: !!(assinante?.cobranca === "asaas" && assinante.asaasClienteId),
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`clube-assinar:${ip}`, { windowMs: 60_000, maxRequests: 10 }).allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const lojaId = typeof body?.loja === "string" ? body.loja : "";
  const cliente = await clienteDaSessao(body?.sessao);
  if (!cliente) return NextResponse.json({ error: "Entre na sua conta para assinar.", precisaEntrar: true }, { status: 401 });
  const clube = lojaId ? await clubeValendoNaLoja(lojaId) : null;
  if (!clube) return NextResponse.json({ error: "O clube não está disponível agora." }, { status: 404 });

  if (body?.acao === "cancelar") {
    const socio = await assinanteDoTelefone(clube.chave, cliente.phone);
    if (!socio) return NextResponse.json({ error: "Não achamos a sua assinatura." }, { status: 404 });
    const r = await cancelarSocio(clube.chave, socio, "cliente");
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  try {
    if (clube.config.cobranca === "asaas") {
      // O clube é do aplicativo: assinar também só de dentro dele (a mesma prova do pedido).
      const doApp = ehDoAplicativo(req.headers.get("user-agent")) && (await instalacaoDaMarca(clube.chave, instalacaoDoCorpo(body?.instalacao)));
      if (!doApp) return NextResponse.json({ error: "O clube é do aplicativo: assine pelo app da loja." }, { status: 403 });
      const r = await assinarNoAsaas(clube, cliente, {
        cpf: typeof body?.cpf === "string" ? body.cpf : null,
        lojaId,
        nomeDoClube: clube.config.nome || `Clube ${await nomeDaLoja(lojaId)}`,
      });
      if (!r.ok) return NextResponse.json({ error: r.erro, precisaCpf: r.precisaCpf || undefined, jaSocio: r.jaSocio || undefined }, { status: r.jaSocio ? 409 : 400 });
      return NextResponse.json({ checkout: r.checkout });
    }

    if (!clube.config.linkDoCheckout) return NextResponse.json({ error: "O clube não está disponível agora." }, { status: 404 });
    const assinante = await prepararAssinatura(clube.chave, { clienteId: cliente.id, telefone: cliente.phone, nome: cliente.name });
    const checkout = linkDoCheckoutDoCliente(clube.config.linkDoCheckout, {
      callback: assinante.callback,
      nome: cliente.name,
      telefone: cliente.phone,
    });
    return NextResponse.json({ checkout });
  } catch (e: any) {
    console.error("[Clube] assinar:", e?.message);
    return NextResponse.json({ error: "Não foi possível abrir a assinatura agora. Tente de novo." }, { status: 500 });
  }
}
