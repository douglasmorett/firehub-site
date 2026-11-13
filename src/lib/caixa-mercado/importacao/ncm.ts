/**
 * A TRIBUTAÇÃO UMA VEZ POR NCM, NÃO PRODUTO A PRODUTO.
 *
 * Um mercado tem milhares de produtos e algumas centenas de NCMs. O FireHub
 * agrupa os produtos por NCM e monta a "planilha para o contador": uma linha
 * por NCM, com exemplos, quantos itens, e uma SUGESTÃO de tributação. O
 * contador confere/corrige as colunas e devolve; a importação aplica a regra a
 * todos os produtos daquele NCM (lib/caixa-mercado/importar.ts).
 *
 * A sugestão é só um ponto de partida (a coluna diz "sugestão"):
 *   - com CEST (o item está na lista da substituição tributária): CFOP 5405 e
 *     CSOSN 500 no Simples / CST 60 no regime normal;
 *   - sem CEST: CFOP 5102 e CSOSN 102 no Simples / CST 00 no regime normal;
 *   - PIS/COFINS: 49 no Simples; no regime normal 04 (monofásico) para os
 *     capítulos clássicos do monofásico (bebidas frias 2201–2202, cerveja
 *     2203, perfumaria/higiene 3303–3307, medicamentos 3003–3004, pneus 4011,
 *     autopeças 8708) e 01 no resto.
 * Quem decide é o contador: por isso a planilha volta e a regra dele vale.
 *
 * Puro.
 */

export type ProdutoParaNcm = { id: string; nome: string; ncm: string | null; cest: string | null; ncmSugerido?: boolean };

export type SugestaoDeTributacao = { cfop: string; csosn: string; pis: string; cofins: string; obs: string };

export type GrupoDoNcm = {
  ncm: string;
  quantidade: number;
  exemplos: string[];
  cest: string | null;
  sugeridosPelaIa: number;
  sugestao: SugestaoDeTributacao;
};

const MONOFASICO = /^(2201|2202|2203|3003|3004|3303|3304|3305|3306|3307|4011|8708)/;

/** CRT 1/4 = Simples (CSOSN); 2/3 = regime normal (CST). */
export function sugestaoDeTributacao(ncm: string, cest: string | null, crt: number): SugestaoDeTributacao {
  const simples = crt === 1 || crt === 4;
  const st = Boolean(cest);
  const mono = MONOFASICO.test(ncm);
  const pis = simples ? "49" : mono ? "04" : "01";
  const obs = [st ? "tem CEST: provável ST" : "", mono ? "NCM do monofásico de PIS/COFINS" : ""].filter(Boolean).join("; ");
  return {
    cfop: st ? "5405" : "5102",
    csosn: simples ? (st ? "500" : "102") : st ? "60" : "00",
    pis,
    cofins: pis,
    obs,
  };
}

/** Os produtos agrupados por NCM (maior grupo primeiro). Sem NCM ficam de fora (`semNcm`). */
export function agruparPorNcm(produtos: ProdutoParaNcm[], crt: number): { grupos: GrupoDoNcm[]; semNcm: ProdutoParaNcm[] } {
  const mapa = new Map<string, ProdutoParaNcm[]>();
  const semNcm: ProdutoParaNcm[] = [];
  for (const p of produtos) {
    const ncm = String(p.ncm ?? "").replace(/\D/g, "");
    if (ncm.length !== 8) { semNcm.push(p); continue; }
    const lista = mapa.get(ncm) ?? [];
    lista.push(p);
    mapa.set(ncm, lista);
  }
  const grupos: GrupoDoNcm[] = [];
  for (const [ncm, lista] of mapa) {
    // O CEST mais comum do grupo (o contador confere).
    const contagem = new Map<string, number>();
    for (const p of lista) if (p.cest) contagem.set(p.cest, (contagem.get(p.cest) ?? 0) + 1);
    const cest = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    grupos.push({
      ncm,
      quantidade: lista.length,
      exemplos: lista.slice(0, 3).map((p) => p.nome),
      cest,
      sugeridosPelaIa: lista.filter((p) => p.ncmSugerido).length,
      sugestao: sugestaoDeTributacao(ncm, cest, crt),
    });
  }
  grupos.sort((a, b) => b.quantidade - a.quantidade || a.ncm.localeCompare(b.ncm));
  return { grupos, semNcm };
}

/** As colunas da planilha do contador, na ordem (a volta é lida pelo cabeçalho). */
export const COLUNAS_DO_CONTADOR = [
  "NCM", "Exemplos de produtos", "Qtd de itens", "CEST", "CFOP", "CSOSN/CST ICMS", "CST PIS", "CST COFINS", "Observação",
] as const;

export type RegraDoNcm = { ncm: string; cfop: string | null; csosn: string | null; pis: string | null; cofins: string | null; cest: string | null; obs: string | null };

const so = (t: unknown) => String(t ?? "").replace(/\D/g, "");

/**
 * A planilha que o contador DEVOLVEU → uma regra por NCM. Lê pelo cabeçalho
 * (ele pode ter mudado a ordem ou apagado colunas). Campo vazio = não mexe.
 * Devolve também o que estava errado, linha a linha.
 */
export function lerPlanilhaDoContador(linhas: string[][]): { regras: RegraDoNcm[]; erros: string[] } {
  const erros: string[] = [];
  if (linhas.length < 2) return { regras: [], erros: ["A planilha está vazia."] };
  const cab = linhas[0].map((h) => h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
  const idx = (re: RegExp) => cab.findIndex((h) => re.test(h));
  const iNcm = idx(/^ncm/);
  const iCest = idx(/cest/);
  const iCfop = idx(/cfop/);
  const iIcms = idx(/csosn|icms/);
  const iPis = idx(/pis/);
  const iCofins = idx(/cofins/);
  const iObs = idx(/observ/);
  if (iNcm < 0) return { regras: [], erros: ["Não achei a coluna NCM."] };
  const regras: RegraDoNcm[] = [];
  for (let n = 1; n < linhas.length; n++) {
    const l = linhas[n];
    const ncm = so(l[iNcm]);
    if (!ncm) continue;
    if (ncm.length !== 8) { erros.push(`Linha ${n + 1}: NCM "${l[iNcm]}" não tem 8 dígitos.`); continue; }
    const pega = (i: number) => (i >= 0 ? so(l[i]) : "");
    const cfop = pega(iCfop), icms = pega(iIcms), pis = pega(iPis), cofins = pega(iCofins), cest = pega(iCest);
    const problemas: string[] = [];
    if (cfop && !/^5\d{3}$/.test(cfop)) problemas.push(`CFOP "${cfop}" (NFC-e é 5xxx)`);
    if (icms && !/^\d{2,3}$/.test(icms)) problemas.push(`CSOSN/CST "${icms}"`);
    if (pis && !/^\d{2}$/.test(pis)) problemas.push(`CST PIS "${pis}"`);
    if (cofins && !/^\d{2}$/.test(cofins)) problemas.push(`CST COFINS "${cofins}"`);
    if (cest && cest.length !== 7) problemas.push(`CEST "${cest}"`);
    if (problemas.length) { erros.push(`Linha ${n + 1} (NCM ${ncm}): ${problemas.join(", ")} — linha ignorada.`); continue; }
    regras.push({
      ncm,
      cfop: cfop || null,
      csosn: icms || null,
      pis: pis || null,
      cofins: cofins || null,
      cest: cest || null,
      obs: iObs >= 0 ? String(l[iObs] ?? "").trim().slice(0, 200) || null : null,
    });
  }
  return { regras, erros };
}

/** O NCM que a IA devolveu: 8 dígitos, com ou sem pontos. */
export function ncmDaIa(v: unknown): string | null {
  const d = so(v);
  return d.length === 8 && d !== "00000000" ? d : null;
}
