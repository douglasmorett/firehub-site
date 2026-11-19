"use client";
import VendaPresencialPage from "@/app/store/venda-presencial/page";
import { ContextoDoBalcao } from "./balcao-embutido";

/**
 * O MESMO Balcão de /store/venda-presencial (mesmo pedido, caixa e
 * pagamento), na coluna estreita ao lado da conversa do WhatsApp, com o
 * cliente da conversa nos campos. Ver balcao-embutido.ts.
 */
export default function BalcaoNaConversa({ cliente, chaveDoRascunho }: {
  cliente: { nome?: string; telefone?: string } | null;
  chaveDoRascunho: string;
}) {
  return (
    <ContextoDoBalcao.Provider value={{ modo: "atendimento", cliente, chaveDoRascunho }}>
      <VendaPresencialPage />
    </ContextoDoBalcao.Provider>
  );
}
