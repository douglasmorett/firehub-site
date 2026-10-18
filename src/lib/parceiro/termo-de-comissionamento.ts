/**
 * O TERMO DE COMISSIONAMENTO DO VENDEDOR — um texto só: o portal mostra este e
 * o servidor grava a versão aceita (lib/parceiro/aceite-do-termo.ts). Mudou o
 * texto, mude a versão: quem aceitou a anterior vê o termo de novo.
 *
 * É o termo do VENDEDOR (contratado da FireHub). A indicação de EMBAIXADOR é
 * outro programa — autônomo e recorrente — e não é regida por este termo
 * (Douglas, 18/10/2026: "embaixador vai ganhar recorrente de quem ele botou
 * para dentro… o vendedor que ganha 10% perde se sair. Porque o embaixador é
 * um cara autônomo; o vendedor é contratado nosso").
 *
 * As comissões de vendedor (10% do link de vendedor enquanto atende, 3% das
 * atribuídas, 3% sobre a margem do disparo) só valem enquanto o vendedor
 * trabalha com a FireHub e enquanto atende a loja.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ RASCUNHO — REVISÃO JURÍDICA ANTES DE PUBLICAR A VERSÃO FINAL            │
 * │                                                                          │
 * │ O Douglas também disse "não tem direito às comissões acumuladas". A       │
 * │ cláusula 7 está escrita com essa intenção, MAS comissão de boleto que a   │
 * │ loja JÁ PAGOU pode ser direito adquirido do vendedor:                     │
 * │   • SE O VENDEDOR FOR CLT (contratado com carteira): comissão é salário   │
 * │     (CLT art. 457) e é devida quando o negócio se ultima (art. 466, e Lei │
 * │     3.207/57 para vendedor empregado). Cláusula que retira comissão já    │
 * │     adquirida, ou que faz o empregado perder comissão de venda que ele    │
 * │     fez, tende a ser NULA (CLT art. 9º e 468) — o risco é ALTO;           │
 * │   • se for representante comercial autônomo (Lei 4.886/65, art. 32 e     │
 * │     §§): a comissão é devida quando o cliente paga e a rescisão não       │
 * │     apaga comissão já vencida; há ainda indenização de rescisão (art. 27).│
 * │ Recomendação: advogado revisa as cláusulas 6 e 7 E a forma de contratação │
 * │ dos vendedores antes de trocar VERSAO para a definitiva. Enquanto isso, o │
 * │ sistema NÃO retira nada já pago: o split só deixa de pagar comissões      │
 * │ FUTURAS (boletos e recargas emitidos depois da saída).                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Arquivo puro (sem banco): a tela importa.
 */
export const VERSAO_DO_TERMO_DE_COMISSIONAMENTO = "2026-10-18b-rascunho";

export const TITULO_DO_TERMO_DE_COMISSIONAMENTO = "Termo de comissionamento — vendedor FireHub";

export const RASCUNHO_PENDENTE_DE_REVISAO_JURIDICA = true;

export const CLAUSULAS_DO_TERMO_DE_COMISSIONAMENTO = [
  "Este termo vale para as minhas comissões de VENDEDOR da FireHub. Indicação de embaixador é outro programa (autônomo), com regra própria: se eu também for embaixador, as lojas que indiquei como embaixador seguem pagando o % de embaixador enquanto estiverem ativas e pagando, e não entram nas regras de perda abaixo.",
  "Comissão é uma parte do que a loja paga ao FireHub (o boleto do mês: mensalidade e serviços cobrados nele), não das vendas da loja. Ela é paga pelo split do Asaas, direto na minha carteira, quando a loja paga o boleto. Boleto não pago não gera comissão.",
  "Loja que se cadastrou pelo meu link de vendedor e que EU atendo: recebo 10% de cada boleto pago. Se a loja passar a ser atendida por outro vendedor, deixo de receber os 10% dela a partir do boleto seguinte.",
  "Loja que o FireHub atribuiu à minha carteira e que eu atendo: recebo 3% de cada boleto pago.",
  "Recarga de disparo pelo WhatsApp oficial das lojas que eu atendo: recebo 3% em cada recarga paga, calculados sobre o que fica com o FireHub depois do custo das mensagens, pelo split do Pix da recarga. O quanto isso dá por pacote aparece no portal. Os 10% do link valem só para o boleto, não para o disparo.",
  "As comissões de vendedor só valem enquanto eu trabalho na equipe de vendas da FireHub e enquanto atendo a loja. Se eu parar de atender uma loja, deixo de receber dela; se eu sair da equipe, deixo de receber as comissões de vendedor futuras de todas as lojas, inclusive das que convidei pelo meu link de vendedor.",
  // ⚠ Ver o alerta no topo do arquivo (CLT 457/466): comissão de boleto já pago pode ser direito adquirido.
  "Ao sair da equipe, não terei direito a comissões de vendedor acumuladas de boletos e recargas ainda não pagos pelas lojas na data da saída. [RASCUNHO — pendente de revisão jurídica]",
  "O FireHub pode mudar estes percentuais avisando com antecedência pelo portal; a mudança vale para os boletos e recargas emitidos depois do aviso, e eu aceito o novo termo para continuar usando o portal.",
];
