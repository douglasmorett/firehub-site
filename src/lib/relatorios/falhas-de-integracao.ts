/**
 * O relatório "Pedidos com falha na integração" — o pedido de app (iFood,
 * 99Food) que não entrou no FireHub. O SWFast tem; aqui não existia, e a falha
 * só aparecia num aviso de WhatsApp para a equipe (lib/server-monitor.ts,
 * `alertarFalhaDeIntegracao`) e no log do servidor, que some no restart.
 *
 * ── De onde vem ─────────────────────────────────────────────────────────────
 *
 * Desde 07/11/2026 o ponto de falha das duas integrações principais grava a
 * falha (lib/falhas-de-integracao-no-banco.ts, tabela FalhaDeIntegracao):
 *
 * - iFood, no polling (lib/ifood-eventos.ts): o iFood não devolveu os
 *   detalhes do pedido, ou a gravação deu erro. O evento fica sem confirmação
 *   e volta no próximo polling — cada volta que falha de novo soma uma
 *   tentativa na MESMA linha. O webhook do iFood não grava: o corpo dele vem
 *   da internet aberta (um id inventado viraria "falha" na loja de alguém), e
 *   o mesmo pedido passa pelo polling de qualquer jeito.
 * - 99Food, no webhook (api/99food/webhook): o order/detail recusou o pedido
 *   (ou a conta está sem token), ou a gravação deu erro.
 *
 * O pedido de loja que não está ligada a nenhuma conta não entra: não há de
 * quem ser o relatório (esse continua no diagnóstico do 99Food e no log).
 *
 * ── "Entrou depois" é conferido, não gravado ────────────────────────────────
 *
 * A rota olha se o pedido existe HOJE (pelo id do parceiro). Assim nenhuma
 * linha da integração precisa mexer na falha quando a nova tentativa dá
 * certo, e a resposta nunca fica velha.
 *
 * Puro (sem banco). Testado em scripts/teste-falhas-de-integracao.ts.
 */
import { naLoja } from "@/lib/relatorios/base";

/** Desde quando as falhas são gravadas: antes disso o relatório não tem o que mostrar. */
export const FALHAS_REGISTRADAS_DESDE = "2026-11-07";

export type PlataformaDaFalha = "IFOOD" | "99FOOD";
export const PLATAFORMAS_DA_FALHA: PlataformaDaFalha[] = ["IFOOD", "99FOOD"];
export const NOME_DA_PLATAFORMA: Record<PlataformaDaFalha, string> = { IFOOD: "iFood", "99FOOD": "99Food" };

/** Uma falha como a rota lê do banco, já com o pedido que entrou depois (se entrou). */
export type FalhaDoBanco = {
  id: string;
  plataforma: string;
  pedidoExterno: string;
  codigo: string | null;
  erro: string;
  tentativas: number;
  primeiraEm: Date | string;
  ultimaEm: Date | string;
  /** O pedido com o mesmo id do parceiro, hoje no banco: entrou depois. */
  pedidoId: string | null;
  numeroDoPedido: number | null;
};

export type LinhaDaFalha = {
  id: string;
  plataforma: string;
  nomeDaPlataforma: string;
  /** A primeira falha, no relógio da loja. */
  quando: string;
  dia: string;
  hora: string;
  ultimaEm: string;
  /** O número que o lojista procura no app do parceiro; sem ele, o começo do id. */
  codigo: string;
  pedidoExterno: string;
  /** O que aconteceu, em linguagem de lojista. */
  oQueAconteceu: string;
  /** O erro técnico, para quem for conferir com o suporte. */
  detalhe: string;
  tentativas: number;
  entrou: boolean;
  numeroDoPedido: number | null;
  situacao: string;
};

export type ResultadoDasFalhas = {
  total: number;
  entraram: number;
  naoEntraram: number;
  porPlataforma: { plataforma: string; nome: string; total: number; naoEntraram: number }[];
  lista: LinhaDaFalha[];
};

const nomeDe = (p: string) => NOME_DA_PLATAFORMA[p as PlataformaDaFalha] || p;

/**
 * O erro técnico em uma frase que o lojista entende. A ordem importa: o
 * "recusou em 2 token(s)" do 99Food não é problema de token, é recusa do
 * order/detail; o erro do Prisma pode trazer um número que parece HTTP.
 */
export function erroEmLinguagemSimples(plataforma: string, erro: string): string {
  const p = nomeDe(plataforma);
  const e = String(erro || "").toLowerCase();
  if (/auth_token|errno -2\b/.test(e)) return `A loja não está conectada ao ${p}: o FireHub não tem a chave para buscar o pedido. Reconecte em Integrações.`;
  if (/order\/detail recusou/.test(e)) return `O ${p} recusou mandar os detalhes do pedido ao FireHub.`;
  if (/prisma|database|can't reach|connection (pool|terminated|refused)|\bp10\d\d\b|\bp20(24|28)\b|transaction/.test(e)) return "O banco do FireHub não respondeu na hora (instabilidade do nosso lado).";
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden/.test(e)) return `O ${p} recusou o acesso do FireHub ao pedido: a conexão da loja com o ${p} pode ter caído.`;
  if (/\b404\b|not found/.test(e)) return `O ${p} não achou o pedido quando o FireHub foi buscar.`;
  if (/\b(429|500|502|503|504)\b|timeout|timed out|fetch failed|econnreset|socket|network/.test(e)) return `O ${p} não respondeu na hora (fora do ar ou lento).`;
  return "O pedido chegou, mas deu erro ao gravar no FireHub.";
}

/** A situação de hoje, em uma frase curta. */
export function situacaoDaFalha(f: Pick<FalhaDoBanco, "pedidoId" | "numeroDoPedido" | "tentativas">): string {
  if (f.pedidoId) return f.numeroDoPedido != null ? `Entrou depois — pedido #${f.numeroDoPedido}` : "Entrou depois";
  return f.tentativas > 1 ? `Não entrou (${f.tentativas} tentativas)` : "Não entrou";
}

const hhmm = (h: number, minutos: number) => `${String(h).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
const iso = (d: Date | string) => new Date(d).toISOString();

/** A lista do relatório (a mais recente primeiro) e os totais. */
export function falhasDoRelatorio(falhas: FalhaDoBanco[], tz: string): ResultadoDasFalhas {
  const lista: LinhaDaFalha[] = falhas
    .filter((f) => Number.isFinite(new Date(f.primeiraEm).getTime()))
    .sort((a, b) => new Date(b.primeiraEm).getTime() - new Date(a.primeiraEm).getTime())
    .map((f) => {
      const onde = naLoja(f.primeiraEm, tz);
      const codigo = String(f.codigo || "").trim();
      return {
        id: f.id,
        plataforma: f.plataforma,
        nomeDaPlataforma: nomeDe(f.plataforma),
        quando: iso(f.primeiraEm),
        dia: onde.dia,
        hora: hhmm(onde.hora, onde.minutos),
        ultimaEm: iso(f.ultimaEm),
        codigo: codigo ? `#${codigo.replace(/^#/, "")}` : `id ${String(f.pedidoExterno).slice(0, 8)}…`,
        pedidoExterno: f.pedidoExterno,
        oQueAconteceu: erroEmLinguagemSimples(f.plataforma, f.erro),
        detalhe: String(f.erro || "").slice(0, 500),
        tentativas: Math.max(1, Number(f.tentativas) || 1),
        entrou: Boolean(f.pedidoId),
        numeroDoPedido: f.numeroDoPedido ?? null,
        situacao: situacaoDaFalha({ ...f, tentativas: Math.max(1, Number(f.tentativas) || 1) }),
      };
    });
  const entraram = lista.filter((l) => l.entrou).length;
  const plataformas = [...new Set([...PLATAFORMAS_DA_FALHA.filter((p) => lista.some((l) => l.plataforma === p)), ...lista.map((l) => l.plataforma)])];
  return {
    total: lista.length,
    entraram,
    naoEntraram: lista.length - entraram,
    porPlataforma: plataformas.map((p) => {
      const dela = lista.filter((l) => l.plataforma === p);
      return { plataforma: p, nome: nomeDe(p), total: dela.length, naoEntraram: dela.filter((l) => !l.entrou).length };
    }),
    lista,
  };
}
