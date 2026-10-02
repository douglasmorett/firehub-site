/**
 * Categoria da conta a pagar, escolhida pelo lojista.
 *
 * Até 02/10/2026 toda conta nascia "BUSINESS" e a tela nem mostrava categoria.
 * O Ragnar lançou um acordo com funcionário e perguntou se o sistema separava
 * sozinho: não separava. A categoria agora é texto livre com sugestões, como
 * nas despesas do DRE (DespesasLancadas.tsx): as que a loja já usou voltam
 * primeiro, para "Funcionários" não virar "funcionario" e "Folha" no mesmo mês.
 *
 * "BUSINESS"/"PERSONAL" são os valores antigos da coluna (default do banco):
 * significam "sem categoria" e não aparecem como etiqueta.
 */

export const SUGESTOES_DE_CATEGORIA = [
  "Fornecedores e insumos",
  "Funcionários e acordos",
  "Aluguel",
  "Energia",
  "Água",
  "Gás",
  "Internet e telefone",
  "Impostos e taxas",
  "Manutenção",
  "Empréstimos e parcelamentos",
  "Outros",
];

export const CATEGORIA_MAX = 60;

/** A categoria que a loja escolheu, ou null quando a conta não tem uma. */
export function categoriaDaConta(c: string | null | undefined): string | null {
  const t = (c ?? "").trim();
  if (!t || t === "BUSINESS" || t === "PERSONAL") return null;
  return t;
}

/** Sugestões com as já usadas pela loja na frente, sem repetir (ignora caixa e acento). */
export function sugestoesComAsDaLoja(usadas: (string | null | undefined)[]): string[] {
  const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const vistas = new Set<string>();
  const lista: string[] = [];
  for (const c of [...usadas.map(categoriaDaConta), ...SUGESTOES_DE_CATEGORIA]) {
    if (!c || vistas.has(chave(c))) continue;
    vistas.add(chave(c));
    lista.push(c);
  }
  return lista;
}
