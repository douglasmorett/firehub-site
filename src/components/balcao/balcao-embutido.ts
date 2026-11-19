"use client";
import { createContext } from "react";

/**
 * O Balcão (app/store/venda-presencial/page.tsx) embutido ao lado de uma
 * conversa do WhatsApp — a tela grande (/store/atendimento) e a lateral do
 * WhatsApp Web (/atendimento-lateral), pelo BalcaoNaConversa.
 *
 * Vai por contexto, e não por props, para o Balcão continuar morando na
 * página dele: page.tsx não aceita props próprias, e mover as 1.600 linhas
 * para outro arquivo atropelava todo trabalho em andamento naquela tela.
 * Sem o provedor (o /store/venda-presencial de sempre) vale o padrão abaixo,
 * e o Balcão é exatamente o de antes.
 */
export type BalcaoEmbutido = {
  /**
   * "pagina": o Balcão de sempre, cardápio e pedido lado a lado.
   * "atendimento": a coluna estreita ao lado da conversa — cardápio e pedido
   * em duas abas, pagamento em botões grandes.
   */
  modo: "pagina" | "atendimento";
  /** O cliente da conversa aberta: entra no nome e no telefone ao abrir. */
  cliente: { nome?: string; telefone?: string } | null;
  /**
   * Onde o rascunho espera. Cada conversa tem o seu: o carrinho do João não
   * pode aparecer quando se abre a Maria. Nulo = o rascunho do Balcão.
   */
  chaveDoRascunho: string | null;
};

export const ContextoDoBalcao = createContext<BalcaoEmbutido>({ modo: "pagina", cliente: null, chaveDoRascunho: null });
