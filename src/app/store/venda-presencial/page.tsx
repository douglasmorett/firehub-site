"use client";
import BalcaoDeVenda from "@/components/balcao/BalcaoDeVenda";

// O miolo do Balcão mora em components/balcao: a tela grande de atendimento
// (/store/atendimento) e a lateral do WhatsApp Web (/atendimento-lateral)
// usam o MESMO balcão, com o mesmo pedido, caixa e pagamento.
export default function VendaPresencialPage() {
  return <BalcaoDeVenda />;
}
