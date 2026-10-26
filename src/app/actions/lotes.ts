"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { temEstruturaDeLotes, garantirEstruturaDeLotes } from "@/lib/garantir-colunas";
import { gerarCodigoDeLote } from "@/lib/lote";
import { lerTipo, lerConservacao, diaLocal, somarDias, instanteDaHoraLocal, fimDoDiaLocal } from "@/lib/etiqueta-validade";
import { gravarPerda, PREFIXO_DO_FIREHUB } from "@/lib/cmv/desperdicio";
import crypto from "crypto";

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
  // ── A etiqueta de validade (lib/etiqueta-validade.ts) ──
  tipoEtiqueta?: string | null;
  conservacao?: string | null;
  manipuladoEm?: string | null;  // ISO, instante
  venceEm?: string | null;       // ISO, instante
  validadeComHora?: boolean;
  responsavel?: string | null;
  marca?: string | null;
  fornecedor?: string | null;
  /**
   * false = a etiqueta sai SEM QR. O lote é gravado mesmo assim, porque toda
   * etiqueta entra no histórico e na lista de vencimento; só não aparece como
   * "aguardando" no estoque, já que ninguém vai escanear.
   */
  comQr?: boolean;
};

function instante(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(String(iso));
  return isNaN(d.getTime()) ? null : d;
}

const texto = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max) || null;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

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
    origem: pedido.comQr === false ? "ETIQUETA_SEM_QR" : "ETIQUETA",
    criadoPor: userId,
    tipoEtiqueta: lerTipo(pedido.tipoEtiqueta),
    conservacao: lerConservacao(pedido.conservacao),
    manipuladoEm: instante(pedido.manipuladoEm),
    venceEm: instante(pedido.venceEm),
    validadeComHora: pedido.validadeComHora === true,
    responsavel: texto(pedido.responsavel),
    marca: texto(pedido.marca),
    fornecedor: texto(pedido.fornecedor),
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
 *
 * Devolve o lote GRAVADO, e a tela imprime dele: a data e a validade da
 * reimpressão são as da primeira impressão (Portaria CVS 3/2026, art. 46 —
 * "é vedada a revalidação"). Nada aqui escreve data nenhuma.
 */
export async function registrarReimpressao(code: string, quantas = 1) {
  const { franchiseeId } = await lojaDaSessao();
  if (!(await temEstruturaDeLotes())) return { ok: false as const, lote: null };

  const codigo = String(code || "").toUpperCase();
  const { count } = await prisma.stockLot.updateMany({
    where: { code: codigo, franchiseeId },
    data: { impressoes: { increment: Math.max(1, Math.floor(quantas)) } },
  });
  if (count === 0) return { ok: false as const, lote: null };
  const lote = await prisma.stockLot.findFirst({ where: { code: codigo, franchiseeId }, select: CAMPOS_DA_LISTA });
  return { ok: true as const, lote };
}

// ── A lista de vencimento e o histórico da tela de etiquetas ─────────────

const CAMPOS_DA_LISTA = {
  code: true, productName: true, kitchenItemId: true, stockItemId: true, franchiseeId: true,
  recebidoPorId: true, tipoEtiqueta: true, conservacao: true, manipuladoEm: true, venceEm: true,
  validadeComHora: true, fabricadoEm: true, validoAte: true, responsavel: true, criadoPor: true,
  loteRef: true, marca: true, fornecedor: true, impressoes: true, status: true,
  quantidadeRestante: true, unit: true, createdAt: true, origem: true,
} as const;

const ORIGENS_DE_ETIQUETA = ["ETIQUETA", "ETIQUETA_SEM_QR"];

/**
 * `vencimento`: o que vence até amanhã (e o que já venceu), ainda em uso.
 * `historico`: toda etiqueta emitida no período ("YYYY-MM-DD", fuso da loja;
 * sem período, os últimos 30 dias).
 *
 * O responsável de etiqueta antiga (de antes do campo) sai do login que
 * imprimiu, para o histórico não ficar com a coluna vazia.
 */
export async function listarEtiquetas(modo: "vencimento" | "historico", de?: string, ate?: string) {
  const { franchiseeId } = await lojaDaSessao();
  if (!(await temEstruturaDeLotes())) return { ok: false as const, lotes: [] };

  const hoje = diaLocal(new Date());
  const minhas = { OR: [{ franchiseeId, recebidoPorId: null }, { recebidoPorId: franchiseeId }] };

  const where: any =
    modo === "vencimento"
      ? {
          ...minhas, active: true, status: "ATIVO", origem: { in: ORIGENS_DE_ETIQUETA },
          // `validoAte` é o DIA (meia-noite UTC): até amanhã, inclusive.
          validoAte: { lte: new Date(`${somarDias(hoje, 1)}T00:00:00Z`) },
        }
      : {
          franchiseeId, origem: { in: ORIGENS_DE_ETIQUETA },
          createdAt: {
            gte: instanteDaHoraLocal(`${de && DIA.test(de) ? de : somarDias(hoje, -30)}T00:00`)!,
            lte: fimDoDiaLocal(ate && DIA.test(ate) ? ate : hoje)!,
          },
        };

  const lotes = await prisma.stockLot.findMany({
    where,
    select: CAMPOS_DA_LISTA,
    orderBy: modo === "vencimento" ? [{ validoAte: "asc" }] : [{ createdAt: "desc" }],
    take: modo === "vencimento" ? 300 : 3000,
  });

  const semNome = [...new Set(lotes.filter((l) => !l.responsavel && l.criadoPor).map((l) => l.criadoPor!))];
  const nomes = new Map<string, string>();
  if (semNome.length) {
    for (const u of await prisma.user.findMany({ where: { id: { in: semNome } }, select: { id: true, name: true, email: true } })) {
      nomes.set(u.id, u.name || u.email.split("@")[0]);
    }
  }
  return {
    ok: true as const,
    lotes: lotes.map((l) => ({ ...l, responsavel: l.responsavel || (l.criadoPor ? nomes.get(l.criadoPor) || null : null) })),
  };
}

/**
 * "Usei" / "Descartei" de uma etiqueta que NÃO entrou no estoque (sem QR, ou
 * ninguém escaneou). A que entrou vai pela rota do QR (/api/lote/<código>),
 * que dá a baixa no insumo — ver `comoFechar` em lib/etiqueta-validade.ts.
 *
 * O descarte entra no Desperdício do Estoque (a mesma linha do "Lançar
 * desperdício"), sem valor: não houve entrada, então não há insumo a baixar.
 */
export async function fecharEtiquetaSemEstoque(code: string, acao: "USEI" | "DESCARTEI") {
  const session = await getServerSession(authOptions);
  const { franchiseeId, userId } = await lojaDaSessao();
  if (!(await temEstruturaDeLotes())) return { ok: false as const, erro: "Recurso indisponível nesta loja." };

  const lote = await prisma.stockLot.findFirst({
    where: { code: String(code || "").toUpperCase(), franchiseeId, recebidoPorId: null, active: true, status: "ATIVO" },
  });
  if (!lote) return { ok: false as const, erro: "Etiqueta não encontrada, ou já fechada." };

  // Primeiro o lote: dois cliques no "Descartei" não podem lançar o
  // desperdício duas vezes — só quem virou o status grava a linha.
  const { count } = await prisma.stockLot.updateMany({
    where: { id: lote.id, franchiseeId, status: "ATIVO" },
    data: { status: acao === "DESCARTEI" ? "DESCARTADO" : "CONSUMIDO" },
  });
  if (count === 0) return { ok: true as const };

  if (acao === "DESCARTEI") {
    const quem = session?.user?.name || session?.user?.email || "";
    await gravarPerda({
      lojaId: franchiseeId, userId, custos: new Map(), baixas: [], prefixo: "descarte",
      nota: `Descarte pela etiqueta ${lote.code}: ${lote.productName}`.slice(0, 500),
      linha: {
        idExterno: `${PREFIXO_DO_FIREHUB}${crypto.randomUUID()}`, item: lote.productName,
        quantidade: lote.quantidadeRestante, unidade: lote.unit, valorEstimado: null,
        motivo: `Etiqueta ${lote.code} (lista de vencimento)`, funcionario: String(quem).slice(0, 120) || null, foto: null,
        registradoEm: new Date(), situacao: "SEM_CUSTO", casouCom: null, valor: null,
      },
    });
  }
  return { ok: true as const };
}
