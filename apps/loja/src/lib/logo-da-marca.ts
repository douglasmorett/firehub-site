/**
 * O logo da aba Loja vem DENTRO do app: o ícone da marca (marcas/<marca>/icon.png).
 * O logo por URL (marca.logo, um .webp do FireHub) saía como quadrado branco no
 * iPhone — e sem internet não sai nada. O Metro só empacota `require` estático,
 * então cada marca nova ganha uma linha aqui.
 */
import { marca } from "./marca";

const logos: Record<string, number> = {
  hakim: require("../../marcas/hakim/icon.png"),
};

export const logoDaMarca: number | { uri: string } | null =
  logos[marca.id] ?? (marca.logo ? { uri: marca.logo } : null);
