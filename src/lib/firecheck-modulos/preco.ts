/**
 * Os preços do FireCheck no boleto do FireHub, sem banco: a tela importa.
 * Os mesmos do site do FireCheck (Douglas, 28/10/2026: "com o mesmo preço que
 * está lá, tudo igual"); os dois ligados saem pelo preço do combo.
 */
export type ModuloDoFirecheck = "checklists" | "ponto";
export const MODULOS_DO_FIRECHECK: ModuloDoFirecheck[] = ["checklists", "ponto"];

export const PRECO_POR_MODULO: Record<ModuloDoFirecheck, number> = { checklists: 149, ponto: 149 };
export const PRECO_DO_COMBO = 197;
export const DIAS_DE_TESTE_DO_FIRECHECK = 7;

export const NOME_DO_MODULO: Record<ModuloDoFirecheck, string> = {
  checklists: "o Checklist",
  ponto: "o Controle de ponto",
};
