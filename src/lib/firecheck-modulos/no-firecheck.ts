/**
 * O que o FireHub pede ao FireCheck para os módulos no boleto. A regra de
 * cobrança mora em ./assinatura.ts; daqui só saem três chamadas:
 *   - criar a conta de quem ainda não tem FireCheck (já nasce ligada à loja);
 *   - ler a conta ligada (para não ligar em cima de uma assinatura da Cakto);
 *   - pedir para o FireCheck reler o que está ligado agora, logo depois do
 *     liga/desliga (sem isso ele releria sozinho em poucos minutos).
 * Todas com a chave da ligação (lib/cmv/firecheck.ts). O FireCheck confere a
 * chave da conta nova perguntando de volta em api/integracoes/firecheck/modulos.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  URL_DO_FIRECHECK, URL_DO_FIREHUB_PARA_O_FIRECHECK,
  chaveDaLigacao, lerLigacao, novaChave, type LigacaoDoFirecheck,
} from "@/lib/cmv/firecheck";
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
 * Cria a conta do FireCheck para o dono e liga à loja. A senha volta UMA vez,
 * para a tela mostrar; aqui não fica gravada.
 */
export async function criarContaNoFirecheck(lojaId: string, usuarioId: string): Promise<{ email: string; senha: string; storeName: string }> {
  if (await ligacaoDaLoja(lojaId)) throw new ErroDoFirecheck("Esta loja já está conectada a um FireCheck.", 409);
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
  if (resp.status !== 200 || !resp.corpo?.ok || !resp.corpo?.store || !resp.corpo?.senha) {
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
  return { email: ligacao.email, senha: String(resp.corpo.senha), storeName: ligacao.storeName };
}

/**
 * Antes de ligar: a loja tem FireCheck conectado e o módulo não está pago pela
 * Cakto (pagaria duas vezes). FireCheck fora do ar = não liga (não dá para conferir).
 */
export async function conferirAntesDeLigar(lojaId: string, modulo: ModuloDoFirecheck): Promise<void> {
  const l = await ligacaoDaLoja(lojaId);
  if (!l) throw new ErroDoFirecheck("Conecte ou crie a conta do FireCheck antes de ligar.", 400, { precisaConectar: true });
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
