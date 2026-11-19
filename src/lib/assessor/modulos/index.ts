/**
 * Os módulos do Bill (contrato em ../modulo.ts). Cada fase do mapa de
 * 18/11/2026 entra aqui com uma linha.
 */
import type { ModuloDoBill } from "../modulo";
import { MODULO_BUSCA } from "./busca";
import { MODULO_CARDAPIO } from "./cardapio";
import { MODULO_LOJA } from "./loja";
import { MODULO_CAIXA } from "./caixa";
import { MODULO_PEDIDOS } from "./pedidos";
import { MODULO_MARKETING } from "./marketing";

export const MODULOS_DO_BILL: ModuloDoBill[] = [
  MODULO_BUSCA,
  MODULO_CARDAPIO,
  MODULO_LOJA,
  MODULO_CAIXA,
  MODULO_PEDIDOS,
  MODULO_MARKETING,
];
