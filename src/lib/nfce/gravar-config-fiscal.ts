/**
 * /src/lib/nfce/gravar-config-fiscal.ts
 *
 * Grava o `User.fiscalConfig` sem apagar o que outra tela gravou no meio.
 *
 * ── Por quê ─────────────────────────────────────────────────────────────────
 *
 * O fiscalConfig é um JSON só com tudo da nota: dados da empresa, regras,
 * contador, o bloco do emissor próprio (`sefaz`) e agora as marcas do NCM
 * assistido. Quem grava lê o objeto inteiro, muda um pedaço e escreve o objeto
 * inteiro de volta. Duas gravações ao mesmo tempo — o titular enviando o
 * certificado enquanto salva a série na outra aba, ou aplicando o NCM de uma
 * categoria — faziam a segunda escrever por cima da primeira com a leitura
 * velha, e o certificado recém-enviado sumia sem erro nenhum.
 *
 * Aqui a escrita é compare-and-swap: só grava se o fiscalConfig no banco ainda
 * é o que foi lido (o mesmo `equals` de lib/fiscal-automatico →
 * gravarNosPedidos). Mudou no meio? Relê, reaplica a mudança sobre o que está
 * lá agora e tenta de novo.
 *
 * Só servidor. O banco entra por parâmetro para o teste rodar sem Prisma.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class LojaNaoEncontrada extends Error {}
export class ConflitoNaGravacao extends Error {}

export type BancoDaConfigFiscal = {
  /** O fiscalConfig gravado (null quando nunca foi gravado); `undefined` = a loja não existe. */
  ler(lojaId: string): Promise<unknown | undefined>;
  /** Grava `novo` só se o banco ainda tem `anterior`. true = gravou. */
  gravarSeIgual(lojaId: string, novo: Record<string, unknown>, anterior: unknown): Promise<boolean>;
};

export const bancoDaConfigFiscal: BancoDaConfigFiscal = {
  async ler(lojaId) {
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { fiscalConfig: true } });
    if (!loja) return undefined;
    return loja.fiscalConfig ?? null;
  },
  async gravarSeIgual(lojaId, novo, anterior) {
    const r = await prisma.user.updateMany({
      where: {
        id: lojaId,
        // AnyNull: o "nunca gravado" pode estar como NULL do banco ou null do JSON.
        fiscalConfig: { equals: anterior == null ? Prisma.AnyNull : (anterior as Prisma.InputJsonValue) },
      },
      data: { fiscalConfig: novo as Prisma.InputJsonValue },
    });
    return r.count > 0;
  },
};

/**
 * Lê, deixa `alterar` decidir e grava com compare-and-swap.
 *
 * `alterar` recebe o fiscalConfig CRU do banco e devolve `gravar` (o objeto
 * novo, ou null para não gravar nada — uma recusa, por exemplo) e a
 * `resposta` que a rota devolve. Ele pode rodar mais de uma vez: tem de ser
 * puro (sem efeito fora do retorno).
 */
export async function alterarFiscalConfig<R>(
  lojaId: string,
  alterar: (atual: unknown) => { gravar: Record<string, unknown> | null; resposta: R },
  opcoes: { banco?: BancoDaConfigFiscal; tentativas?: number } = {}
): Promise<R> {
  const banco = opcoes.banco ?? bancoDaConfigFiscal;
  const tentativas = Math.max(1, opcoes.tentativas ?? 4);
  for (let i = 0; i < tentativas; i++) {
    const atual = await banco.ler(lojaId);
    if (atual === undefined) throw new LojaNaoEncontrada("Loja não encontrada.");
    const { gravar, resposta } = alterar(atual);
    if (gravar === null) return resposta;
    if (await banco.gravarSeIgual(lojaId, gravar, atual)) return resposta;
  }
  throw new ConflitoNaGravacao("O cadastro fiscal mudou várias vezes enquanto era salvo. Recarregue a tela e tente de novo.");
}
