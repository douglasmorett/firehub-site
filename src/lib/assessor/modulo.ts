/**
 * O CONTRATO DE UM MÓDULO DO BILL — cada área do sistema (busca, cardápio,
 * loja, caixa, pedidos, marketing, equipe, estoque/fiscal) entra no Bill como
 * um módulo em ./modulos/, sem mexer em ferramentas.ts nem em assessor.ts:
 * a lista `MODULOS_DO_BILL` (./modulos/index.ts) é lida pelos dois.
 *
 * Douglas, 18/11/2026: "ele tem que conseguir buscar no sistema, ativar e usar
 * qualquer coisa pro dono de restaurante". Mapa e fases no vault:
 * Projetos/FireHub - Bill controla o sistema (mapa 18-11).md.
 *
 * Regras de todo módulo:
 * - Grava pelo MESMO caminho da tela do painel (a lib que a rota usa), nunca
 *   por um atalho próprio; sempre filtrado por `ctx.franchiseeId`.
 * - Todo gravar vira um AssessorRegistro (`registrarNoBill`) com refs para
 *   desfazer; o tipo é do módulo (prefixo próprio) e `desfazer` o reconhece.
 * - Ação destrutiva, de dinheiro ou que o cliente vê na hora (cancelar pedido,
 *   mudar preço, desligar robô…) passa por `pedirConfirmacao`: a 1ª chamada só
 *   descreve o que vai acontecer; a 2ª, com `confirmado: true`, faz.
 */
import { prisma } from "@/lib/prisma";
import type { ContextoDoAssessor } from "./ferramentas";
import { comAutor } from "./painel";

export type Resultado = Record<string, unknown>;

export type ModuloDoBill = {
  /** Nome curto (log e teste). */
  nome: string;
  /** Declarações no formato do Gemini (Type.OBJECT…); o caminho do Claude converte sozinho. */
  declaracoes: any[];
  /** Nomes das ferramentas que GRAVAM (a resposta sem elas não pode dizer "fiz"). */
  gravam: string[];
  /** Trecho do prompt: como e quando usar as ferramentas deste módulo (sem numeração). */
  regras: string;
  /** Executa a ferramenta; `null` = não é deste módulo. */
  executar: (nome: string, args: any, ctx: ContextoDoAssessor) => Promise<Resultado | null>;
  /** Tipos de AssessorRegistro que este módulo grava. */
  tipos?: string[];
  /** Desfaz um registro deste módulo; `null` = tipo não é deste módulo. */
  desfazer?: (tipo: string, refs: any, ctx: ContextoDoAssessor) => Promise<Resultado | null>;
};

/** O histórico do Bill (aparece em /store/bill e o "desfaz" alcança). Nunca derruba a ação já feita. */
export async function registrarNoBill(ctx: ContextoDoAssessor, tipo: string, resumo: string, refs: Record<string, unknown>): Promise<void> {
  try {
    await prisma.assessorRegistro.create({
      data: { franchiseeId: ctx.franchiseeId, tipo, resumo: resumo.slice(0, 500), refs: comAutor(refs, ctx) as any, canal: ctx.canal, telefone: ctx.telefone || null },
    });
  } catch (err: any) {
    console.error("[Assessor] Não gravou o registro:", err?.message);
  }
}

/**
 * Confirmação em 2 etapas. Sem `args.confirmado === true`, devolve o pedido de
 * confirmação (nada é feito); o prompt manda perguntar ao dono e só chamar de
 * novo com confirmado=true depois do "sim".
 */
export function pedirConfirmacao(args: any, oQueVaiAcontecer: string): Resultado | null {
  if (args?.confirmado === true) return null;
  return { ok: false, precisaConfirmar: true, pergunta: `${oQueVaiAcontecer} Confirma?`, observacao: "NADA foi feito ainda. Pergunte ao dono e, com o sim, chame de novo com confirmado=true." };
}

/** Parâmetro padrão das ferramentas com confirmação. */
export const PARAMETRO_CONFIRMADO = { type: "BOOLEAN", description: "true SÓ depois que o dono respondeu sim à pergunta de confirmação." };

export const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const reais = (n: number) => `R$ ${(Number(n) || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
