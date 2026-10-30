/**
 * O que o FireHub pede ao FireCheck para os módulos no boleto. A regra de
 * cobrança mora em ./assinatura.ts; daqui saem quatro chamadas:
 *   - garantir a conta do dono (cria na hora de ligar, já ligada à loja, com o
 *     mesmo e-mail e a senha do FireHub — ./mesma-conta.ts);
 *   - ler a conta ligada (para não ligar em cima de uma assinatura da Cakto);
 *   - pedir para o FireCheck reler o que está ligado agora, logo depois do
 *     liga/desliga (sem isso ele releria sozinho em poucos minutos);
 *   - pedir o bilhete do "Abrir o FireCheck".
 * Todas com a chave da ligação (lib/cmv/firecheck.ts). O FireCheck confere a
 * chave da conta nova perguntando de volta em api/integracoes/firecheck/modulos.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  URL_DO_FIRECHECK, URL_DO_FIREHUB_PARA_O_FIRECHECK,
  chaveDaLigacao, lerLigacao, novaChave, type LigacaoDoFirecheck,
} from "@/lib/cmv/firecheck";
import { linkDeEntradaNoFirecheck } from "./mesma-conta";
import type { ModuloDoFirecheck } from "./preco";

export async function chamarFirecheck(caminho: string, init: RequestInit): Promise<{ status: number; corpo: any }> {
  const resp = await fetch(`${URL_DO_FIRECHECK}${caminho}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const corpo = await resp.json().catch(() => ({}));
  return { status: resp.status, corpo };
}

async function ligacaoDaLoja(lojaId: string): Promise<LigacaoDoFirecheck | null> {
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { firecheckIntegracao: true } });
  const l = lerLigacao(loja?.firecheckIntegracao);
  return l && l.store ? l : null;
}

export class ErroDoFirecheck extends Error {
  constructor(message: string, public status = 502, public extra: Record<string, unknown> = {}) { super(message); }
}

/**
 * A conta do FireCheck da loja: a que já está ligada, ou uma nova com o e-mail
 * da loja, já ligada (o dono entra com a senha do FireHub). E-mail que já tem
 * conta no FireCheck de outro jeito volta com `contaExiste`: aí o dono confirma
 * a senha do FireCheck uma vez, no quadro de conexão (o FireHub não confirma o
 * e-mail no cadastro, e ligar só pelo e-mail entregaria a conta de outra pessoa).
 */
export async function garantirContaNoFirecheck(lojaId: string, usuarioId: string): Promise<{ email: string; storeName: string }> {
  const atual = await ligacaoDaLoja(lojaId);
  if (atual) return { email: atual.email, storeName: atual.storeName };
  const { chave, chaveHash, chaveCifrada } = novaChave();
  // A chave tem que existir aqui ANTES: o FireCheck confere perguntando de volta.
  const pendente: LigacaoDoFirecheck = { chaveHash, chaveCifrada, store: "", storeName: "", email: "", conectadoEm: new Date().toISOString(), conectadoPor: usuarioId };
  await prisma.user.update({ where: { id: lojaId }, data: { firecheckIntegracao: pendente as unknown as Prisma.InputJsonValue } });
  let resp: { status: number; corpo: any };
  try {
    resp = await chamarFirecheck("/api/integracoes/firehub/criar-conta", {
      method: "POST",
      body: JSON.stringify({ chave, firehubLojaId: lojaId, urlDoFirehub: URL_DO_FIREHUB_PARA_O_FIRECHECK }),
    });
  } catch {
    resp = { status: 0, corpo: {} };
  }
  if (resp.status !== 200 || !resp.corpo?.ok || !resp.corpo?.store) {
    await prisma.user.update({ where: { id: lojaId }, data: { firecheckIntegracao: Prisma.DbNull } });
    if (resp.status === 0) throw new ErroDoFirecheck("O FireCheck não respondeu. Tente de novo em instantes.");
    const msg = typeof resp.corpo?.error === "string" ? resp.corpo.error : `O FireCheck recusou criar a conta (HTTP ${resp.status}).`;
    throw new ErroDoFirecheck(msg, resp.status >= 400 && resp.status < 500 ? resp.status : 502, { contaExiste: !!resp.corpo?.contaExiste });
  }
  const ligacao: LigacaoDoFirecheck = {
    ...pendente,
    store: String(resp.corpo.store),
    storeName: String(resp.corpo.storeName || resp.corpo.store),
    email: String(resp.corpo.email || ""),
  };
  await prisma.user.update({ where: { id: lojaId }, data: { firecheckIntegracao: ligacao as unknown as Prisma.InputJsonValue } });
  return { email: ligacao.email, storeName: ligacao.storeName };
}

/** "Abrir o FireCheck": garante a conta e devolve o link que entra sem senha (vale 2 minutos, uma vez). */
export async function linkParaAbrirOFirecheck(lojaId: string, usuarioId: string): Promise<string> {
  await garantirContaNoFirecheck(lojaId, usuarioId);
  const l = await ligacaoDaLoja(lojaId);
  if (!l) throw new ErroDoFirecheck("Não deu para ligar a conta do FireCheck. Tente de novo.");
  let resp: { status: number; corpo: any };
  try {
    resp = await chamarFirecheck("/api/integracoes/firehub/link-de-entrada", { method: "POST", headers: { Authorization: `Bearer ${chaveDaLigacao(l)}` }, body: "{}" });
  } catch {
    throw new ErroDoFirecheck("O FireCheck não respondeu. Tente de novo em instantes.");
  }
  if (resp.status === 401) throw new ErroDoFirecheck("A conexão com o FireCheck caiu. Conecte de novo.", 400, { precisaConectar: true });
  if (resp.status !== 200 || typeof resp.corpo?.bilhete !== "string") {
    throw new ErroDoFirecheck(typeof resp.corpo?.error === "string" ? resp.corpo.error : `O FireCheck não abriu a entrada (HTTP ${resp.status}).`);
  }
  return linkDeEntradaNoFirecheck(URL_DO_FIRECHECK, resp.corpo.bilhete);
}

/**
 * Antes de ligar: a loja tem FireCheck conectado e o módulo não está pago pela
 * Cakto (pagaria duas vezes). FireCheck fora do ar = não liga (não dá para conferir).
 */
export async function conferirAntesDeLigar(lojaId: string, modulo: ModuloDoFirecheck): Promise<void> {
  const l = await ligacaoDaLoja(lojaId);
  if (!l) throw new ErroDoFirecheck("Conecte a conta do FireCheck antes de ligar.", 400, { precisaConectar: true });
  const chave = chaveDaLigacao(l);
  let resp: { status: number; corpo: any };
  try {
    resp = await chamarFirecheck("/api/integracoes/firehub/conta", { method: "GET", headers: { Authorization: `Bearer ${chave}` } });
  } catch {
    throw new ErroDoFirecheck("O FireCheck não respondeu. Tente de novo em instantes.");
  }
  if (resp.status === 401 || resp.status === 404) throw new ErroDoFirecheck("A conexão com o FireCheck caiu. Conecte de novo.", 400, { precisaConectar: true });
  if (resp.status !== 200 || !resp.corpo?.ok) throw new ErroDoFirecheck(`O FireCheck não confirmou a conta (HTTP ${resp.status}).`);
  if (resp.corpo?.cakto?.[modulo]) {
    throw new ErroDoFirecheck(
      "Este módulo já é pago no cartão, pela Cakto. Cancele essa assinatura antes de ligar aqui, para não pagar duas vezes.",
      409, { cakto: true },
    );
  }
}

/** Depois do liga/desliga: o FireCheck relê na hora. Falhou, ele relê sozinho em poucos minutos. */
export async function pedirParaSincronizar(lojaId: string): Promise<boolean> {
  try {
    const l = await ligacaoDaLoja(lojaId);
    if (!l) return false;
    const resp = await chamarFirecheck("/api/integracoes/firehub/sincronizar", { method: "POST", headers: { Authorization: `Bearer ${chaveDaLigacao(l)}` }, body: "{}" });
    return resp.status === 200;
  } catch {
    return false;
  }
}
