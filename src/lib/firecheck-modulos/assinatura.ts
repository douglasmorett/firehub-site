/**
 * A ASSINATURA DO FIRECHECK PELO FIREHUB — Checklist e Controle de ponto
 * ligados no painel e cobrados numa linha própria do boleto da mensalidade.
 *
 * Douglas, 28/10/2026: "liberar esses dois módulos separados, com o mesmo
 * preço que está lá, tudo igual. Mas para o cara só ativar e ser cobrado no
 * pagamento do mês dele." E as regras:
 * - R$ 149 cada; "se ligar os dois juntos, pode cobrar o preço do combo" (R$ 197);
 * - a PRIMEIRA ativação de cada módulo ganha 7 dias grátis; desligou no teste,
 *   não conta;
 * - "usando ou não usando, se tiver ativo vai gerar cobrança" — preço fixo,
 *   como o Multimarcas (não por uso, como o Tablet na mesa);
 * - "ligou, vai pagar o mês inteiro", sem proporcional; desligou depois do
 *   teste, fica liberado até a virada (lib/modulo-pago.ts);
 * - "deixou de pagar qualquer coisinha, bloqueia completo" — o FireCheck lê o
 *   bloqueio da mensalidade em api/integracoes/firecheck/modulos.
 *
 * O FireHub é a fonte da verdade: o FireCheck pergunta o que está ligado e
 * aplica na conta de lá. Nada aqui chama o FireCheck.
 *
 * Loja isenta (parceiro, conta da casa) não paga, mas liga pelo botão como
 * todo mundo — diferente do Bill e do Multimarcas, que ficam sempre ligados
 * para ela. Ligar sozinho aqui mudaria o plano da conta do FireCheck que ela
 * já tem (a Hakim está conectada só para o descarte). Tabela própria criada
 * no primeiro uso: se faltar, só o FireCheck para de cobrar.
 */
import { prisma } from "@/lib/prisma";
import { desligamentoMarcado, ligadoAgora, quandoDesliga } from "@/lib/modulo-pago";
import { DIAS_DE_TESTE_DO_FIRECHECK, MODULOS_DO_FIRECHECK, PRECO_DO_COMBO, PRECO_POR_MODULO, type ModuloDoFirecheck } from "./preco";
import { VERSAO_DO_TERMO_DO_FIRECHECK } from "./termo";

export { DIAS_DE_TESTE_DO_FIRECHECK, PRECO_DO_COMBO, PRECO_POR_MODULO };
export type { ModuloDoFirecheck };
const DIA_MS = 24 * 60 * 60 * 1000;

export type AceiteDoTermo = { versao: string; em: string; email: string | null; ip: string | null; userAgent: string | null };
/** Um trecho ligado de um módulo. `ate` nulo = ligado agora. */
export type TrechoDoFirecheck = { modulo: ModuloDoFirecheck; de: string; ate: string | null; valor: number; aceite?: AceiteDoTermo };
/** Fim dos 7 dias grátis de cada módulo (só a primeira ativação). */
export type TestesDoFirecheck = Partial<Record<ModuloDoFirecheck, string>>;

export type EstadoDoModuloDoFirecheck = {
  ativo: boolean;
  emTeste: boolean;
  testeAte: string | null;
  isento: boolean;
  jaTestou: boolean;
  desligaEm: string | null;
  fimDoMes: string | null;
  preco: number;
};

export type EstadoDoFirecheck = {
  isento: boolean;
  /** A loja já ligou algum módulo alguma vez: a conta do FireCheck passa a seguir o FireHub. */
  peloFirehub: boolean;
  modulos: Record<ModuloDoFirecheck, EstadoDoModuloDoFirecheck>;
  /** O que já entrou no boleto deste mês. */
  valorEsteMes: number;
  fimDoMes: string | null;
};

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "FireCheckAssinatura" (
     "franchiseeId" TEXT NOT NULL,
     "trechos" JSONB NOT NULL DEFAULT '[]',
     "testes" JSONB NOT NULL DEFAULT '{}',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "FireCheckAssinatura_pkey" PRIMARY KEY ("franchiseeId")
   )`,
];

let pronto = false;
export async function garantirEstruturaDoFirecheck(): Promise<boolean> {
  if (pronto) return true;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[FireCheck] Estrutura da assinatura falhou:", err?.message);
  }
  return pronto;
}

type Linha = { trechos: unknown; testes: unknown };

async function lerLinha(franchiseeId: string): Promise<Linha | null> {
  const linhas = await prisma.$queryRawUnsafe<Linha[]>(
    `SELECT "trechos", "testes" FROM "FireCheckAssinatura" WHERE "franchiseeId" = $1`,
    franchiseeId,
  );
  return linhas[0] ?? null;
}

const json = (bruto: unknown) => (typeof bruto === "string" ? (() => { try { return JSON.parse(bruto); } catch { return null; } })() : bruto);

export function lerTrechos(bruto: unknown): TrechoDoFirecheck[] {
  const lista = json(bruto);
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t: any) => t && typeof t.de === "string" && MODULOS_DO_FIRECHECK.includes(t.modulo))
    .map((t: any) => ({ ...t, ate: typeof t.ate === "string" ? t.ate : null, valor: Number(t.valor) || PRECO_POR_MODULO[t.modulo as ModuloDoFirecheck] }));
}

export function lerTestes(bruto: unknown): TestesDoFirecheck {
  const t = json(bruto);
  const testes: TestesDoFirecheck = {};
  if (t && typeof t === "object") for (const m of MODULOS_DO_FIRECHECK) if (typeof (t as any)[m] === "string") testes[m] = (t as any)[m];
  return testes;
}

/**
 * Quanto o FireCheck custa no mês [inicio, fim). Puro, para o teste.
 * Um módulo entra quando ficou ligado em algum instante do mês depois dos
 * dias grátis DELE (o mês inteiro, uma vez só; dois trechos com valores
 * diferentes: vale o maior). Os dois entraram no mesmo mês: o combo.
 */
export function valorDoFirecheckNoMes(
  trechos: TrechoDoFirecheck[],
  testes: TestesDoFirecheck,
  inicio: Date,
  fim: Date,
  agora: Date = new Date(),
): { checklists: number; ponto: number; valor: number } {
  const porModulo = { checklists: 0, ponto: 0 } as Record<ModuloDoFirecheck, number>;
  const fimMs = fim.getTime();
  for (const m of MODULOS_DO_FIRECHECK) {
    const ini = Math.max(inicio.getTime(), testes[m] ? new Date(testes[m]!).getTime() : 0);
    if (ini >= fimMs) continue;
    for (const t of trechos) {
      if (t.modulo !== m) continue;
      const de = Math.max(new Date(t.de).getTime(), ini);
      const ate = Math.min(t.ate ? new Date(t.ate).getTime() : Math.max(agora.getTime(), de + 1), fimMs);
      if (ate > de) porModulo[m] = Math.max(porModulo[m], t.valor);
    }
  }
  const soma = porModulo.checklists + porModulo.ponto;
  const valor = porModulo.checklists > 0 && porModulo.ponto > 0 ? Math.min(soma, PRECO_DO_COMBO) : soma;
  return { ...porModulo, valor };
}

/** A loja não paga: mesma regra (e mesmos campos) da mensalidade. */
export async function firecheckIsento(franchiseeId: string): Promise<boolean> {
  try {
    const { lojaIsenta } = await import("@/lib/billing");
    const loja = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { email: true, planPercent: true, isFranqueadoHakim: true },
    });
    return lojaIsenta(loja as any);
  } catch {
    return false;
  }
}

async function mesCorrente(franchiseeId: string) {
  // Dinâmico: billing.ts importa este arquivo (também dinâmico) no fechamento.
  const { intervaloDoMes, getCurrentYearMonth } = await import("@/lib/billing");
  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeTimezone: true } });
  const tz = loja?.storeTimezone || "America/Sao_Paulo";
  return intervaloDoMes(getCurrentYearMonth(0, tz), tz);
}

export async function estadoDoFirecheck(franchiseeId: string, agora: Date = new Date()): Promise<EstadoDoFirecheck> {
  const isento = await firecheckIsento(franchiseeId);
  let mes: { monthStart: Date; monthEnd: Date } | null = null;
  try { mes = await mesCorrente(franchiseeId); } catch {}
  const fimDoMes = mes ? mes.monthEnd.toISOString() : null;
  const linha = (await garantirEstruturaDoFirecheck()) ? await lerLinha(franchiseeId) : null;
  const trechos = lerTrechos(linha?.trechos);
  const testes = lerTestes(linha?.testes);

  const modulos = {} as Record<ModuloDoFirecheck, EstadoDoModuloDoFirecheck>;
  for (const m of MODULOS_DO_FIRECHECK) {
    const doModulo = trechos.filter((t) => t.modulo === m);
    // Ligado pelos trechos: o desligamento marcado para a virada do mês vale sozinho (lib/modulo-pago.ts).
    const ligado = ligadoAgora(doModulo, agora);
    const aberto = doModulo.find((t) => !t.ate || new Date(t.ate).getTime() > agora.getTime());
    const testeAte = testes[m] ?? null;
    modulos[m] = {
      ativo: ligado,
      emTeste: Boolean(ligado && testeAte && new Date(testeAte).getTime() > agora.getTime()),
      testeAte,
      isento: false, // o botão liga e desliga até na loja isenta (ela só não paga)
      jaTestou: Boolean(testeAte),
      desligaEm: desligamentoMarcado(doModulo, agora),
      fimDoMes,
      preco: ligado && aberto ? aberto.valor : PRECO_POR_MODULO[m],
    };
  }
  const valorEsteMes = !isento && mes ? valorDoFirecheckNoMes(trechos, testes, mes.monthStart, mes.monthEnd, agora).valor : 0;
  return { isento, peloFirehub: trechos.length > 0, modulos, valorEsteMes, fimDoMes };
}

/** Algum módulo ligado agora (inclusive o que desliga na virada): a ligação com o FireCheck não pode cair. */
export async function temModuloLigado(franchiseeId: string, agora: Date = new Date()): Promise<boolean> {
  if (!(await garantirEstruturaDoFirecheck())) return false;
  const linha = await lerLinha(franchiseeId);
  return ligadoAgora(lerTrechos(linha?.trechos), agora);
}

export class TermoNaoAceitoError extends Error {}

/**
 * Liga (abre um trecho do módulo, com o aceite do termo) ou desliga.
 * Desligar: no teste grátis do módulo, na hora; depois dele, marca o fim do
 * trecho para a virada do mês. Ligar com o desligamento marcado só desmarca.
 */
export async function ligarOuDesligarModulo(
  franchiseeId: string,
  modulo: ModuloDoFirecheck,
  ligar: boolean,
  aceite: Omit<AceiteDoTermo, "em"> | null,
  agora: Date = new Date(),
): Promise<EstadoDoFirecheck> {
  if (!(await garantirEstruturaDoFirecheck())) throw new Error("O FireCheck ainda não está disponível. Tente de novo em alguns minutos.");
  const atual = await lerLinha(franchiseeId);
  const trechos = lerTrechos(atual?.trechos);
  const testes = lerTestes(atual?.testes);
  const doModulo = trechos.filter((t) => t.modulo === modulo);
  const iso = agora.toISOString();
  const ligado = ligadoAgora(doModulo, agora);

  if (ligar) {
    if (ligado) {
      // Desligamento marcado para a virada do mês: "continuar ligado" desmarca.
      const marcado = doModulo.find((t) => t.ate && new Date(t.ate).getTime() > agora.getTime() && new Date(t.de).getTime() <= agora.getTime());
      if (!marcado) return estadoDoFirecheck(franchiseeId, agora);
      marcado.ate = null;
    } else {
      if (!aceite || aceite.versao !== VERSAO_DO_TERMO_DO_FIRECHECK) {
        throw new TermoNaoAceitoError("Para ligar o FireCheck é preciso aceitar o termo de contratação.");
      }
      trechos.push({ modulo, de: iso, ate: null, valor: PRECO_POR_MODULO[modulo], aceite: { ...aceite, em: iso } });
      // Só a primeira ativação do módulo ganha os dias grátis.
      if (!testes[modulo]) testes[modulo] = new Date(agora.getTime() + DIAS_DE_TESTE_DO_FIRECHECK * DIA_MS).toISOString();
    }
  } else {
    if (!ligado) return estadoDoFirecheck(franchiseeId, agora);
    const { monthEnd } = await mesCorrente(franchiseeId);
    const { ate } = quandoDesliga(testes[modulo], monthEnd, agora);
    for (const t of doModulo) if (!t.ate || new Date(t.ate).getTime() > agora.getTime()) t.ate = ate.toISOString();
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "FireCheckAssinatura" ("franchiseeId", "trechos", "testes", "atualizadoEm")
     VALUES ($1, $2::jsonb, $3::jsonb, NOW())
     ON CONFLICT ("franchiseeId") DO UPDATE SET "trechos" = $2::jsonb, "testes" = $3::jsonb, "atualizadoEm" = NOW()`,
    franchiseeId, JSON.stringify(trechos), JSON.stringify(testes),
  );
  return estadoDoFirecheck(franchiseeId, agora);
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDoFirecheckNoMes(franchiseeId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDoFirecheck())) return 0;
    if (await firecheckIsento(franchiseeId)) return 0;
    const linha = await lerLinha(franchiseeId);
    if (!linha) return 0;
    return valorDoFirecheckNoMes(lerTrechos(linha.trechos), lerTestes(linha.testes), inicio, fim).valor;
  } catch (err: any) {
    console.error("[FireCheck] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
