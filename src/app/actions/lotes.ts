"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { temEstruturaDeLotes, garantirEstruturaDeLotes } from "@/lib/garantir-colunas";
import { gerarCodigoDeLote } from "@/lib/lote";

/**
 * Cria os lotes de uma impressão de etiquetas.
 *
 * É AQUI que o QR ganha significado: antes de o papel sair, o código já existe
 * no banco, ligado ao produto, à validade e à loja. Etiqueta impressa com
 * código que o servidor nunca viu seria um QR que abre "não encontrada" — o
 * pior resultado possível, porque o funcionário confia no papel.
 *
 * Resolução de loja: `ownerId || id`, a convenção do projeto.
 */
async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Não autorizado");
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!u) throw new Error("Usuário não encontrado");
  return { franchiseeId: u.ownerId || u.id, userId: u.id };
}

/** Sorteia um código que ainda não existe. Colisão em 30^8 é remota, mas o banco decide. */
async function codigoInedito(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const c = gerarCodigoDeLote();
    const existe = await prisma.stockLot.findUnique({ where: { code: c }, select: { id: true } });
    if (!existe) return c;
  }
  throw new Error("Não consegui gerar um código novo. Tente de novo.");
}

export type PedidoDeLote = {
  kitchenItemId?: string | null;
  stockItemId?: string | null;
  productName: string;
  loteRef?: string | null;
  fabricadoEm?: string | null;   // "YYYY-MM-DD"
  validoAte?: string | null;     // "YYYY-MM-DD"
  weightStr?: string | null;
  unit?: string | null;
  /** Quantas etiquetas serão impressas. */
  etiquetas: number;
  /**
   * true  = as N etiquetas levam o MESMO código (um lote, N cópias do papel)
   * false = cada etiqueta tem código próprio (N lotes de 1)
   * O dono pediu que isso fosse uma escolha na tela: cada loja tem uma demanda.
   */
  codigoUnicoParaTodas: boolean;
  /** Quanto este lote representa em estoque, no total. */
  quantidadeTotal?: number | null;
};

/**
 * Converte "YYYY-MM-DD" em meia-noite UTC.
 *
 * Data de etiqueta é DIA DE CALENDÁRIO, não instante. `new Date("2026-08-28")`
 * já produz meia-noite UTC, que é o que queremos gravar — e é como
 * `src/lib/lote.ts` lê de volta. Passar por fuso aqui deslocaria o dia, que é
 * exatamente o defeito que fazia a etiqueta imprimir a data de ontem.
 */
function diaParaData(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

export async function criarLotesDaImpressao(pedido: PedidoDeLote) {
  const { franchiseeId, userId } = await lojaDaSessao();

  if (!(await temEstruturaDeLotes())) {
    await garantirEstruturaDeLotes();
    if (!(await temEstruturaDeLotes())) {
      // Sem a estrutura, a etiqueta ainda IMPRIME — só sai sem QR. Melhor uma
      // etiqueta sem rastreio do que a loja não conseguir etiquetar a comida.
      return { ok: false as const, motivo: "ESTRUTURA_INDISPONIVEL" as const, lotes: [] };
    }
  }

  const nome = String(pedido.productName || "").trim();
  if (!nome) return { ok: false as const, motivo: "SEM_NOME" as const, lotes: [] };

  const etiquetas = Math.max(1, Math.min(500, Math.floor(Number(pedido.etiquetas) || 1)));
  const totalBruto = Number(pedido.quantidadeTotal);
  const total = Number.isFinite(totalBruto) && totalBruto > 0 ? totalBruto : etiquetas;

  // Um lote com N etiquetas, ou N lotes de 1 — a escolha da tela.
  const quantosLotes = pedido.codigoUnicoParaTodas ? 1 : etiquetas;
  const porLote = Number((total / quantosLotes).toFixed(4));

  const base = {
    franchiseeId,
    kitchenItemId: pedido.kitchenItemId || null,
    stockItemId: pedido.stockItemId || null,
    // Nome CONGELADO: o QR resolve dados vivos, mas o papel é imutável. Se o
    // produto for renomeado, a etiqueta na geladeira continua dizendo o nome
    // antigo, e a auditoria precisa bater com o que está colado no pote.
    productName: nome,
    loteRef: pedido.loteRef || null,
    fabricadoEm: diaParaData(pedido.fabricadoEm),
    validoAte: diaParaData(pedido.validoAte),
    weightStr: pedido.weightStr || null,
    unit: pedido.unit || "un",
    origem: "ETIQUETA",
    criadoPor: userId,
  };

  const lotes: { code: string; id: string }[] = [];
  for (let i = 0; i < quantosLotes; i++) {
    const code = await codigoInedito();
    const criado = await prisma.stockLot.create({
      data: {
        ...base,
        code,
        quantidadeInicial: porLote,
        quantidadeRestante: porLote,
        impressoes: pedido.codigoUnicoParaTodas ? etiquetas : 1,
      },
      select: { id: true, code: true },
    });
    lotes.push(criado);
  }

  return { ok: true as const, lotes, etiquetas };
}

/**
 * Reimpressão: soma em `impressoes` e devolve o MESMO código.
 *
 * Nunca gera código novo. O que gera lote novo é transformação real do alimento
 * — descongelou, porcionou, mudou a validade. Reimprimir porque a etiqueta
 * rasgou não é lote novo, e tratar como se fosse encheria o estoque de lotes
 * fantasma que nunca serão baixados.
 */
export async function registrarReimpressao(code: string, quantas = 1) {
  const { franchiseeId } = await lojaDaSessao();
  if (!(await temEstruturaDeLotes())) return { ok: false as const };

  const { count } = await prisma.stockLot.updateMany({
    where: { code: String(code || "").toUpperCase(), franchiseeId },
    data: { impressoes: { increment: Math.max(1, Math.floor(quantas)) } },
  });
  return { ok: count > 0 };
}
