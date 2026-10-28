/**
 * /src/lib/uso-legado.ts
 *
 * Quem ainda usa os caminhos ANTIGOS que a fase 2 de segurança vai travar,
 * por loja e por dia, gravado no banco. O `console.log` que já existe zera a
 * cada deploy: com ele não dá para provar "2 dias sem uso".
 *
 *   assistente-sem-token — fila da impressão sem o token do Assistente
 *                          (lib/token-do-assistente.ts). Critério de travar:
 *                          detalhe com `sessao=nao` zerado.
 *   extensao-token-cru   — extensão com o id cru da loja (lib/extensao-token.ts).
 *   motoboy-sem-sessao   — app/página do motoboy com o par motoboyId/storeId
 *                          solto, sem `Authorization: Bearer` (api/motoboys/*).
 *
 * SÓ CONTA: `anotarUsoLegado` nunca lança, nunca é esperado e não muda nada
 * para quem chamou. Para não pesar no banco, soma em memória e grava no máximo
 * uma vez a cada 10 min por (tipo, loja, detalhe, dia): o GET da fila roda a
 * cada 3 s por loja. Com duas instâncias do servidor cada uma soma a sua parte
 * e o banco junta (`vezes = vezes + EXCLUDED.vezes`); a memória nunca é a
 * verdade, só o que falta gravar.
 *
 * Loja que não existe não vira linha (o INSERT confere "User"): id inventado
 * na URL não enche a tabela.
 *
 * Tabela fora do schema.prisma, como MotoboyAcertoPago (lib/acerto-pago.ts):
 *   UsoLegado — uma linha por (tipo, lojaId, detalhe, dia em São Paulo).
 */
import { prisma } from "@/lib/prisma";
import { executarDDL } from "@/lib/ddl-do-boot";

export type TipoDeUsoLegado = "assistente-sem-token" | "extensao-token-cru" | "motoboy-sem-sessao";
export const TIPOS_DE_USO_LEGADO: readonly TipoDeUsoLegado[] = ["assistente-sem-token", "extensao-token-cru", "motoboy-sem-sessao"];

/** No máximo uma gravação por chave nesta janela. */
export const JANELA_DA_GRAVACAO_MS = 10 * 60_000;
/** Teto de chaves em memória (lojas × tipos × detalhes × dia). */
const TETO_DE_CHAVES = 5000;

const ehPostgres = () => /^postgres/i.test(process.env.DATABASE_URL || "");

const DIA_EM_SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
/** "AAAA-MM-DD" do calendário de São Paulo. */
export function diaEmSaoPaulo(ms: number): string {
  return DIA_EM_SP.format(new Date(ms));
}

// ── Tabela ──────────────────────────────────────────────────────────────────

let tabela: Promise<boolean> | null = null;

export function garantirTabelaDoUsoLegado(): Promise<boolean> {
  if (!ehPostgres()) return Promise.resolve(false);
  if (!tabela) {
    tabela = (async () => {
      try {
        await executarDDL("uso-legado", [
          `CREATE TABLE IF NOT EXISTS "UsoLegado" (
      "tipo" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "detalhe" TEXT NOT NULL DEFAULT '',
      "dia" DATE NOT NULL,
      "vezes" INTEGER NOT NULL DEFAULT 0,
      "ultimoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "UsoLegado_pkey" PRIMARY KEY ("tipo", "lojaId", "detalhe", "dia")
    )`,
          `CREATE INDEX IF NOT EXISTS "UsoLegado_dia_idx" ON "UsoLegado"("dia")`,
        ]);
        return true;
      } catch (err: any) {
        avisar(`tabela UsoLegado falhou: ${err?.message}`);
        tabela = null; // a próxima gravação tenta de novo
        return false;
      }
    })();
  }
  return tabela;
}

let avisadoEm = 0;
function avisar(msg: string) {
  // Banco fora do ar não pode virar enxurrada de log: uma linha a cada 30 min.
  if (Date.now() - avisadoEm < 30 * 60_000) return;
  avisadoEm = Date.now();
  console.warn(`[Uso legado] ${msg}`);
}

// ── Acúmulo em memória ──────────────────────────────────────────────────────

type Conta = {
  tipo: TipoDeUsoLegado;
  lojaId: string;
  detalhe: string;
  dia: string;
  /** Chamadas ainda não gravadas. */
  pendentes: number;
  ultimoEm: number;
  gravadoEm: number;
  gravando: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

const contas = new Map<string, Conta>();
const emVoo = new Set<Promise<void>>();

const SQL_GRAVAR = `INSERT INTO "UsoLegado" ("tipo", "lojaId", "detalhe", "dia", "vezes", "ultimoEm")
  SELECT $1, $2, $3, $4::date, $5, ($6::timestamptz AT TIME ZONE 'UTC')
  WHERE EXISTS (SELECT 1 FROM "User" WHERE "id" = $2)
  ON CONFLICT ("tipo", "lojaId", "detalhe", "dia") DO UPDATE
  SET "vezes" = "UsoLegado"."vezes" + EXCLUDED."vezes",
      "ultimoEm" = GREATEST("UsoLegado"."ultimoEm", EXCLUDED."ultimoEm")`;

async function gravar(c: Conta, vezes: number, ultimoEm: number): Promise<boolean> {
  try {
    if (!(await garantirTabelaDoUsoLegado())) return false;
    await prisma.$executeRawUnsafe(SQL_GRAVAR, c.tipo, c.lojaId, c.detalhe, c.dia, vezes, new Date(ultimoEm).toISOString());
    return true;
  } catch (err: any) {
    avisar(`não gravei ${c.tipo} loja=${c.lojaId}: ${String(err?.message || err).slice(0, 120)}`);
    return false;
  }
}

function tentarGravar(c: Conta, agora: number) {
  if (c.gravando || c.pendentes === 0) return;
  const falta = c.gravadoEm + JANELA_DA_GRAVACAO_MS - agora;
  if (falta > 0) {
    // Ninguém mais chamando: o resto da janela sai sozinho quando ela fecha.
    if (!c.timer) {
      c.timer = setTimeout(() => { c.timer = null; tentarGravar(c, Date.now()); }, falta);
      (c.timer as any).unref?.();
    }
    return;
  }
  const vezes = c.pendentes;
  const ultimoEm = c.ultimoEm;
  c.pendentes = 0;
  c.gravadoEm = agora;
  c.gravando = true;
  const p: Promise<void> = gravar(c, vezes, ultimoEm).then((ok) => {
    if (!ok) c.pendentes += vezes; // volta para a próxima janela
  }).finally(() => {
    c.gravando = false;
    emVoo.delete(p);
    if (c.pendentes > 0) tentarGravar(c, Date.now());
  });
  emVoo.add(p);
}

/** Tira uma conta já gravada e parada, para caber a nova. */
function abrirEspaco(): boolean {
  for (const [k, c] of contas) {
    if (c.pendentes === 0 && !c.gravando && !c.timer) {
      contas.delete(k);
      return true;
    }
  }
  return false;
}

/**
 * Conta uma chamada do caminho antigo. Fire-and-forget: devolve na hora, nunca
 * lança. Sem banco postgres, não faz nada.
 */
export function anotarUsoLegado(tipo: TipoDeUsoLegado, lojaId: string | null | undefined, detalhe = "", agora = Date.now()): void {
  try {
    if (!ehPostgres()) return;
    const loja = String(lojaId ?? "").trim();
    if (!loja || loja === "-" || loja.length > 64) return;
    const det = String(detalhe ?? "").slice(0, 120);
    const dia = diaEmSaoPaulo(agora);
    const k = `${tipo}|${loja}|${det}|${dia}`;
    let c = contas.get(k);
    if (!c) {
      if (contas.size >= TETO_DE_CHAVES && !abrirEspaco()) return;
      c = { tipo, lojaId: loja, detalhe: det, dia, pendentes: 0, ultimoEm: 0, gravadoEm: 0, gravando: false, timer: null };
      contas.set(k, c);
    }
    c.pendentes++;
    if (agora > c.ultimoEm) c.ultimoEm = agora;
    tentarGravar(c, agora);
  } catch {
    // contar nunca derruba quem chamou
  }
}

/** Para os testes: o que está em memória e a espera das gravações em voo. */
export const usoLegadoParaTeste = {
  contas: () => contas as ReadonlyMap<string, Readonly<Conta>>,
  /** Roda a gravação de quem tem pendência com a janela vencida em `agora`. */
  descarregar: (agora: number) => { for (const c of contas.values()) tentarGravar(c, agora); },
  esperar: async () => { while (emVoo.size) await Promise.all([...emVoo]); },
  zerar: () => { for (const c of contas.values()) if (c.timer) clearTimeout(c.timer); contas.clear(); tabela = null; },
};

// ── Leitura (rota da equipe interna) ────────────────────────────────────────

export type LinhaDoUsoLegado = {
  tipo: string;
  lojaId: string;
  detalhe: string;
  dia: string;
  vezes: number;
  ultimoEm: Date | string;
  storeName: string | null;
  slug: string | null;
};

export type LojaNoUsoLegado = {
  lojaId: string;
  storeName: string | null;
  slug: string | null;
  vezes: number;
  diasComUso: number;
  ultimoUso: string;
  detalhes: { detalhe: string; vezes: number; diasComUso: number; ultimoUso: string }[];
};

const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();

/** Junta as linhas por tipo → loja, mais o resumo `{ tipo, lojas, ultimoUso }`. */
export function resumirUsoLegado(linhas: LinhaDoUsoLegado[]) {
  const porTipo: Record<string, LojaNoUsoLegado[]> = {};
  const lojas = new Map<string, { loja: LojaNoUsoLegado; dias: Set<string>; detalhes: Map<string, { vezes: number; dias: Set<string>; ultimo: string }> }>();
  for (const l of linhas) {
    const k = `${l.tipo}|${l.lojaId}`;
    let e = lojas.get(k);
    if (!e) {
      e = { loja: { lojaId: l.lojaId, storeName: l.storeName, slug: l.slug, vezes: 0, diasComUso: 0, ultimoUso: "", detalhes: [] }, dias: new Set(), detalhes: new Map() };
      lojas.set(k, e);
      (porTipo[l.tipo] ||= []).push(e.loja);
    }
    const vezes = Number(l.vezes) || 0;
    const ultimo = iso(l.ultimoEm);
    e.loja.vezes += vezes;
    e.dias.add(l.dia);
    if (ultimo > e.loja.ultimoUso) e.loja.ultimoUso = ultimo;
    const d = e.detalhes.get(l.detalhe) || { vezes: 0, dias: new Set<string>(), ultimo: "" };
    d.vezes += vezes;
    d.dias.add(l.dia);
    if (ultimo > d.ultimo) d.ultimo = ultimo;
    e.detalhes.set(l.detalhe, d);
  }
  for (const e of lojas.values()) {
    e.loja.diasComUso = e.dias.size;
    e.loja.detalhes = [...e.detalhes].map(([detalhe, d]) => ({ detalhe, vezes: d.vezes, diasComUso: d.dias.size, ultimoUso: d.ultimo })).sort((a, b) => b.vezes - a.vezes);
  }
  for (const t of Object.keys(porTipo)) porTipo[t].sort((a, b) => b.ultimoUso.localeCompare(a.ultimoUso));
  const tipos = [...new Set([...TIPOS_DE_USO_LEGADO, ...Object.keys(porTipo)])];
  const resumo = tipos.map((tipo) => ({
    tipo,
    lojas: porTipo[tipo]?.length || 0,
    ultimoUso: (porTipo[tipo] || []).reduce<string | null>((m, l) => (!m || l.ultimoUso > m ? l.ultimoUso : m), null),
  }));
  return { resumo, porTipo };
}

/** As linhas dos últimos `dias` dias (contando hoje, em São Paulo). */
export async function lerUsoLegado(dias: number, agora = Date.now()): Promise<{ desde: string; linhas: LinhaDoUsoLegado[] }> {
  const desde = diaEmSaoPaulo(agora - (dias - 1) * 24 * 3600_000);
  if (!(await garantirTabelaDoUsoLegado())) return { desde, linhas: [] };
  const linhas = await prisma.$queryRawUnsafe<LinhaDoUsoLegado[]>(
    `SELECT u."tipo", u."lojaId", u."detalhe", u."dia"::text AS "dia", u."vezes", u."ultimoEm",
            s."storeName", s."slug"
       FROM "UsoLegado" u LEFT JOIN "User" s ON s."id" = u."lojaId"
      WHERE u."dia" >= $1::date
      ORDER BY u."dia" DESC`,
    desde,
  );
  return { desde, linhas };
}
