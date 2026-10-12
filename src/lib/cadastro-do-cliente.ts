/**
 * O CADASTRO DO CLIENTE QUE A LOJA EDITOU — o "Editar cadastro" da ficha.
 *
 * Pedido do Flavio (Showrrascão, 11/10/2026): "edição de cadastro do cliente
 * (hoje não é possível)". A ficha mostrava o nome do último pedido e não havia
 * como corrigir o "Cliente", o apelido ou o endereço velho.
 *
 * Não se mexe no StoreCustomer: ele é UM para a plataforma inteira (o cliente
 * que pede em duas lojas tem um só), e a correção de uma loja apareceria na
 * outra. A edição fica numa tabela da loja, por cliente (a mesma chave da
 * lista: DDD + 8 últimos dígitos — com ou sem o 9 é a mesma pessoa), e vence
 * o que os pedidos dizem na lista, na ficha e na busca do balcão.
 *
 * Campo vazio = sem correção: volta a valer o que os pedidos dizem.
 * O telefone não se edita — é ele que liga os pedidos, o saldo e o cadastro.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chaveDoCliente } from "@/lib/clientes-da-loja-regras";

export type CadastroEditado = {
  nome: string | null;
  /** "DD/MM" ou "DD/MM/AAAA". */
  aniversario: string | null;
  /** O endereço principal, em texto (vai primeiro na ficha e no balcão). */
  endereco: string | null;
  /** Recado interno da loja sobre o cliente — o cliente não vê. */
  observacao: string | null;
  atualizadoPor: string | null;
  atualizadoEm: string | null;
};

export type EdicaoComChave = CadastroEditado & { chave: string; telefone: string };

export const LIMITES = { nome: 80, endereco: 200, observacao: 500 } as const;

let tabelaOk = false;

export async function garantirTabelaDoCadastro(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ClienteDaLoja" (
      "id" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "chave" TEXT NOT NULL,
      "telefone" TEXT NOT NULL,
      "nome" TEXT,
      "aniversario" TEXT,
      "endereco" TEXT,
      "observacao" TEXT,
      "atualizadoPor" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClienteDaLoja_pkey" PRIMARY KEY ("id")
    )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ClienteDaLoja_lojaId_chave_key" ON "ClienteDaLoja"("lojaId", "chave")`,
    );
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Clientes] 🛑 Tabela ClienteDaLoja falhou: ${err?.message}`);
    return false;
  }
}

const limpo = (v: unknown, max: number): string | null => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
};

/**
 * O aniversário digitado vira "DD/MM" ou "DD/MM/AAAA"; aceita também o
 * "AAAA-MM-DD" do cadastro do site. `undefined` = data que não existe.
 */
export function lerAniversario(bruto: unknown): string | null | undefined {
  const t = String(bruto ?? "").trim();
  if (!t) return null;
  let d: number, m: number, a: number | null = null;
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const br = t.match(/^(\d{1,2})[/.\-\s](\d{1,2})(?:[/.\-\s](\d{2}|\d{4}))?$/);
  if (iso) [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) {
    [d, m] = [Number(br[1]), Number(br[2])];
    if (br[3]) a = br[3].length === 2 ? (Number(br[3]) > 30 ? 1900 : 2000) + Number(br[3]) : Number(br[3]);
  } else return undefined;
  if (m < 1 || m > 12 || d < 1) return undefined;
  // 29/02 sem ano vale (o ano bissexto é o do cliente).
  const diasNoMes = new Date(Date.UTC(a ?? 2000, m, 0)).getUTCDate();
  if (d > diasNoMes) return undefined;
  if (a !== null && (a < 1900 || a > new Date().getUTCFullYear())) return undefined;
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return a === null ? `${dd}/${mm}` : `${dd}/${mm}/${a}`;
}

/** O aniversário como a ficha mostra ("15/03/1990"); o do site vem "1990-03-15". */
export function aniversarioBonito(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const lido = lerAniversario(bruto);
  return lido || String(bruto).trim() || null;
}

export type EntradaDoCadastro = { nome?: unknown; aniversario?: unknown; endereco?: unknown; observacao?: unknown };

/** Confere o que veio da tela. Devolve os campos limpos ou o erro para mostrar. */
export function lerCadastro(e: EntradaDoCadastro):
  | { ok: true; campos: Pick<CadastroEditado, "nome" | "aniversario" | "endereco" | "observacao"> }
  | { ok: false; erro: string } {
  const aniversario = lerAniversario(e.aniversario);
  if (aniversario === undefined) return { ok: false, erro: "Aniversário inválido — use dia/mês (ex.: 15/03) ou dia/mês/ano." };
  const nome = limpo(e.nome, LIMITES.nome);
  if (nome && nome.replace(/[^\p{L}]/gu, "").length < 2) return { ok: false, erro: "O nome precisa ter pelo menos 2 letras." };
  return {
    ok: true,
    campos: {
      nome,
      aniversario,
      endereco: limpo(e.endereco, LIMITES.endereco),
      // A observação guarda as quebras de linha.
      observacao: String(e.observacao ?? "").replace(/\r\n/g, "\n").trim().slice(0, LIMITES.observacao) || null,
    },
  };
}

type LinhaDoBanco = {
  chave: string; telefone: string; nome: string | null; aniversario: string | null; endereco: string | null;
  observacao: string | null; atualizadoPor: string | null; updatedAt: Date | null;
};

const paraEdicao = (l: LinhaDoBanco): EdicaoComChave => ({
  chave: l.chave,
  telefone: l.telefone,
  nome: l.nome || null,
  aniversario: l.aniversario || null,
  endereco: l.endereco || null,
  observacao: l.observacao || null,
  atualizadoPor: l.atualizadoPor || null,
  atualizadoEm: l.updatedAt ? new Date(l.updatedAt).toISOString() : null,
});

/** A edição da loja para UM cliente (pela chave DDD + 8 últimos dígitos). */
export async function cadastroEditado(lojaId: string, telefone: string): Promise<EdicaoComChave | null> {
  const chave = chaveDoCliente(telefone);
  if (!chave || !(await garantirTabelaDoCadastro())) return null;
  try {
    const [l] = await prisma.$queryRaw<LinhaDoBanco[]>`
      SELECT "chave", "telefone", "nome", "aniversario", "endereco", "observacao", "atualizadoPor", "updatedAt"
      FROM "ClienteDaLoja" WHERE "lojaId" = ${lojaId} AND "chave" = ${chave} LIMIT 1`;
    return l ? paraEdicao(l) : null;
  } catch (err: any) {
    console.warn(`[Clientes] leitura do cadastro editado falhou: ${err?.message}`);
    return null;
  }
}

/**
 * As edições das lojas para a busca do balcão: pelas chaves dos telefones
 * achados e, na busca por nome, pelo nome corrigido (o "Cliente" que virou
 * "João" tem que aparecer quando o atendente digita "João").
 */
export async function edicoesParaBusca(lojaIds: string[], chaves: string[], nome: string | null): Promise<EdicaoComChave[]> {
  if (!lojaIds.length || (!chaves.length && !nome)) return [];
  if (!(await garantirTabelaDoCadastro())) return [];
  const condicoes: Prisma.Sql[] = [];
  if (chaves.length) condicoes.push(Prisma.sql`"chave" IN (${Prisma.join(chaves)})`);
  if (nome) condicoes.push(Prisma.sql`"nome" ILIKE ${"%" + nome + "%"}`);
  try {
    const linhas = await prisma.$queryRaw<LinhaDoBanco[]>(Prisma.sql`
      SELECT "chave", "telefone", "nome", "aniversario", "endereco", "observacao", "atualizadoPor", "updatedAt"
      FROM "ClienteDaLoja"
      WHERE "lojaId" IN (${Prisma.join(lojaIds)}) AND (${Prisma.join(condicoes, " OR ")})
      ORDER BY "updatedAt" DESC
      LIMIT 60`);
    return linhas.map(paraEdicao);
  } catch (err: any) {
    console.warn(`[Clientes] edições para a busca falharam: ${err?.message}`);
    return [];
  }
}

/** Grava (ou apaga, quando tudo veio vazio) a edição da loja para o cliente. */
export async function salvarCadastro(
  lojaId: string,
  telefone: string,
  campos: Pick<CadastroEditado, "nome" | "aniversario" | "endereco" | "observacao">,
  quem: string,
): Promise<EdicaoComChave | null> {
  const chave = chaveDoCliente(telefone);
  if (!chave) throw new Error("telefone inválido");
  if (!(await garantirTabelaDoCadastro())) throw new Error("tabela ClienteDaLoja indisponível");
  const vazio = !campos.nome && !campos.aniversario && !campos.endereco && !campos.observacao;
  if (vazio) {
    await prisma.$executeRaw`DELETE FROM "ClienteDaLoja" WHERE "lojaId" = ${lojaId} AND "chave" = ${chave}`;
    return null;
  }
  const id = `cdl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await prisma.$executeRaw`
    INSERT INTO "ClienteDaLoja" ("id", "lojaId", "chave", "telefone", "nome", "aniversario", "endereco", "observacao", "atualizadoPor", "createdAt", "updatedAt")
    VALUES (${id}, ${lojaId}, ${chave}, ${telefone}, ${campos.nome}, ${campos.aniversario}, ${campos.endereco}, ${campos.observacao}, ${quem}, NOW(), NOW())
    ON CONFLICT ("lojaId", "chave") DO UPDATE SET
      "telefone" = EXCLUDED."telefone", "nome" = EXCLUDED."nome", "aniversario" = EXCLUDED."aniversario",
      "endereco" = EXCLUDED."endereco", "observacao" = EXCLUDED."observacao",
      "atualizadoPor" = EXCLUDED."atualizadoPor", "updatedAt" = NOW()`;
  return cadastroEditado(lojaId, telefone);
}
