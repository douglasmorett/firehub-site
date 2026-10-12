/**
 * lib/disparo-oficial/servidor.ts — o Disparo oficial com banco: conexão da
 * loja, saldo, recarga por Pix, campanha, fila de envio e o que o webhook da
 * Meta avisa. As contas puras estão em ./regras.ts.
 */
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/cofre";
import { getAsaasKey } from "@/lib/asaas";
import { levarHospedadoAoGatewayNovo } from "@/lib/gateway-da-loja";
import { garantirEstruturaDoDisparoOficial } from "./estrutura-no-banco";
import * as meta from "./meta";
import {
  EXPIRA_SEM_ENTREGA_MS,
  assinaturaConfere,
  custoMeta,
  escolherPublico,
  lerErroDaMeta,
  lerWebhook,
  minimoDeDisparos,
  modeloParaMeta,
  nomeDoModelo,
  precoPorDisparo,
  primeiroNome,
  proximoStatus,
  saldoDeDisparos,
  telefoneDaMeta,
  type Publico,
  RECARGA_MAXIMA_DISPAROS,
  valorDaRecarga,
  conferirTexto,
  corpoParaMeta,
  statusDoModelo,
} from "./regras";

const db = prisma as any;

export { garantirEstruturaDoDisparoOficial };

// ── CONEXÃO ─────────────────────────────────────────────────────────────────

export async function conexaoDaLoja(franchiseeId: string) {
  return db.whatsappOficial.findUnique({ where: { franchiseeId } });
}

function tokenDa(conexao: { tokenCifrado: string } | null): string | null {
  return conexao ? decifrar(conexao.tokenCifrado) : null;
}

/**
 * Fecha o cadastro incorporado: troca o código pelo token, inscreve o app na
 * WABA, grava o número e leva o robô da loja para o gateway de Baileys 7 (o
 * antigo não lê o aparelho hospedado que a coexistência cria — Divinos e China
 * pow, 25–30/09/2026). A Meta desconecta os aparelhos conectados ao número
 * nesse momento: a loja lê o QR do robô uma vez, como avisa a tela.
 */
export async function conectarLoja(args: { franchiseeId: string; codigo: string; wabaId: string; phoneNumberId?: string | null; businessId?: string | null }) {
  await garantirEstruturaDoDisparoOficial();
  const token = await meta.trocarCodigoPorToken(args.codigo);
  await meta.inscreverAppNaWaba(args.wabaId, token);

  const numeros = await meta.numerosDaWaba(args.wabaId, token);
  const numero = numeros.find((n) => n.id === args.phoneNumberId) || numeros.find((n) => n.is_on_biz_app) || numeros[0];
  if (!numero?.id) throw new Error("A conta do WhatsApp foi criada, mas a Meta não mostrou o número. Tente conectar de novo.");

  const dados = {
    wabaId: args.wabaId,
    phoneNumberId: numero.id,
    businessId: args.businessId || null,
    numero: numero.display_phone_number ? String(numero.display_phone_number).replace(/\D/g, "") : null,
    nomeExibido: numero.verified_name || null,
    tokenCifrado: cifrar(token),
    status: "CONECTADO",
    qualidade: numero.quality_rating || null,
    erro: null,
    conectadoEm: new Date(),
  };
  const conexao = await db.whatsappOficial.upsert({
    where: { franchiseeId: args.franchiseeId },
    create: { franchiseeId: args.franchiseeId, ...dados },
    update: dados,
  });

  try {
    await meta.sincronizarContatos(numero.id, token);
    await db.whatsappOficial.update({ where: { franchiseeId: args.franchiseeId }, data: { contatosSincronizadosEm: new Date() } });
  } catch (e: any) {
    // Número que não está no app (só API) não sincroniza — e não precisa.
    console.warn(`[Disparo oficial] Contatos não sincronizados (${args.franchiseeId}): ${e?.message}`);
  }

  // O robô vai para o gateway novo se ainda estiver no antigo.
  try {
    const loja = await prisma.user.findUnique({ where: { id: args.franchiseeId }, select: { chatbotConfig: true } });
    const config = ((loja?.chatbotConfig as Record<string, unknown>) || {}) as Record<string, unknown>;
    const noGatewayAntigo = !(typeof config.evolutionUrl === "string" && config.evolutionUrl.trim());
    if (noGatewayAntigo && (config.instanceName || config.connected || config.jaConectouAlgumaVez)) {
      await levarHospedadoAoGatewayNovo(args.franchiseeId, config);
    }
  } catch (e: any) {
    console.error(`[Disparo oficial] Não consegui levar o robô ao gateway novo (${args.franchiseeId}): ${e?.message}`);
  }

  return conexao;
}

/** Atualiza qualidade e limite do número na Meta (botão da tela e cron). */
export async function atualizarNumero(franchiseeId: string) {
  const conexao = await conexaoDaLoja(franchiseeId);
  const token = tokenDa(conexao);
  if (!conexao || !token) return null;
  try {
    const info = await meta.infoDoNumero(conexao.phoneNumberId, token);
    return db.whatsappOficial.update({
      where: { franchiseeId },
      data: {
        qualidade: info.quality_rating || conexao.qualidade,
        limite: info.messaging_limit_tier || conexao.limite,
        nomeExibido: info.verified_name || conexao.nomeExibido,
        status: "CONECTADO",
        erro: null,
      },
    });
  } catch (e: any) {
    const leitura = lerErroDaMeta(e?.codigo, e?.message);
    return db.whatsappOficial.update({ where: { franchiseeId }, data: { status: leitura.pararCampanha ? "ERRO" : conexao.status, erro: leitura.motivo } });
  }
}

export async function desconectarLoja(franchiseeId: string) {
  await db.disparoEnvio.updateMany({ where: { franchiseeId, status: "FILA" }, data: { status: "CANCELADO", erro: "Loja desconectou da API oficial" } });
  await db.disparoCampanha.updateMany({ where: { franchiseeId, status: "ENVIANDO" }, data: { status: "CANCELADA", motivo: "Loja desconectou da API oficial", concluidaEm: new Date() } });
  return db.whatsappOficial.update({ where: { franchiseeId }, data: { status: "DESCONECTADO" } });
}

// ── SALDO ───────────────────────────────────────────────────────────────────

const ONDE_GASTA = (franchiseeId: string) => ({
  franchiseeId,
  OR: [
    { status: { in: ["FILA", "PROCESSANDO", "ENVIADO", "INCERTO"] } },
    { status: { in: ["ENTREGUE", "LIDO"] }, gratis: false },
  ],
});

export async function saldoDaLoja(franchiseeId: string, cliente: any = db): Promise<{ comprados: number; gastos: number; saldo: number }> {
  const [soma, gastos] = await Promise.all([
    cliente.disparoRecarga.aggregate({ where: { franchiseeId, status: "PAGA" }, _sum: { disparos: true } }),
    cliente.disparoEnvio.count({ where: ONDE_GASTA(franchiseeId) }),
  ]);
  const comprados = Number(soma?._sum?.disparos || 0);
  return { comprados, gastos, saldo: saldoDeDisparos(comprados, gastos) };
}

// ── RECARGA (PIX DO ASAAS DO FIREHUB) ───────────────────────────────────────

function baseDoAsaas(chave: string) {
  return chave.startsWith("$aact_prod") ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";
}

async function asaas(chave: string, caminho: string, init?: { metodo?: string; corpo?: unknown }) {
  const res = await fetch(`${baseDoAsaas(chave)}${caminho}`, {
    method: init?.metodo || "GET",
    headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "firehub/1.0" },
    body: init?.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const dados: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, dados };
}

/** Cria a recarga e o Pix. Devolve o copia-e-cola e a imagem do QR. */
export async function criarRecarga(franchiseeId: string, disparosPedidos: number, criadoPor?: string | null) {
  await garantirEstruturaDoDisparoOficial();
  const preco = precoPorDisparo();
  const minimo = minimoDeDisparos(preco);
  const disparos = Math.round(Number(disparosPedidos));
  if (!Number.isFinite(disparos) || disparos < minimo) throw new Error(`A recarga mínima é de ${minimo} disparos.`);
  if (disparos > RECARGA_MAXIMA_DISPAROS) throw new Error(`A recarga máxima é de ${RECARGA_MAXIMA_DISPAROS.toLocaleString("pt-BR")} disparos.`);
  const valor = valorDaRecarga(disparos, preco);

  const chave = getAsaasKey();
  if (!chave) throw new Error("O Pix do FireHub não está configurado no servidor. Fale com o suporte.");

  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { name: true, email: true, cpfCnpj: true, storeName: true } });
  const doc = String(loja?.cpfCnpj || "").replace(/\D/g, "");
  if (!loja || (doc.length !== 11 && doc.length !== 14)) {
    throw new Error("Para gerar o Pix, cadastre o CPF ou CNPJ da loja em Minha conta.");
  }

  // Cliente do Asaas pelo documento (o mesmo da mensalidade).
  let clienteId: string | null = null;
  const busca = await asaas(chave, `/customers?cpfCnpj=${doc}`);
  if (busca.ok && busca.dados?.data?.length) clienteId = busca.dados.data[0].id;
  if (!clienteId) {
    const novo = await asaas(chave, "/customers", { metodo: "POST", corpo: { name: loja.storeName || loja.name, email: loja.email, cpfCnpj: doc } });
    if (!novo.ok) throw new Error("O Asaas recusou o cadastro do cliente para o Pix.");
    clienteId = novo.dados.id;
  }

  const recarga = await db.disparoRecarga.create({
    data: { franchiseeId, disparos, valor, precoPorDisparo: preco, tipo: "PIX", status: "PENDENTE", criadoPor: criadoPor || null, descricao: `Custo Meta na hora: R$ ${custoMeta().toFixed(4)}` },
  });

  const vencimento = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const cobranca = await asaas(chave, "/payments", {
    metodo: "POST",
    corpo: {
      customer: clienteId,
      billingType: "PIX",
      value: valor,
      dueDate: vencimento,
      description: `FireHub — ${disparos.toLocaleString("pt-BR")} disparos de WhatsApp (API oficial)`,
      externalReference: `disparo:${recarga.id}`,
    },
  });
  if (!cobranca.ok || !cobranca.dados?.id) {
    await db.disparoRecarga.update({ where: { id: recarga.id }, data: { status: "CANCELADA" } });
    throw new Error(cobranca.dados?.errors?.[0]?.description || "O Asaas não gerou a cobrança.");
  }
  const qr = await asaas(chave, `/payments/${cobranca.dados.id}/pixQrCode`);
  const copiaECola = qr.ok ? String(qr.dados?.payload || "") : "";
  await db.disparoRecarga.update({ where: { id: recarga.id }, data: { asaasPaymentId: cobranca.dados.id, pixCopiaECola: copiaECola || null } });

  return { id: recarga.id, disparos, valor, preco, copiaECola, imagem: qr.ok ? String(qr.dados?.encodedImage || "") : "" };
}

/** O QR de novo (a tela fechou e o lojista voltou para pagar). */
export async function qrDaRecarga(franchiseeId: string, recargaId: string) {
  const recarga = await db.disparoRecarga.findFirst({ where: { id: recargaId, franchiseeId } });
  const chave = getAsaasKey();
  if (!recarga?.asaasPaymentId || !chave) return null;
  const qr = await asaas(chave, `/payments/${recarga.asaasPaymentId}/pixQrCode`);
  return {
    id: recarga.id,
    disparos: recarga.disparos,
    valor: recarga.valor,
    status: recarga.status,
    copiaECola: qr.ok ? String(qr.dados?.payload || recarga.pixCopiaECola || "") : recarga.pixCopiaECola || "",
    imagem: qr.ok ? String(qr.dados?.encodedImage || "") : "",
  };
}

/** Webhook do Asaas (externalReference "disparo:<id>") e conferência do cron. */
export async function registrarPagamentoDaRecarga(pagamento: { id?: string; externalReference?: string | null; status?: string }, evento?: string | null) {
  await garantirEstruturaDoDisparoOficial();
  const id = String(pagamento?.externalReference || "").replace(/^disparo:/, "");
  if (!id) return "SEM_RECARGA";
  const recarga = await db.disparoRecarga.findUnique({ where: { id } });
  if (!recarga) return "SEM_RECARGA";
  const pago =
    evento === "PAYMENT_RECEIVED" || evento === "PAYMENT_CONFIRMED" || pagamento?.status === "RECEIVED" || pagamento?.status === "CONFIRMED" || pagamento?.status === "RECEIVED_IN_CASH";
  const cancelado = evento === "PAYMENT_DELETED" || evento === "PAYMENT_REFUNDED" || pagamento?.status === "REFUNDED" || pagamento?.status === "DELETED";
  if (pago && recarga.status !== "PAGA") {
    await db.disparoRecarga.update({ where: { id }, data: { status: "PAGA", pagaEm: new Date(), asaasPaymentId: recarga.asaasPaymentId || pagamento.id || null } });
    console.log(`[Disparo oficial] Recarga ${id} paga: +${recarga.disparos} disparos para ${recarga.franchiseeId}`);
    return "PAGA";
  }
  // Estornado (inclusive pelo MED do Pix depois de pago): o crédito sai.
  if (cancelado && (recarga.status === "PENDENTE" || recarga.status === "PAGA")) {
    await db.disparoRecarga.update({ where: { id }, data: { status: "CANCELADA" } });
    if (recarga.status === "PAGA") console.warn(`[Disparo oficial] Recarga ${id} PAGA foi estornada: -${recarga.disparos} disparos de ${recarga.franchiseeId}`);
    return "CANCELADA";
  }
  return "SEM_MUDANCA";
}

/** Rede de segurança do webhook do Asaas: confere as recargas pendentes recentes. */
export async function conferirRecargasPendentes() {
  const chave = getAsaasKey();
  if (!chave) return 0;
  const pendentes = await db.disparoRecarga.findMany({
    where: { status: "PENDENTE", tipo: "PIX", asaasPaymentId: { not: null }, createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
    take: 30,
  });
  let pagas = 0;
  for (const r of pendentes) {
    const c = await asaas(chave, `/payments/${r.asaasPaymentId}`);
    if (c.ok && (await registrarPagamentoDaRecarga({ ...c.dados, externalReference: `disparo:${r.id}` }, null)) === "PAGA") pagas++;
  }
  return pagas;
}

/** Crédito dado à mão pelo FireHub (teste, cortesia, acerto). Negativo tira. */
export async function ajustarCredito(franchiseeId: string, disparos: number, motivo: string, criadoPor: string) {
  await garantirEstruturaDoDisparoOficial();
  const n = Math.round(Number(disparos));
  if (!Number.isFinite(n) || n === 0) throw new Error("Informe a quantidade de disparos.");
  return db.disparoRecarga.create({
    data: { franchiseeId, disparos: n, valor: 0, precoPorDisparo: 0, tipo: "AJUSTE", status: "PAGA", pagaEm: new Date(), descricao: motivo || "Ajuste do FireHub", criadoPor },
  });
}

// ── MODELOS ─────────────────────────────────────────────────────────────────

export async function criarModeloDaLoja(franchiseeId: string, args: { titulo: string; texto: string; botaoPedir: boolean }) {
  const problema = conferirTexto(args.texto);
  if (problema) throw new Error(problema);
  const titulo = String(args.titulo || "").trim().slice(0, 60) || "Promoção";
  const conexao = await conexaoDaLoja(franchiseeId);
  const token = tokenDa(conexao);
  if (!conexao || conexao.status !== "CONECTADO" || !token) throw new Error("Conecte o WhatsApp da loja à API oficial primeiro.");

  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeName: true, name: true } });
  const nome = nomeDoModelo(titulo);
  const corpo = modeloParaMeta({ nome, texto: args.texto, botaoPedir: args.botaoPedir, nomeDaLoja: loja?.storeName || loja?.name || "" });
  const criado = await meta.criarModelo(conexao.wabaId, token, corpo);
  return db.disparoModelo.create({
    data: {
      franchiseeId,
      nome,
      titulo,
      texto: String(args.texto).trim(),
      botaoPedir: !!args.botaoPedir,
      metaTemplateId: criado.id,
      status: statusDoModelo(criado.status) ?? "PENDENTE",
    },
  });
}

const ultimaReleitura = new Map<string, number>();

/** Relê na Meta os modelos que ainda não têm resposta final (no máximo 1 vez por minuto por loja; o webhook avisa antes). */
export async function atualizarModelosPendentes(franchiseeId?: string) {
  const chave = franchiseeId || "*";
  if (Date.now() - (ultimaReleitura.get(chave) || 0) < 60_000) return;
  ultimaReleitura.set(chave, Date.now());
  const pendentes = await db.disparoModelo.findMany({
    where: { ...(franchiseeId ? { franchiseeId } : {}), status: { in: ["PENDENTE", "PAUSADO"] }, metaTemplateId: { not: null } },
    take: 50,
  });
  const tokens = new Map<string, string | null>();
  for (const m of pendentes) {
    if (!tokens.has(m.franchiseeId)) tokens.set(m.franchiseeId, tokenDa(await conexaoDaLoja(m.franchiseeId)));
    const token = tokens.get(m.franchiseeId);
    if (!token) continue;
    try {
      const lido = await meta.lerModelo(m.metaTemplateId, token);
      const status = statusDoModelo(lido.status);
      if (status && status !== m.status) {
        await db.disparoModelo.update({ where: { id: m.id }, data: { status, motivo: lido.rejected_reason && lido.rejected_reason !== "NONE" ? lido.rejected_reason : null } });
      }
    } catch (e: any) {
      console.warn(`[Disparo oficial] Modelo ${m.id}: ${e?.message}`);
    }
  }
}

export async function apagarModeloDaLoja(franchiseeId: string, modeloId: string) {
  const modelo = await db.disparoModelo.findFirst({ where: { id: modeloId, franchiseeId } });
  if (!modelo) throw new Error("Modelo não encontrado.");
  const emUso = await db.disparoCampanha.count({ where: { modeloId, status: "ENVIANDO" } });
  if (emUso) throw new Error("Há uma campanha enviando com este modelo.");
  const conexao = await conexaoDaLoja(franchiseeId);
  const token = tokenDa(conexao);
  if (conexao && token) {
    await meta.apagarModelo(conexao.wabaId, token, modelo.nome, modelo.metaTemplateId).catch((e) => console.warn(`[Disparo oficial] Apagar modelo na Meta: ${e?.message}`));
  }
  await db.disparoModelo.update({ where: { id: modelo.id }, data: { status: "DESATIVADO" } });
}

// ── PÚBLICO E CAMPANHA ──────────────────────────────────────────────────────

/** Os clientes da loja (quem já pediu), sem quem pediu para parar. */
export async function publicoDaLoja(franchiseeId: string, publico: Publico) {
  if (publico.tipo === "TESTE") {
    const descadastros = await db.disparoDescadastro.findMany({ where: { franchiseeId, telefone: publico.telefone }, select: { telefone: true } });
    return escolherPublico([], publico, new Set(descadastros.map((d: any) => d.telefone)));
  }
  const [pedidos, descadastros] = await Promise.all([
    prisma.customerOrder.findMany({
      where: { franchiseeId, customerPhone: { not: "" } },
      select: { customerPhone: true, customerName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 60000,
    }),
    db.disparoDescadastro.findMany({ where: { franchiseeId }, select: { telefone: true } }),
  ]);
  return escolherPublico(pedidos as any, publico, new Set(descadastros.map((d: any) => d.telefone)));
}

export async function criarCampanha(franchiseeId: string, args: { modeloId: string; publico: Publico; nome?: string; criadoPor?: string | null }) {
  await garantirEstruturaDoDisparoOficial();
  const conexao = await conexaoDaLoja(franchiseeId);
  if (!conexao || conexao.status !== "CONECTADO") throw new Error("Conecte o WhatsApp da loja à API oficial primeiro.");
  const modelo = await db.disparoModelo.findFirst({ where: { id: args.modeloId, franchiseeId } });
  if (!modelo) throw new Error("Escolha a mensagem.");
  if (modelo.status !== "APROVADO") throw new Error("Esta mensagem ainda não foi aprovada pela Meta.");

  const clientes = await publicoDaLoja(franchiseeId, args.publico);
  if (clientes.length === 0) {
    throw new Error(args.publico.tipo === "TESTE" ? "Digite um celular válido com DDD para o teste." : "Nenhum cliente neste público.");
  }

  return prisma.$transaction(
    async (tx: any) => {
      // Uma campanha por vez por loja: duas abas criando ao mesmo tempo não
      // podem gastar o mesmo saldo duas vezes.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `disparo:${franchiseeId}`);
      const { saldo } = await saldoDaLoja(franchiseeId, tx);
      if (saldo < clientes.length) {
        throw new Error(`Saldo insuficiente: este público tem ${clientes.length.toLocaleString("pt-BR")} clientes e você tem ${saldo.toLocaleString("pt-BR")} disparos. Recarregue ou escolha um público menor.`);
      }
      const campanha = await tx.disparoCampanha.create({
        data: {
          franchiseeId,
          modeloId: modelo.id,
          nome: String(args.nome || modelo.titulo).slice(0, 80),
          publico: args.publico as any,
          total: clientes.length,
          status: "ENVIANDO",
          criadoPor: args.criadoPor || null,
        },
      });
      for (let i = 0; i < clientes.length; i += 1000) {
        await tx.disparoEnvio.createMany({
          data: clientes.slice(i, i + 1000).map((c) => ({ campanhaId: campanha.id, franchiseeId, telefone: c.telefone, nome: c.nome, status: "FILA" })),
          skipDuplicates: true,
        });
      }
      return campanha;
    },
    { timeout: 60000, maxWait: 15000 }
  );
}

export async function cancelarCampanha(franchiseeId: string, campanhaId: string, motivo = "Cancelada pela loja") {
  const campanha = await db.disparoCampanha.findFirst({ where: { id: campanhaId, franchiseeId } });
  if (!campanha) throw new Error("Campanha não encontrada.");
  const { count } = await db.disparoEnvio.updateMany({ where: { campanhaId, status: "FILA" }, data: { status: "CANCELADO", erro: motivo } });
  await db.disparoCampanha.update({ where: { id: campanhaId }, data: { status: "CANCELADA", motivo, concluidaEm: new Date() } });
  return count;
}

/** Contagem por status de cada campanha (a tela mostra a barra). */
export async function resumoDasCampanhas(franchiseeId: string, limite = 15) {
  const campanhas = await db.disparoCampanha.findMany({ where: { franchiseeId }, orderBy: { createdAt: "desc" }, take: limite });
  if (campanhas.length === 0) return [];
  const grupos = await db.disparoEnvio.groupBy({
    by: ["campanhaId", "status"],
    where: { campanhaId: { in: campanhas.map((c: any) => c.id) } },
    _count: { _all: true },
  });
  const respostas = await db.disparoEnvio.groupBy({
    by: ["campanhaId"],
    where: { campanhaId: { in: campanhas.map((c: any) => c.id) }, respondeuEm: { not: null } },
    _count: { _all: true },
  });
  return campanhas.map((c: any) => {
    const por: Record<string, number> = {};
    for (const g of grupos) if (g.campanhaId === c.id) por[g.status] = g._count._all;
    const resp = respostas.find((r: any) => r.campanhaId === c.id)?._count?._all || 0;
    return { ...c, contagem: por, responderam: resp };
  });
}

/** As falhas de uma campanha, com o motivo (a tela abre a lista). */
export async function falhasDaCampanha(franchiseeId: string, campanhaId: string) {
  return db.disparoEnvio.findMany({
    where: { franchiseeId, campanhaId, status: { in: ["FALHOU", "EXPIRADO", "CANCELADO"] } },
    select: { telefone: true, nome: true, status: true, erro: true },
    take: 500,
  });
}

// ── FILA DE ENVIO (CRON) ────────────────────────────────────────────────────

const LOTE = 10;
const PAUSA_ENTRE_LOTES_MS = 700; // ~14 por segundo: a coexistência aceita 20.
const ORCAMENTO_MS = 45_000; // o cron roda de minuto em minuto
const PROCESSANDO_PRESO_MS = 5 * 60 * 1000;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pega N envios da fila desta campanha para este processo (SKIP LOCKED: dois containers não pegam o mesmo). */
async function pegarDaFila(campanhaId: string, n: number): Promise<{ id: string; telefone: string; nome: string | null }[]> {
  return prisma.$queryRawUnsafe(
    `UPDATE "DisparoEnvio" SET "status" = 'PROCESSANDO', "enviadoEm" = NOW(), "tentativas" = "tentativas" + 1
     WHERE "id" IN (
       SELECT "id" FROM "DisparoEnvio" WHERE "campanhaId" = $1 AND "status" = 'FILA'
       ORDER BY "createdAt", "id" LIMIT $2 FOR UPDATE SKIP LOCKED
     )
     RETURNING "id", "telefone", "nome"`,
    campanhaId,
    n
  );
}

export async function processarFila(): Promise<{ enviados: number; falhas: number; campanhas: number }> {
  if (!(await garantirEstruturaDoDisparoOficial())) return { enviados: 0, falhas: 0, campanhas: 0 };
  const inicio = Date.now();
  let enviados = 0;
  let falhas = 0;

  // Envio preso no meio (servidor reiniciou durante o envio): não se sabe se
  // saiu. Não manda de novo — mandar duas vezes a mesma promoção é pior do que
  // perder uma. Devolve o crédito.
  await db.disparoEnvio.updateMany({
    where: { status: "PROCESSANDO", enviadoEm: { lt: new Date(Date.now() - PROCESSANDO_PRESO_MS) } },
    data: { status: "FALHOU", erro: "Envio interrompido (o servidor reiniciou) — crédito devolvido" },
  });
  // Enviado e sem notícia da Meta depois do prazo dela (30 dias): não entregou e não cobra.
  await db.disparoEnvio.updateMany({
    where: { status: "ENVIADO", enviadoEm: { lt: new Date(Date.now() - EXPIRA_SEM_ENTREGA_MS) } },
    data: { status: "EXPIRADO", erro: "A Meta não conseguiu entregar em 30 dias — crédito devolvido" },
  });

  const campanhas = await db.disparoCampanha.findMany({ where: { status: "ENVIANDO" }, orderBy: { createdAt: "asc" }, take: 20 });
  for (const campanha of campanhas) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    const [conexao, modelo] = await Promise.all([conexaoDaLoja(campanha.franchiseeId), db.disparoModelo.findUnique({ where: { id: campanha.modeloId } })]);
    const token = tokenDa(conexao);
    if (!conexao || conexao.status !== "CONECTADO" || !token) {
      await cancelarCampanha(campanha.franchiseeId, campanha.id, "A conexão com a API oficial caiu — conecte de novo");
      continue;
    }
    if (!modelo || modelo.status !== "APROVADO") {
      await cancelarCampanha(campanha.franchiseeId, campanha.id, "A Meta pausou ou desativou a mensagem");
      continue;
    }
    const usaNome = corpoParaMeta(modelo.texto).usaNome;

    let parar: string | null = null;
    while (!parar && Date.now() - inicio < ORCAMENTO_MS) {
      const lote = await pegarDaFila(campanha.id, LOTE);
      if (lote.length === 0) break;
      const resultados = await Promise.all(
        lote.map(async (e) => {
          try {
            const wamid = await meta.enviarModelo({
              phoneNumberId: conexao.phoneNumberId,
              token,
              telefone: e.telefone,
              nomeDoModelo: modelo.nome,
              idioma: modelo.idioma,
              nome: usaNome ? primeiroNome(e.nome) : null,
            });
            // O webhook só acha o envio pelo wamid, que nasce aqui (o aviso que
            // chegar antes ganha uma segunda chance em processarWebhook). A
            // mensagem JÁ SAIU: erro de banco aqui não pode virar "falhou" e
            // devolver o crédito de uma mensagem que a Meta vai cobrar.
            for (let t = 1; t <= 3; t++) {
              try {
                await db.disparoEnvio.update({ where: { id: e.id }, data: { status: "ENVIADO", wamid } });
                break;
              } catch (errDoBanco: any) {
                if (t === 3) console.error(`[Disparo oficial] Envio ${e.id} saiu (${wamid}) mas não gravou: ${errDoBanco?.message}`);
                else await esperar(500 * t);
              }
            }
            return { ok: true as const };
          } catch (err: any) {
            // Sem resposta da Meta (rede caiu, 15 s estourou): pode ter saído.
            // Não reenvia (promoção em dobro) e não devolve (a Meta pode cobrar).
            if (!(err instanceof meta.ErroDaMeta)) {
              await db.disparoEnvio.update({ where: { id: e.id }, data: { status: "INCERTO", erro: `Sem resposta da Meta: ${String(err?.message || err).slice(0, 120)}` } }).catch(() => {});
              return { ok: true as const };
            }
            const leitura = lerErroDaMeta(err?.codigo, err?.message);
            if (leitura.tentarDeNovo) {
              await db.disparoEnvio.update({ where: { id: e.id }, data: { status: "FILA", enviadoEm: null } });
            } else {
              await db.disparoEnvio.update({ where: { id: e.id }, data: { status: "FALHOU", erro: leitura.motivo } });
            }
            return { ok: false as const, leitura };
          }
        })
      );
      for (const r of resultados) {
        if (r.ok) enviados++;
        else {
          if (!r.leitura.tentarDeNovo) falhas++;
          if (r.leitura.pararCampanha) parar = r.leitura.motivo;
          else if (r.leitura.tentarDeNovo) parar = parar || "__esperar";
        }
      }
      await esperar(PAUSA_ENTRE_LOTES_MS);
    }

    if (parar && parar !== "__esperar") {
      await cancelarCampanha(campanha.franchiseeId, campanha.id, parar);
      if (/conexão|bloquead|pagamento/i.test(parar)) {
        await db.whatsappOficial.update({ where: { franchiseeId: campanha.franchiseeId }, data: { status: /pagamento/i.test(parar) ? conexao.status : "ERRO", erro: parar } });
      }
      continue;
    }
    const restam = await db.disparoEnvio.count({ where: { campanhaId: campanha.id, status: { in: ["FILA", "PROCESSANDO"] } } });
    // Só se ainda está enviando: a loja (ou o webhook) pode ter cancelado no meio.
    if (restam === 0) await db.disparoCampanha.updateMany({ where: { id: campanha.id, status: "ENVIANDO" }, data: { status: "CONCLUIDA", concluidaEm: new Date() } });
  }
  return { enviados, falhas, campanhas: campanhas.length };
}

// ── WEBHOOK DA META ─────────────────────────────────────────────────────────

const hmacSha256 = (segredo: string, corpo: string) => createHmac("sha256", segredo).update(corpo, "utf8").digest("hex");

export function webhookAutentico(corpoCru: string, assinatura: string | null): boolean {
  const segredo = process.env.META_APP_SECRET?.trim() || "";
  return assinaturaConfere(corpoCru, assinatura, segredo, hmacSha256);
}

export async function processarWebhook(body: unknown) {
  if (!(await garantirEstruturaDoDisparoOficial())) return;
  const { status, respostas, modelos, numeros } = lerWebhook(body);

  // O aviso pode chegar antes de o envio gravar o wamid: os que não acharam
  // ganham UMA segunda chance, todos juntos, 1,5 s depois. (Status de
  // mensagem que não é de campanha — a confirmação do "Parar" — nunca acha.)
  const achados = new Map<string, any>();
  const procurar = async (lista: typeof status) => {
    if (lista.length === 0) return;
    const envios = await db.disparoEnvio.findMany({ where: { wamid: { in: lista.map((s) => s.wamid) } } });
    for (const e of envios) achados.set(e.wamid, e);
  };
  await procurar(status);
  const faltando = status.filter((s) => !achados.has(s.wamid) && ["sent", "delivered", "failed"].includes(s.status));
  if (faltando.length) {
    await esperar(1500);
    await procurar(faltando);
  }

  for (const s of status) {
    // Relê: o mesmo wamid pode vir duas vezes no mesmo corpo (sent + delivered).
    const visto = achados.get(s.wamid);
    const envio = visto ? await db.disparoEnvio.findUnique({ where: { id: visto.id } }) : null;
    if (!envio) continue;
    const novo = proximoStatus(envio.status, s.status);
    const dados: Record<string, unknown> = {};
    if (novo !== envio.status) dados.status = novo;
    if (s.gratis && !envio.gratis) dados.gratis = true;
    if (novo === "ENTREGUE" && !envio.entregueEm) dados.entregueEm = s.quando;
    if (novo === "LIDO") {
      if (!envio.lidoEm) dados.lidoEm = s.quando;
      if (!envio.entregueEm) dados.entregueEm = s.quando;
    }
    if (novo === "FALHOU" && envio.status !== "FALHOU") {
      const leitura = lerErroDaMeta(s.erroCodigo, s.erroTitulo);
      dados.erro = leitura.motivo;
      if (leitura.pararCampanha) {
        await cancelarCampanha(envio.franchiseeId, envio.campanhaId, leitura.motivo).catch(() => {});
      }
    }
    if (Object.keys(dados).length) await db.disparoEnvio.update({ where: { id: envio.id }, data: dados });
  }

  for (const r of respostas) {
    const conexao = await db.whatsappOficial.findFirst({ where: { phoneNumberId: r.phoneNumberId } });
    if (!conexao) continue;
    // Respondeu a uma promoção dos últimos 3 dias: conta na campanha.
    const ultimo = await db.disparoEnvio.findFirst({
      where: { franchiseeId: conexao.franchiseeId, telefone: r.telefone, respondeuEm: null, status: { in: ["ENVIADO", "ENTREGUE", "LIDO"] }, enviadoEm: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
      orderBy: { enviadoEm: "desc" },
    });
    if (ultimo) await db.disparoEnvio.update({ where: { id: ultimo.id }, data: { respondeuEm: r.quando } });

    if (r.parar) {
      await db.disparoDescadastro.upsert({
        where: { franchiseeId_telefone: { franchiseeId: conexao.franchiseeId, telefone: r.telefone } },
        create: { franchiseeId: conexao.franchiseeId, telefone: r.telefone },
        update: {},
      });
      await db.disparoEnvio.updateMany({ where: { franchiseeId: conexao.franchiseeId, telefone: r.telefone, status: "FILA" }, data: { status: "CANCELADO", erro: "Cliente pediu para parar" } });
      // A confirmação ao cliente sai pelo ROBÔ (api/webhook/whatsapp), não daqui:
      // ver MENSAGEM_DE_DESCADASTRO em ./regras.
    }
  }

  for (const m of modelos) {
    await db.disparoModelo.updateMany({ where: { metaTemplateId: m.metaTemplateId }, data: { status: m.status, motivo: m.motivo || null } });
  }

  for (const n of numeros) {
    if (!n.wabaId) continue;
    const dados: Record<string, unknown> = {};
    if (n.limite) dados.limite = n.limite;
    if (n.qualidade && /FLAGGED|UNFLAGGED|UPGRADE|DOWNGRADE/.test(n.qualidade)) dados.qualidade = n.qualidade;
    if (n.evento && /DISABLED|BANNED|RESTRICT/i.test(n.evento)) {
      dados.status = "ERRO";
      dados.erro = `A Meta restringiu a conta (${n.evento})`;
    }
    if (Object.keys(dados).length) await db.whatsappOficial.updateMany({ where: { wabaId: n.wabaId }, data: dados });
  }
}

export { telefoneDaMeta };
