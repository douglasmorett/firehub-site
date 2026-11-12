/**
 * O código do link de convite do embaixador (/cadastro?ref=<código>).
 *
 * Era o nome da pessoa + 4 números ("victorhenriques5134"). Douglas,
 * 12/11/2026: "tem gente que não quer dar moral pro próximo" — o indicado vê o
 * nome de quem indicou no link e desiste. Agora o código é embaralhado, sem
 * nome de ninguém, e vale para todo embaixador e vendedor, novo ou antigo.
 *
 * Os links antigos já foram espalhados (status, grupos, bio): quem trocou de
 * código continua achável pelo código velho, guardado em
 * "CodigoAntigoDoEmbaixador". Assim nenhuma indicação feita pelo link velho
 * perde a comissão.
 */
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Minúsculas (o cadastro baixa o ?ref= para minúsculas) e sem l/o/0/1, que se
// confundem quando o link é ditado ou copiado à mão.
const ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789";
const TAMANHO = 8;

export function codigoEmbaralhado(): string {
  let s = "";
  for (let i = 0; i < TAMANHO; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

let tabelaPronta: Promise<boolean> | null = null;

/** Cria a tabela dos códigos antigos uma vez por processo. */
export function garantirTabelaDeCodigosAntigos(): Promise<boolean> {
  if (!tabelaPronta) {
    tabelaPronta = prisma
      .$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "CodigoAntigoDoEmbaixador" (
          "codigo" TEXT NOT NULL,
          "ambassadorId" TEXT NOT NULL,
          "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "CodigoAntigoDoEmbaixador_pkey" PRIMARY KEY ("codigo")
        )`
      )
      .then(() => true)
      .catch((e) => {
        console.error("[Embaixador] tabela de códigos antigos:", e?.message || e);
        tabelaPronta = null;
        return false;
      });
  }
  return tabelaPronta;
}

/** Um código novo, que não existe nem como atual nem como antigo. */
export async function gerarCodigoUnicoDoEmbaixador(): Promise<string> {
  await garantirTabelaDeCodigosAntigos();
  for (let i = 0; i < 20; i++) {
    const code = codigoEmbaralhado();
    const atual = await prisma.ambassador.findUnique({ where: { code }, select: { id: true } });
    if (atual) continue;
    const antigo = await prisma
      .$queryRawUnsafe<{ codigo: string }[]>(`SELECT "codigo" FROM "CodigoAntigoDoEmbaixador" WHERE "codigo" = $1`, code)
      .catch(() => []);
    if (antigo.length === 0) return code;
  }
  throw new Error("Não foi possível gerar um código único.");
}

/**
 * O embaixador dono deste código: pelo código atual ou por um antigo. Null se
 * nenhum (o ?ref= pode ser de parceiro/loja ou de campanha).
 */
export async function embaixadorPeloCodigo(bruto: unknown) {
  const code = String(bruto ?? "").toLowerCase().trim();
  if (!code) return null;
  const atual = await prisma.ambassador.findUnique({ where: { code } });
  if (atual) return atual;
  await garantirTabelaDeCodigosAntigos();
  const linhas = await prisma
    .$queryRawUnsafe<{ ambassadorId: string }[]>(`SELECT "ambassadorId" FROM "CodigoAntigoDoEmbaixador" WHERE "codigo" = $1`, code)
    .catch(() => []);
  if (!linhas[0]) return null;
  return prisma.ambassador.findUnique({ where: { id: linhas[0].ambassadorId } });
}
