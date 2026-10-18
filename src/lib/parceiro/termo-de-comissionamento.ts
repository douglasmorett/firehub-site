/**
 * O TERMO DE COMISSIONAMENTO DO VENDEDOR — um texto só: o portal mostra este e
 * o servidor grava a versão aceita (lib/parceiro/aceite-do-termo.ts). Mudou o
 * texto, mude a versão: quem aceitou a anterior vê o termo de novo.
 *
 * Douglas, 18/10/2026: as comissões (10% pelo link enquanto atende, 3% pelas
 * atribuídas, 3% sobre a margem do disparo) só valem enquanto o vendedor
 * trabalha com a FireHub e enquanto atende a loja; se sair da empresa, não tem
 * direito às comissões futuras nem das lojas que convidou; se parar de atender
 * uma loja que convidou, perde os 10% dela.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ RASCUNHO — REVISÃO JURÍDICA ANTES DE PUBLICAR A VERSÃO FINAL            │
 * │                                                                          │
 * │ O Douglas também disse "não tem direito às comissões acumuladas". A       │
 * │ cláusula 6 está escrita com essa intenção, MAS comissão de boleto que a   │
 * │ loja JÁ PAGOU pode ser direito adquirido do vendedor:                     │
 * │   • Lei 4.886/65 (representante comercial autônomo), art. 32 e §§: a      │
 * │     comissão é devida quando o cliente paga, e a rescisão não apaga       │
 * │     comissão já vencida; cláusula que retira esse direito tende a ser     │
 * │     nula;                                                                 │
 * │   • se houver vínculo de emprego (CLT, arts. 457 e 466), comissão é       │
 * │     salário: a já adquirida não pode ser retirada.                        │
 * │ Recomendação: advogado revisa as cláusulas 5 e 6 (e a forma de           │
 * │ contratação dos vendedores) antes de trocar VERSAO para a definitiva.     │
 * │ Enquanto isso, o sistema NÃO retira nada já pago: o split só deixa de     │
 * │ pagar comissões FUTURAS (boletos e recargas emitidos depois da saída).    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Arquivo puro (sem banco): a tela importa.
 */
export const VERSAO_DO_TERMO_DE_COMISSIONAMENTO = "2026-10-18-rascunho";

export const TITULO_DO_TERMO_DE_COMISSIONAMENTO = "Termo de comissionamento — vendedor FireHub";

export const RASCUNHO_PENDENTE_DE_REVISAO_JURIDICA = true;

export const CLAUSULAS_DO_TERMO_DE_COMISSIONAMENTO = [
  "Comissão é uma parte do que a loja paga ao FireHub (o boleto do mês: mensalidade e serviços cobrados nele), não das vendas da loja. Ela é paga pelo split do Asaas, direto na minha carteira, quando a loja paga o boleto. Boleto não pago não gera comissão.",
  "Loja que se cadastrou pelo meu link de convite e que EU atendo: recebo 10% de cada boleto pago. Se a loja passar a ser atendida por outro vendedor, deixo de receber os 10% dela a partir do boleto seguinte.",
  "Loja que o FireHub atribuiu à minha carteira e que eu atendo: recebo 3% de cada boleto pago.",
  "Recarga de disparo pelo WhatsApp oficial das lojas que eu atendo: recebo 3% em cada recarga paga, calculados sobre o que fica com o FireHub depois do custo das mensagens, pelo split do Pix da recarga. O quanto isso dá por pacote aparece no portal. Os 10% do link valem só para o boleto, não para o disparo.",
  "As comissões só valem enquanto eu trabalho com a FireHub e enquanto atendo a loja. Se eu parar de atender uma loja, deixo de receber dela; se eu sair da FireHub, deixo de receber as comissões futuras de todas as lojas, inclusive das que convidei.",
  // ⚠ Ver o alerta no topo do arquivo: comissão de boleto já pago pode ser direito adquirido.
  "Ao sair da FireHub, não terei direito a comissões acumuladas de boletos e recargas ainda não pagos pelas lojas na data da saída. [RASCUNHO — pendente de revisão jurídica]",
  "O FireHub pode mudar estes percentuais avisando com antecedência pelo portal; a mudança vale para os boletos e recargas emitidos depois do aviso, e eu aceito o novo termo para continuar usando o portal.",
];
