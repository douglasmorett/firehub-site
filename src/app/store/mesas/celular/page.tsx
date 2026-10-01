/**
 * /store/mesas/celular — o módulo de mesa desenhado para celular, pelo painel.
 *
 * A tela completa (/store/mesas) continua igual; esta é a alternativa para
 * quem atende pelo telefone. A permissão de funcionário é a mesma da tela de
 * mesas (prefixo /store/mesas em lib/permissao-da-tela.ts).
 */
import MesasCelular from "@/components/mesas/MesasCelular";

export default function MesasNoCelularPage() {
  return <MesasCelular modo="loja" />;
}
