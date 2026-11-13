/**
 * O TURNO DO OPERADOR num computador de caixa: abertura com fundo de troco,
 * sangria, suprimento e fechamento com a conferência por forma.
 *
 * ── Por que um turno próprio, e não o caixa da loja ─────────────────────────
 *
 * O caixa da loja (CashSession) é UM por loja: o expediente. Mercado tem vários
 * computadores e cada operador responde pela SUA gaveta. O caixa da loja
 * continua sendo o expediente (a trava "caixa aberto", o fechamento do dia, o
 * financeiro) e o turno é o sub-caixa de cada computador. Para o fechamento
 * da loja continuar batendo, o dinheiro que entra ou sai da gaveta FORA de
 * venda vira movimentação no caixa da loja (CashMovement):
 *   fundo do turno e suprimento → ENTRADA; sangria → SAIDA.
 * As vendas já entram no caixa da loja sozinhas: são pedidos do período.
 * Sem caixa da loja aberto, abrir o turno abre o da loja (troco 0).
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { gravarQuemAbriu } from "@/lib/quem-abriu-o-caixa";
import { garantirEstruturaDoCaixa, MENSAGEM_SEM_ESTRUTURA } from "./estrutura";
import { diferencaDoTurno, esperadoDoTurno, reais, somarPorForma, type PagamentoDoCaixa } from "./conta";
import type { TerminalDoCaixa } from "./terminal";
import type { QuemUsaOCaixa } from "./sessao";

export type TurnoDoCaixa = {
  id: string;
  terminalId: string;
  operador: string;
  operadorId: string | null;
  abertoEm: string;
  fundoCentavos: number;
  fechadoEm: string | null;
};

const publico = (t: any): TurnoDoCaixa => ({
  id: t.id, terminalId: t.terminalId, operador: t.operador, operadorId: t.operadorId ?? null,
  abertoEm: new Date(t.abertoEm).toISOString(), fundoCentavos: Number(t.fundoCentavos) || 0,
  fechadoEm: t.fechadoEm ? new Date(t.fechadoEm).toISOString() : null,
});

export async function turnoAberto(terminalId: string): Promise<TurnoDoCaixa | null> {
  if (!(await garantirEstruturaDoCaixa())) return null;
  const [t] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CaixaMercadoTurno" WHERE "terminalId" = $1 AND "fechadoEm" IS NULL ORDER BY "abertoEm" DESC LIMIT 1`,
    terminalId,
  );
  return t ? publico(t) : null;
}

/** O caixa da loja aberto; sem nenhum, abre um (troco 0) em nome de quem está no caixa. */
async function caixaDaLojaAberto(lojaId: string, quem: QuemUsaOCaixa): Promise<string> {
  const aberto = await prisma.cashSession.findFirst({ where: { franchiseeId: lojaId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true } });
  if (aberto) return aberto.id;
  const novo = await prisma.cashSession.create({
    data: { franchiseeId: lojaId, openingAmount: 0, status: "OPEN", notes: "Aberto pelo Caixa de mercado" },
    select: { id: true },
  });
  await gravarQuemAbriu(novo.id, lojaId, { nome: quem.nome, email: quem.email, papel: quem.dono ? "DONO" : "FUNCIONARIO" } as any).catch(() => false);
  return novo.id;
}

async function espelharNoCaixaDaLoja(cashSessionId: string, lojaId: string, tipo: "ENTRADA" | "SAIDA", centavos: number, descricao: string, por: string | null) {
  const m = await prisma.cashMovement.create({
    data: { cashSessionId, franchiseeId: lojaId, tipo, valor: Number((centavos / 100).toFixed(2)), descricao: descricao.slice(0, 200), criadoPor: por },
    select: { id: true },
  });
  return m.id;
}

export async function abrirTurno(terminal: TerminalDoCaixa, quem: QuemUsaOCaixa, fundoCentavos: number): Promise<TurnoDoCaixa> {
  if (!(await garantirEstruturaDoCaixa())) throw new Error(MENSAGEM_SEM_ESTRUTURA);
  const jaAberto = await turnoAberto(terminal.id);
  if (jaAberto) return jaAberto;
  if (!Number.isInteger(fundoCentavos) || fundoCentavos < 0 || fundoCentavos > 10_000_00) throw new Error("Fundo de troco inválido.");
  const cashSessionId = await caixaDaLojaAberto(terminal.lojaId, quem);
  const id = crypto.randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CaixaMercadoTurno" ("id", "lojaId", "terminalId", "operador", "operadorId", "abertoEm", "fundoCentavos", "cashSessionId")
     VALUES ($1, $2, $3, $4, $5, (NOW() AT TIME ZONE 'UTC'), $6, $7)`,
    id, terminal.lojaId, terminal.id, quem.nome.slice(0, 80), quem.usuarioId, fundoCentavos, cashSessionId,
  );
  if (fundoCentavos > 0) {
    await espelharNoCaixaDaLoja(cashSessionId, terminal.lojaId, "ENTRADA", fundoCentavos, `Fundo de troco — ${terminal.nome} (${quem.nome})`, quem.email).catch((e) =>
      console.error("[Caixa de mercado] fundo não espelhou no caixa da loja:", e?.message),
    );
  }
  return (await turnoAberto(terminal.id))!;
}

export async function movimentarTurno(
  turno: TurnoDoCaixa,
  terminal: TerminalDoCaixa,
  quem: QuemUsaOCaixa,
  tipo: "SANGRIA" | "SUPRIMENTO",
  centavos: number,
  descricao: string | null,
): Promise<void> {
  if (!Number.isInteger(centavos) || centavos <= 0 || centavos > 10_000_000) throw new Error("Valor inválido.");
  const texto = `${tipo === "SANGRIA" ? "Sangria" : "Suprimento"} — ${terminal.nome} (${quem.nome})${descricao ? `: ${descricao}` : ""}`;
  let cashMovementId: string | null = null;
  const caixa = await prisma.cashSession.findFirst({ where: { franchiseeId: terminal.lojaId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true } });
  if (caixa) cashMovementId = await espelharNoCaixaDaLoja(caixa.id, terminal.lojaId, tipo === "SANGRIA" ? "SAIDA" : "ENTRADA", centavos, texto, quem.email);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CaixaMercadoMovimento" ("id", "turnoId", "lojaId", "tipo", "valorCentavos", "descricao", "criadoPor", "em", "cashMovementId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, (NOW() AT TIME ZONE 'UTC'), $8)`,
    crypto.randomUUID(), turno.id, terminal.lojaId, tipo, centavos, descricao ? descricao.slice(0, 200) : null, quem.nome, cashMovementId,
  );
}

export type ResumoDoTurno = {
  turno: TurnoDoCaixa;
  vendas: number;
  totalVendidoCentavos: number;
  porForma: Record<string, number>;
  movimentos: { tipo: "SANGRIA" | "SUPRIMENTO"; valorCentavos: number; descricao: string | null; em: string; por: string | null }[];
  esperado: Record<string, number>;
};

export async function resumoDoTurno(turno: TurnoDoCaixa): Promise<ResumoDoTurno> {
  const vendas = await prisma.$queryRawUnsafe<{ pagamentos: unknown; totalCentavos: number }[]>(
    `SELECT "pagamentos", "totalCentavos" FROM "CaixaMercadoVenda" WHERE "turnoId" = $1 AND "situacao" = 'CONCLUIDA'`,
    turno.id,
  );
  const movs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "tipo", "valorCentavos", "descricao", "em", "criadoPor" FROM "CaixaMercadoMovimento" WHERE "turnoId" = $1 ORDER BY "em" ASC`,
    turno.id,
  );
  const lerPag = (b: unknown): PagamentoDoCaixa[] => {
    const v = typeof b === "string" ? JSON.parse(b) : b;
    return Array.isArray(v) ? v : [];
  };
  const porForma = somarPorForma(vendas.map((v) => lerPag(v.pagamentos)));
  const movimentos = movs.map((m) => ({ tipo: m.tipo, valorCentavos: Number(m.valorCentavos), descricao: m.descricao, em: new Date(m.em).toISOString(), por: m.criadoPor }));
  return {
    turno,
    vendas: vendas.length,
    totalVendidoCentavos: vendas.reduce((s, v) => s + Number(v.totalCentavos), 0),
    porForma,
    movimentos,
    esperado: esperadoDoTurno(turno.fundoCentavos, porForma, movimentos),
  };
}

export async function fecharTurno(
  turno: TurnoDoCaixa,
  quem: QuemUsaOCaixa,
  contado: Record<string, number | null>,
  obs: string | null,
): Promise<ResumoDoTurno & { diferencaCentavos: number | null }> {
  const pendente = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS "n" FROM "CaixaMercadoVenda" WHERE "turnoId" = $1 AND "situacao" = 'AGUARDANDO_TEF'`,
    turno.id,
  );
  if (Number(pendente[0]?.n) > 0) throw new Error("Há uma venda esperando o pinpad. Conclua ou cancele antes de fechar o turno.");
  const resumo = await resumoDoTurno(turno);
  const limpo: Record<string, number | null> = {};
  for (const [forma, v] of Object.entries(contado || {})) limpo[forma] = v == null || v === ("" as any) ? null : Math.round(Number(v));
  const diferencaCentavos = diferencaDoTurno(resumo.esperado, limpo);
  await prisma.$executeRawUnsafe(
    `UPDATE "CaixaMercadoTurno" SET "fechadoEm" = (NOW() AT TIME ZONE 'UTC'), "fechadoPor" = $2, "esperado" = $3::jsonb, "contado" = $4::jsonb, "diferencaCentavos" = $5, "obs" = $6
      WHERE "id" = $1 AND "fechadoEm" IS NULL`,
    turno.id, quem.nome, JSON.stringify(resumo.esperado), JSON.stringify(limpo), diferencaCentavos, obs ? obs.slice(0, 500) : null,
  );
  return { ...resumo, diferencaCentavos };
}

/** "Falta R$ 2,00" / "Sobra R$ 1,50" / "Confere". */
export function textoDaDiferenca(c: number | null): string {
  if (c == null) return "Sem conferência";
  if (c === 0) return "Confere";
  return c < 0 ? `Falta ${reais(-c)}` : `Sobra ${reais(c)}`;
}
