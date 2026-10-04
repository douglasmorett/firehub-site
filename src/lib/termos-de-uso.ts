/**
 * src/lib/termos-de-uso.ts — QUEM ACEITOU QUAL VERSÃO DOS TERMOS.
 *
 * Cada aceite vira uma linha em "AceiteDosTermos" (quem, versão, quando, IP,
 * navegador, de onde). É a prova do aceite eletrônico (MP 2.200-2/2001, art.
 * 10 § 2º): por isso é um registro que só cresce, sem chave estrangeira para
 * o User — apagar a conta não apaga a prova.
 *
 * Quem precisa aceitar: o DONO da conta (FRANCHISEE sem ownerId). Funcionário
 * não aceita contrato em nome da empresa, e o suporte que entrou pelo
 * "Acessar" do admin também não. A conta criada pelo robô do WhatsApp ou pelo
 * admin nasce sem aceite e cai na tela do painel no primeiro acesso.
 *
 * A tabela é criada aqui, na primeira consulta de cada processo — o mesmo
 * jeito de garantirEstruturaDeAcompanhamento (lib/garantir-colunas.ts).
 */
import { prisma } from "@/lib/prisma";
import { VERSAO_DOS_TERMOS } from "@/lib/termos-versao";

export type OrigemDoAceite = "CADASTRO" | "PAINEL";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "AceiteDosTermos" (
     "id" TEXT NOT NULL,
     "userId" TEXT NOT NULL,
     "versao" TEXT NOT NULL,
     "origem" TEXT NOT NULL,
     "ip" TEXT,
     "userAgent" TEXT,
     "email" TEXT,
     "nome" TEXT,
     "aceitoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "AceiteDosTermos_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "AceiteDosTermos_userId_versao_idx" ON "AceiteDosTermos"("userId", "versao")`,
];

let tabelaOk = false;

async function garantirTabela(): Promise<void> {
  if (tabelaOk) return;
  for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
  tabelaOk = true;
}

/**
 * Quem já aceitou a versão atual neste processo. O layout do painel pergunta a
 * cada navegação; depois do primeiro "sim" não vale ir ao banco de novo.
 */
const jaAceitaram = new Set<string>();

/**
 * O dono já aceitou a versão em vigor?
 *
 * Erro de banco responde SIM. A tela de aceite trava o painel inteiro: travar
 * todas as lojas no meio do expediente porque a consulta falhou seria um
 * estrago muito maior do que deixar uma loja passar sem aceitar desta vez —
 * ela vê a tela no próximo acesso.
 */
export async function aceitouVersaoAtual(userId: string): Promise<boolean> {
  const chave = `${userId}:${VERSAO_DOS_TERMOS}`;
  if (jaAceitaram.has(chave)) return true;
  try {
    await garantirTabela();
    const aceite = await prisma.aceiteDosTermos.findFirst({
      where: { userId, versao: VERSAO_DOS_TERMOS },
      select: { id: true },
    });
    if (aceite) jaAceitaram.add(chave);
    return !!aceite;
  } catch (err) {
    console.error("[Termos] Falha ao consultar o aceite — liberando o painel:", err);
    return true;
  }
}

/** IP de quem fez a requisição, atrás do proxy do Coolify. */
export function ipDaRequisicao(headers: Headers): string | null {
  const encaminhado = headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim() || null;
  return headers.get("x-real-ip");
}

export async function registrarAceite(dados: {
  userId: string;
  origem: OrigemDoAceite;
  headers: Headers;
  email?: string | null;
  nome?: string | null;
}): Promise<void> {
  await garantirTabela();
  await prisma.aceiteDosTermos.create({
    data: {
      userId: dados.userId,
      versao: VERSAO_DOS_TERMOS,
      origem: dados.origem,
      ip: ipDaRequisicao(dados.headers),
      userAgent: (dados.headers.get("user-agent") || "").slice(0, 500) || null,
      email: dados.email ?? null,
      nome: dados.nome ?? null,
    },
  });
  jaAceitaram.add(`${dados.userId}:${VERSAO_DOS_TERMOS}`);
}
