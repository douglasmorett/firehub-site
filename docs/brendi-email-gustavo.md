# Rascunho de e-mail — parceria de integração Brendi

**Para:** gustavo.dalbosco@brendi.com.br (contato oficial de integrações na vitrine Open Delivery)
**Assunto:** Parceria de integração FireHub × Brendi (Open Delivery) — cadastro enviado

---

Olá, Gustavo!

Somos o **FireHub** (firehubfood.com.br), sistema de gestão para restaurantes — gestor
de pedidos, PDV, KDS, impressão automática de comandas, motoboys com roteirização e
emissão fiscal. Temos integrações de pedidos em produção com **iFood, JotaJá (Open
Delivery) e 99Food**, e vários restaurantes nossos clientes usam a Brendi e pedem a
integração.

Acabamos de enviar o cadastro de parceiro em **integrations.brendi.com.br** e também
registramos a solicitação pelo WhatsApp da Brenda. Como já operamos o padrão **Open
Delivery** com outro originador, nosso lado está praticamente pronto — implementamos o
fluxo completo (oauth/token, events:polling + acknowledgment, GET /v1/orders, confirm/
preparing/readyForPickup/dispatch/delivered, requestCancellation) apontando para
`https://api.brendi.com.br`, aguardando apenas credenciais.

Para fecharmos a homologação rápido, estas são as dúvidas técnicas:

1. **Credencial**: o Client ID/Secret é gerado por RESTAURANTE (painel de cada loja em
   Integrações → API Pública) ou por PARCEIRO (uma credencial do FireHub cobrindo N
   lojas)? Onde o lojista copia o `merchantId`?
2. **Versão do Open Delivery** adotada e, se possível, um **JSON de exemplo de pedido
   real** (com pagamento, agendamento, desconto e entrega própria vs Brendi Motoboy).
3. **Webhook**: formato do POST (evento único ou array), header de assinatura + fórmula
   + onde obter o segredo, política de retry e resposta esperada. Nosso endpoint:
   `https://firehubfood.com.br/api/brendi/webhook`.
4. **ACK do polling**: o acknowledgment remove o evento definitivamente? Existe endpoint
   de listagem/recuperação de pedidos? Paginação além dos 15 itens?
5. **SLA de confirmação**: em quanto tempo um pedido não confirmado é cancelado?
6. **Sandbox**: URL e como obter credenciais/pedidos de teste.
7. **Pagamento**: valores em reais decimais ou centavos? Como distinguem pago online vs
   cobrar na entrega? Campo de troco? O que é `PARTNET_PAYMENT`?
8. **Logística**: como o payload distingue entrega da loja vs Brendi Motoboy (condiciona
   nosso envio de dispatch/delivered)? `validateCode` é obrigatório em algum fluxo?
9. **Cancelamento**: lista de `reason`/códigos aceitos em requestCancellation e prazo da
   disputa (CANCELLATION_REQUESTED).
10. **Rate limits** por endpoint e TTL do token OAuth.
11. **Processo**: prazo de aprovação do cadastro, eventual custo/comissão, e se a tela de
    API Pública fica indisponível quando a assinatura do restaurante está inativa.

Contato: Douglas Morett — contatohakim@gmail.com — WhatsApp (22) 98111-8514.

Abraço!
