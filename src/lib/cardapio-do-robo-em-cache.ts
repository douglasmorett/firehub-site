/**
 * O CARDÁPIO DO ROBÔ, sem reler o cardápio inteiro a cada mensagem.
 *
 * O robô do WhatsApp (lib/chatbot-ai.ts) lia, a CADA mensagem, todos os
 * produtos da loja com os grupos e as opções. Medido em 18/10/2026 contra o
 * banco de produção: 96 KB a 1,5 MB por leitura, 16 a 284 ms de CPU no
 * processo do Node — e a de 284 ms segura o laço inteiro do servidor, que é o
 * mesmo das telas e da fila de impressão.
 *
 * Aqui a leitura fica guardada por loja, com uma VERSÃO tirada do banco antes
 * de cada uso: um resumo (md5) de todas as linhas do cardápio da loja —
 * produtos, categorias, grupos, opções e o produto por trás de cada opção.
 * Qualquer mudança em qualquer coluna (pausar, despausar, preço, horário,
 * opção nova) muda a versão, e a mensagem seguinte já lê o cardápio novo.
 * Não depende de quem gravou avisar, então vale com duas instâncias e com
 * gravação por SQL cru. A versão é uma linha de 4 textos curtos: o trabalho de
 * resumir fica no banco, que está folgado; o Node só recebe 4 hashes.
 *
 * Mesmo com a versão igual, a cópia vale no máximo VALIDADE_MS. Cada uso
 * recebe uma CÓPIA (structuredClone): quem ajusta preço ou marca pausa nos
 * objetos não mexe no guardado. Falhou a versão? Lê direto, como antes.
 */
import { Prisma } from "@prisma/client";

const VALIDADE_MS = 60_000;
const TETO_DE_LOJAS = 300;

type Guardado = { versao: string; em: number; valor: unknown };
const guardados = new Map<string, Guardado>();

export function sqlDaVersaoDoCardapio(lojaId: string): Prisma.Sql {
  return Prisma.sql`SELECT
    (SELECT md5(coalesce(string_agg(p::text, '|' ORDER BY p.id), '')) FROM "MenuProduct" p WHERE p."franchiseeId" = ${lojaId}) AS "produtos",
    (SELECT md5(coalesce(string_agg(c::text, '|' ORDER BY c.id), '')) FROM "MenuCategory" c WHERE c."franchiseeId" = ${lojaId}) AS "categorias",
    (SELECT md5(coalesce(string_agg(g::text, '|' ORDER BY g.id), ''))
       FROM "ComboGroup" g JOIN "MenuProduct" p ON p.id = g."menuProductId"
      WHERE p."franchiseeId" = ${lojaId}) AS "grupos",
    (SELECT md5(coalesce(string_agg(i::text || coalesce(o."updatedAt"::text, ''), '|' ORDER BY i.id), ''))
       FROM "ComboGroupItem" i
       JOIN "ComboGroup" g ON g.id = i."comboGroupId"
       JOIN "MenuProduct" p ON p.id = g."menuProductId"
       LEFT JOIN "MenuProduct" o ON o.id = i."menuProductId"
      WHERE p."franchiseeId" = ${lojaId}) AS "opcoes"`;
}

export async function versaoDoCardapio(
  db: { $queryRaw: <T = unknown>(sql: Prisma.Sql) => Promise<T> },
  lojaId: string,
): Promise<string | null> {
  try {
    const linhas = await db.$queryRaw<Record<string, unknown>[]>(sqlDaVersaoDoCardapio(lojaId));
    const l = Array.isArray(linhas) ? linhas[0] : null;
    if (!l) return null;
    return [l.produtos, l.categorias, l.grupos, l.opcoes].map((v) => String(v ?? "")).join(":");
  } catch (err) {
    console.error("[Robô] versão do cardápio indisponível; lendo direto:", (err as any)?.code || (err as any)?.message || err);
    return null;
  }
}

/**
 * O cardápio da loja pelo `buscar` de sempre, ou a cópia guardada quando a
 * versão do banco é a mesma da cópia (e ela tem menos de VALIDADE_MS).
 */
export async function lerCardapioDoRobo<T>(
  db: { $queryRaw: <R = unknown>(sql: Prisma.Sql) => Promise<R> },
  lojaId: string,
  buscar: () => Promise<T>,
): Promise<T> {
  // A versão vem ANTES da leitura: mudança no meio do caminho deixa a cópia
  // com versão velha, e a próxima mensagem relê. O contrário guardaria dado
  // velho com versão nova.
  const versao = await versaoDoCardapio(db, lojaId);
  const agora = Date.now();
  const guardado = guardados.get(lojaId);
  if (versao && guardado && guardado.versao === versao && agora - guardado.em < VALIDADE_MS) {
    return structuredClone(guardado.valor) as T;
  }

  const valor = await buscar();
  if (versao) {
    if (guardados.size >= TETO_DE_LOJAS && !guardados.has(lojaId)) {
      for (const [k, v] of guardados) if (agora - v.em >= VALIDADE_MS) guardados.delete(k);
      if (guardados.size >= TETO_DE_LOJAS) guardados.clear();
    }
    guardados.set(lojaId, { versao, em: agora, valor: structuredClone(valor) });
  }
  return valor;
}
