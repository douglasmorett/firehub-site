/**
 * A FAXINA DOS CACHES DO MAPA: o endereço e a rota que ninguém usa há 90 dias
 * saem do banco.
 *
 * GeocodeCache (onde fica cada endereço) e RotaCache (quantos km de rua da
 * loja até ele) ganham uma linha por endereço novo — crescem com o uso, para
 * sempre. O dono pediu o contrário (26/09/2026: "crescer com o uso, com o
 * tempo, sobrecarrega a gente"). Com a faxina, o tamanho fica no que as lojas
 * usam de verdade: os clientes dos últimos 3 meses. Quem volta a pedir depois
 * disso é perguntado ao mapa de novo, uma vez.
 *
 * As duas tabelas carimbam `ultimoUso` a cada leitura (geocodificacao-servidor
 * e distancia-por-rota), então "90 dias sem uso" é sem uso mesmo, não "criado
 * há 90 dias".
 *
 * Medido em 26/09/2026: 730 endereços (400 kB) e 29 rotas (32 kB), com o
 * banco inteiro em 217 MB. O cache nunca foi o peso — a faxina garante que
 * não vire.
 */

export const DIAS_SEM_USO = 90;

/** As tabelas da faxina. Nome fixo: nunca vem de fora. */
export const TABELAS_DA_FAXINA = ["GeocodeCache", "RotaCache"] as const;
export type TabelaDaFaxina = (typeof TABELAS_DA_FAXINA)[number];

/** O DELETE de uma tabela. `dias` é inteiro positivo — qualquer outra coisa vira o padrão. */
export function sqlDaFaxina(tabela: TabelaDaFaxina, dias: number = DIAS_SEM_USO): string {
  if (!TABELAS_DA_FAXINA.includes(tabela)) throw new Error(`tabela fora da faxina: ${tabela}`);
  const d = Number.isInteger(dias) && dias > 0 ? dias : DIAS_SEM_USO;
  return `DELETE FROM "${tabela}" WHERE "ultimoUso" < NOW() - INTERVAL '${d} days'`;
}

export type ResultadoDaFaxina = Record<TabelaDaFaxina, number | null>;

/**
 * Roda a faxina nas duas tabelas. Uma que falhe (tabela ainda não criada, banco
 * lento) não impede a outra: volta `null` nela.
 */
export async function faxinaDosCaches(
  executar: (sql: string) => Promise<number>,
  dias: number = DIAS_SEM_USO,
): Promise<ResultadoDaFaxina> {
  const resultado = {} as ResultadoDaFaxina;
  for (const tabela of TABELAS_DA_FAXINA) {
    try {
      resultado[tabela] = await executar(sqlDaFaxina(tabela, dias));
    } catch (e) {
      console.warn(`[faxina-dos-caches] ${tabela}: ${(e as Error)?.message || e}`);
      resultado[tabela] = null;
    }
  }
  return resultado;
}
