/**
 * /api/store/asaas — a conexão da conta Asaas DA LOJA (Pix e cartão pelo site).
 * A tela é Integrações → Asaas (components/customer/PagamentoOnlineAsaas.tsx).
 *
 *   GET                      estado da conexão (?verificar=1 relê a conta no Asaas)
 *   POST { acao: "conectar", chave, aceitouRegras }
 *   POST { acao: "ativar" | "desativar", forma: "pix" | "cartao" }
 *   POST { acao: "verificar" }
 *   DELETE                   desconecta (tira o webhook, apaga a chave)
 *
 * Só o titular da loja conecta, liga ou desconecta: é a conta bancária dele.
 * Funcionário (STAFF) vê o estado e nada mais — a regra do fiscal
 * (api/store/fiscal, CAMPOS_DO_TITULAR).
 *
 * A chave nunca volta para a tela. Ela é cifrada (lib/cofre.ts) antes de ir
 * ao banco e só é aberta no servidor, na hora de falar com o Asaas.
 */
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/cofre";
import {
  ambienteDaChave,
  criarChavePixAleatoria,
  criarWebhookNaLoja,
  lerContaDoAsaas,
  mesmoDominio,
  normalizarChave,
  removerWebhookDaLoja,
  walletDoFireHub,
  type ContaDoAsaas,
} from "@/lib/asaas-da-loja";
import {
  mensagemDePixOnlineAtivado,
  SPLIT_FIREHUB_PERCENTUAL,
  VERSAO_DAS_REGRAS,
  type FormaOnline,
} from "@/lib/pix-online";
import { cardapioDaLoja, siteDoFireHub, type ConexaoAsaas } from "@/lib/pix-online-pedido";
import { avisarDono } from "@/lib/alertas-do-dono";

export const dynamic = "force-dynamic";

async function quemPede() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, name: true, email: true },
  });
  if (!user) return null;
  return { ...user, lojaId: user.ownerId || user.id, titular: user.role !== "STAFF" };
}

/** Chave de Sandbox em produção geraria QR que banco nenhum paga. */
function sandboxPermitido(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ASAAS_PERMITIR_SANDBOX === "true";
}

/** Onde o Asaas da loja vai avisar. Sem endereço público, sem webhook. */
function urlDoWebhook(lojaId: string): string | null {
  const base = (process.env.ASAAS_WEBHOOK_BASE_URL || process.env.NEXTAUTH_URL || "").trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(base)) return null;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(base)) return null;
  return `${base}/api/webhooks/asaas-loja/${lojaId}`;
}

const mascararDocumento = (doc?: string | null) => {
  const d = String(doc || "").replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  return d || null;
};

/** O que a tela mostra. Nada de segredo aqui. */
async function estadoDaLoja(lojaId: string, titular: boolean, contaAoVivo?: ContaDoAsaas | null) {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { pixOnlineAtivo: true, cartaoOnlineAtivo: true, asaasChaveCifrada: true, asaasConexao: true, notificationPhone: true, slug: true },
  });
  const conexao = ((loja?.asaasConexao as any) || {}) as ConexaoAsaas;
  // O site dos dados comerciais decide se o cartão volta sozinho ao cardápio.
  const site = contaAoVivo ? contaAoVivo.site : conexao.site ?? null;
  const conectado = Boolean(loja?.asaasChaveCifrada);
  const pixAtivo = Boolean(loja?.pixOnlineAtivo) && conectado;
  const cartaoAtivo = Boolean(loja?.cartaoOnlineAtivo) && conectado;
  // A loja que conecta a MESMA conta Asaas que recebe pelo FireHub não tem
  // split (o Asaas não divide com a própria conta). A tela diz isso.
  const carteiraDoFireHub = conectado && conexao.walletId ? await walletDoFireHub(conexao.ambiente || "producao", null).catch(() => null) : null;
  const mesmaContaDoFireHub = Boolean(carteiraDoFireHub && carteiraDoFireHub === conexao.walletId);

  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const pagos = conectado
    ? await prisma.customerOrder.aggregate({
        where: {
          franchiseeId: lojaId,
          gatewayProvider: "asaas",
          paymentPaidAt: { not: null },
          status: { not: "CANCELADO" },
          createdAt: { gte: desde },
        },
        _count: { _all: true },
        _sum: { totalAmount: true },
      })
    : null;

  return {
    conectado,
    ativo: pixAtivo || cartaoAtivo,
    pixAtivo,
    cartaoAtivo,
    mesmaContaDoFireHub,
    podeEditar: titular,
    splitPercentual: SPLIT_FIREHUB_PERCENTUAL,
    versaoDasRegras: VERSAO_DAS_REGRAS,
    avisosNoWhatsApp: String(loja?.notificationPhone || "").replace(/\D/g, "").length >= 10,
    conta: conectado
      ? {
          nome: contaAoVivo?.nome || conexao.nome || "Conta Asaas",
          documento: mascararDocumento(contaAoVivo?.cpfCnpj ?? conexao.cpfCnpj),
          ambiente: conexao.ambiente || "producao",
          situacao: contaAoVivo?.situacao || conexao.situacao || "DESCONHECIDA",
          pendenciasDoCadastro: contaAoVivo?.pendenciasDoCadastro || [],
          chavePix: contaAoVivo ? contaAoVivo.chavesPixAtivas[0]?.chave || null : conexao.chavePix || null,
          avisosDePagamento: Boolean(conexao.webhookId),
          conectadoEm: conexao.conectadoEm || null,
          regrasAceitasEm: conexao.regrasAceitasEm || null,
          versaoDasRegrasAceita: conexao.versaoDasRegras || null,
          verificadoEm: conexao.verificadoEm || null,
          desligadoMotivo: pixAtivo || cartaoAtivo ? null : conexao.desligadoMotivo || null,
          // Cartão: o Asaas só devolve o cliente ao cardápio se o site da conta
          // for do domínio do FireHub. `siteParaCadastrar` é o que a tela sugere.
          site,
          cartaoVoltaSozinho: mesmoDominio(site, siteDoFireHub()),
          siteParaCadastrar: loja?.slug ? cardapioDaLoja(loja.slug) : siteDoFireHub(),
        }
      : null,
    ultimos30Dias: pagos ? { pedidos: pagos._count._all, total: pagos._sum.totalAmount || 0 } : null,
  };
}

/** Relê a conta no Asaas e grava o que mudou. */
async function releConta(lojaId: string) {
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { asaasChaveCifrada: true, asaasConexao: true } });
  const chave = decifrar(loja?.asaasChaveCifrada);
  if (!chave) return { chave: null, conta: null, erro: "A conta Asaas não está conectada." };
  const r = await lerContaDoAsaas(chave);
  if (!r.ok || !r.dados) return { chave, conta: null, erro: r.erro, status: r.status };
  const conexao = {
    ...((loja?.asaasConexao as any) || {}),
    nome: r.dados.nome,
    cpfCnpj: r.dados.cpfCnpj,
    walletId: r.dados.walletId,
    situacao: r.dados.situacao,
    chavePix: r.dados.chavesPixAtivas[0]?.chave || null,
    site: r.dados.site,
    verificadoEm: new Date().toISOString(),
  };
  await prisma.user.update({ where: { id: lojaId }, data: { asaasConexao: conexao } });
  return { chave, conta: r.dados, erro: null };
}

/** O que falta para a forma poder ir ao cardápio. Vazio = pode. */
function oQueFalta(conta: ContaDoAsaas, forma: FormaOnline): string[] {
  const falta: string[] = [];
  if (conta.situacao !== "APPROVED") {
    falta.push(
      conta.pendenciasDoCadastro.length
        ? `A conta Asaas ainda não está aprovada (${conta.pendenciasDoCadastro.join("; ")}).`
        : "A conta Asaas ainda não está aprovada. Termine o cadastro e envie os documentos no Asaas.",
    );
  }
  if (!conta.walletId) falta.push("O Asaas não informou a carteira da conta.");
  if (forma === "pix" && conta.chavesPixAtivas.length === 0) {
    falta.push("A conta Asaas não tem chave Pix ativa. Cadastre uma em Pix → Minhas chaves (ou reconecte para o FireHub criar uma).");
  }
  return falta;
}

/** Liga as formas pedidas e manda o resumo das regras no WhatsApp do dono. */
async function ligar(lojaId: string, conta: ContaDoAsaas, formas: { pix?: boolean; cartao?: boolean }) {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { storeName: true, asaasConexao: true, pixOnlineAtivo: true, cartaoOnlineAtivo: true },
  });
  const conexao = { ...((loja?.asaasConexao as any) || {}), desligadoEm: null, desligadoMotivo: null };
  const pix = formas.pix ?? Boolean(loja?.pixOnlineAtivo);
  const cartao = formas.cartao ?? Boolean(loja?.cartaoOnlineAtivo);
  await prisma.user.update({ where: { id: lojaId }, data: { pixOnlineAtivo: pix, cartaoOnlineAtivo: cartao, asaasConexao: conexao } });
  await avisarDono(lojaId, "pix_online", mensagemDePixOnlineAtivado(loja?.storeName || "sua loja", conta.nome, { pix, cartao })).catch(() => false);
}

export async function GET(req: NextRequest) {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let contaAoVivo: ContaDoAsaas | null = null;
  let aviso: string | null = null;
  if (req.nextUrl.searchParams.get("verificar") === "1") {
    const r = await releConta(quem.lojaId);
    contaAoVivo = r.conta;
    aviso = r.erro || null;
  }
  return NextResponse.json({ ...(await estadoDaLoja(quem.lojaId, quem.titular, contaAoVivo)), aviso });
}

export async function POST(req: NextRequest) {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!quem.titular) {
    return NextResponse.json({ error: "Só o titular da loja pode mexer na conta Asaas." }, { status: 403 });
  }

  const corpo = await req.json().catch(() => ({} as any));
  const acao = String(corpo?.acao || "");
  const lojaId = quem.lojaId;

  // ── CONECTAR ─────────────────────────────────────────────────────────────
  if (acao === "conectar") {
    if (corpo?.aceitouRegras !== true) {
      return NextResponse.json({ error: "Leia e aceite as regras do pagamento pelo site antes de conectar." }, { status: 400 });
    }
    const chave = normalizarChave(corpo?.chave);
    if (!chave) {
      return NextResponse.json(
        { error: "Essa não parece uma chave de API do Asaas. Ela começa com $aact_ e é bem longa — copie a chave inteira." },
        { status: 400 },
      );
    }
    const ambiente = ambienteDaChave(chave);
    if (ambiente === "sandbox" && !sandboxPermitido()) {
      return NextResponse.json(
        { error: "Essa é uma chave de TESTE (Sandbox). Gere a chave na sua conta de verdade, em asaas.com → Integrações → Chaves de API." },
        { status: 400 },
      );
    }

    const lida = await lerContaDoAsaas(chave);
    if (!lida.ok || !lida.dados) {
      return NextResponse.json({ error: `Não foi possível abrir a conta com essa chave: ${lida.erro}` }, { status: 400 });
    }
    let conta = lida.dados;

    // Chave Pix: a API só cria a aleatória, e só em conta aprovada.
    let chavePixCriada = false;
    if (conta.chavesPixAtivas.length === 0 && conta.situacao === "APPROVED") {
      const criada = await criarChavePixAleatoria(chave);
      if (criada.ok) {
        chavePixCriada = true;
        const denovo = await lerContaDoAsaas(chave);
        if (denovo.ok && denovo.dados) conta = denovo.dados;
        if (conta.chavesPixAtivas.length === 0 && criada.dados?.key) {
          conta = { ...conta, chavesPixAtivas: [{ tipo: "EVP", chave: String(criada.dados.key) }] };
        }
      }
    }

    // Conexão anterior: tira o webhook velho (com a chave velha) antes.
    const anterior = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { asaasChaveCifrada: true, asaasConexao: true, email: true },
    });
    const conexaoAnterior = ((anterior?.asaasConexao as any) || {}) as ConexaoAsaas;
    const chaveAnterior = decifrar(anterior?.asaasChaveCifrada);
    if (chaveAnterior && conexaoAnterior.webhookId) {
      await removerWebhookDaLoja(chaveAnterior, conexaoAnterior.webhookId).catch(() => null);
    }

    // Webhook com token só desta loja.
    let webhookId: string | null = null;
    let webhookTokenCifrado: string | null = null;
    let avisoDoWebhook: string | null = null;
    const url = urlDoWebhook(lojaId);
    if (url) {
      const token = crypto.randomBytes(32).toString("base64url");
      const w = await criarWebhookNaLoja(chave, {
        url,
        email: (process.env.ASAAS_WEBHOOK_EMAIL || anterior?.email || quem.email || "").trim(),
        authToken: token,
      });
      if (w.ok && w.dados?.id) {
        webhookId = w.dados.id;
        webhookTokenCifrado = cifrar(token);
      } else {
        avisoDoWebhook =
          `O aviso automático de pagamento não foi ligado no Asaas (${w.erro}). O pagamento funciona assim mesmo: ` +
          "o FireHub confere o pagamento pela tela do cliente e a cada 2 minutos.";
      }
    } else {
      avisoDoWebhook = "Servidor sem endereço público: o aviso automático de pagamento não foi ligado (ambiente de teste).";
    }

    const agora = new Date().toISOString();
    const conexao: ConexaoAsaas = {
      ambiente,
      walletId: conta.walletId,
      nome: conta.nome,
      cpfCnpj: conta.cpfCnpj,
      situacao: conta.situacao,
      chavePix: conta.chavesPixAtivas[0]?.chave || null,
      site: conta.site,
      webhookId,
      webhookTokenCifrado,
      webhookUrl: webhookId ? url : null,
      conectadoEm: agora,
      conectadoPor: quem.name || quem.email || quem.id,
      regrasAceitasEm: agora,
      versaoDasRegras: VERSAO_DAS_REGRAS,
      verificadoEm: agora,
      desligadoEm: null,
      desligadoMotivo: null,
    };
    await prisma.user.update({
      where: { id: lojaId },
      data: { asaasChaveCifrada: cifrar(chave), asaasConexao: conexao as any, pixOnlineAtivo: false, cartaoOnlineAtivo: false },
    });

    // Tudo certo → Pix e cartão já vão para o cardápio (cada um desliga
    // depois, se a loja quiser). Faltando algo, conecta e diz o quê.
    const faltaPix = oQueFalta(conta, "pix");
    const faltaCartao = oQueFalta(conta, "cartao");
    const liga = { pix: faltaPix.length === 0, cartao: faltaCartao.length === 0 };
    if (liga.pix || liga.cartao) await ligar(lojaId, conta, liga);
    const falta = Array.from(new Set([...faltaPix, ...faltaCartao]));

    return NextResponse.json({
      ...(await estadoDaLoja(lojaId, true, conta)),
      ligadoAgora: liga.pix || liga.cartao,
      falta,
      chavePixCriada,
      aviso: avisoDoWebhook,
    });
  }

  // ── LIGAR / DESLIGAR / VERIFICAR ─────────────────────────────────────────
  if (acao === "ativar" || acao === "verificar") {
    const r = await releConta(lojaId);
    if (!r.conta) {
      if (r.status === 401) {
        const { desligarPixOnline } = await import("@/lib/pix-online-pedido");
        await desligarPixOnline(lojaId, "O Asaas recusou a chave de API da loja (desativada, expirada ou excluída).");
      }
      return NextResponse.json({ ...(await estadoDaLoja(lojaId, true)), error: r.erro }, { status: 400 });
    }
    if (acao === "verificar") return NextResponse.json(await estadoDaLoja(lojaId, true, r.conta));

    const forma: FormaOnline = corpo?.forma === "cartao" ? "cartao" : "pix";
    const falta = oQueFalta(r.conta, forma);
    if (falta.length > 0) {
      return NextResponse.json({ ...(await estadoDaLoja(lojaId, true, r.conta)), falta, error: falta.join(" ") }, { status: 400 });
    }
    await ligar(lojaId, r.conta, forma === "cartao" ? { cartao: true } : { pix: true });
    return NextResponse.json({ ...(await estadoDaLoja(lojaId, true, r.conta)), ligadoAgora: true });
  }

  if (acao === "desativar") {
    const forma: FormaOnline = corpo?.forma === "cartao" ? "cartao" : "pix";
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { asaasConexao: true, pixOnlineAtivo: true, cartaoOnlineAtivo: true } });
    const sobraAlguma = forma === "pix" ? loja?.cartaoOnlineAtivo : loja?.pixOnlineAtivo;
    const conexao = {
      ...((loja?.asaasConexao as any) || {}),
      ...(sobraAlguma
        ? {}
        : { desligadoEm: new Date().toISOString(), desligadoMotivo: `Desligado por ${quem.name || quem.email} no FireHub.` }),
    };
    await prisma.user.update({
      where: { id: lojaId },
      data: { ...(forma === "pix" ? { pixOnlineAtivo: false } : { cartaoOnlineAtivo: false }), asaasConexao: conexao },
    });
    return NextResponse.json(await estadoDaLoja(lojaId, true));
  }

  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}

export async function DELETE() {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!quem.titular) {
    return NextResponse.json({ error: "Só o titular da loja pode desconectar a conta Asaas." }, { status: 403 });
  }
  const lojaId = quem.lojaId;

  // Tira do cardápio primeiro: nenhuma cobrança nova nasce durante a desconexão.
  await prisma.user.update({ where: { id: lojaId }, data: { pixOnlineAtivo: false, cartaoOnlineAtivo: false } });

  // Pedido esperando Pix: sem a chave ninguém mais confirmaria. Cancela (a
  // função confere antes — o que já foi pago segue para a cozinha).
  const { cancelarPeloCliente } = await import("@/lib/pix-online-pedido");
  const esperando = await prisma.customerOrder.findMany({
    where: { franchiseeId: lojaId, gatewayProvider: "asaas", status: "AGUARDANDO_PAGAMENTO" },
    select: { id: true },
  });
  for (const p of esperando) {
    await cancelarPeloCliente(p.id, { por: "LOJA", motivo: "A loja desconectou a conta Asaas antes do pagamento" }).catch(() => null);
  }

  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { asaasChaveCifrada: true, asaasConexao: true } });
  const chave = decifrar(loja?.asaasChaveCifrada);
  const webhookId = (loja?.asaasConexao as any)?.webhookId;
  if (chave && webhookId) await removerWebhookDaLoja(chave, webhookId).catch(() => null);

  await prisma.user.update({
    where: { id: lojaId },
    data: {
      pixOnlineAtivo: false,
      cartaoOnlineAtivo: false,
      asaasChaveCifrada: null,
      asaasConexao: {
        desconectadoEm: new Date().toISOString(),
        desconectadoPor: quem.name || quem.email || quem.id,
      },
    },
  });

  return NextResponse.json({
    ...(await estadoDaLoja(lojaId, true)),
    aviso: "Conta desconectada. Para encerrar de vez, exclua a chave no Asaas (Integrações → Chaves de API).",
  });
}
