# Segurança — o que ainda depende de configuração

Este arquivo lista o que o **código já faz** e o que ainda **depende de uma
variável de ambiente** para passar a valer. Nenhum segredo real mora aqui.

## Variáveis a configurar no Coolify

Enquanto estas não existirem, os webhooks de **pedido** continuam aceitando
requisição não assinada e gravam um aviso no log a cada uma. No instante em que
forem definidas — no servidor **e** no portal do parceiro — a verificação passa
a valer sozinha, sem mexer no código.

| Variável | O que ela fecha | O que acontece sem ela |
|---|---|---|
| `IFOOD_WEBHOOK_SECRET` | `/api/ifood/webhook` | Qualquer um injeta pedido falso na cozinha de uma loja |
| `JOTAJA_WEBHOOK_SECRET` | `/api/jotaja/webhook` | idem |
| `FOOD99_WEBHOOK_SECRET` | `/api/99food/webhook` | idem |

**Por que estes três são interruptor e os de pagamento não.** Os webhooks de
pagamento (Asaas, Celcoin, Mercado Pago, MP Point) recusam sem segredo, e podem:
uma confirmação perdida é reenviada pelo gateway. Os de pedido não têm essa
rede — recusar um evento do JotaJá é pedido que some da cozinha, e some **para
sempre**, porque a API dele não tem listagem para recuperar depois.

`MP_WEBHOOK_SECRET` **já é obrigatória**: sem ela, `/api/webhooks/mercadopago`
responde 401. Era o único webhook de pagamento que ainda falhava aberto.

## O que já está valendo, sem depender de configuração

- **Senha do entregador é hash.** Era texto puro no banco, e a listagem do painel
  devolvia o valor no JSON a cada carregamento da tela. A migração acontece no
  próprio login: senha legada é conferida como está e regravada como hash na
  mesma requisição, sem trancar ninguém para fora.
- **Fim do login por nome parcial.** O entregador era encontrado por `includes`,
  então uma única letra casava com o primeiro cujo nome a contivesse. Somado à
  senha padrão `123456` — que a mensagem de erro ensinava a quem errasse — dava
  acesso ao app de entregas de qualquer loja em duas tentativas. Com acesso, se
  vê endereço, telefone e nome dos clientes.
- **A senha padrão continua valendo** para quem ainda não trocou. Tirá-la de uma
  vez trancaria entregador para fora no meio do turno, que foi o que derrubou a
  correção anterior de multi-tenant. O painel agora avisa quem ainda usa, e o
  login devolve `mustChangePassword`.
- **Freio de tentativas no login do painel.** Não havia limite nenhum. Três
  falhas passam; da quarta em diante a espera cresce (1, 5, 15, 30 minutos). A
  contagem principal é por **conta**, não por IP — o IP vem de
  `x-forwarded-for`, que quem chama escreve, e trocá-lo a cada tentativa
  contornaria o limite.
- **`getClientIp` deixou de confiar no primeiro salto.** Lia o primeiro endereço
  de `x-forwarded-for` — justamente o que o cliente manda. Todo rate limit
  construído sobre ele era contornável com um cabeçalho.
- **iFood: a assinatura passou a valer.** O código já calculava o HMAC,
  comparava, e ignorava o resultado com um "Processando mesmo assim" no log.
- **Mercado Pago: dois contornos fechados.** Além do fail-open, bastava **omitir**
  o cabeçalho `x-signature` para a verificação inteira ser pulada, mesmo com o
  segredo configurado.

## Pendências que não se resolvem no código

- **Repositório público** — o histórico ainda guarda os blobs das credenciais
  antigas. A chave Asaas vazada já foi rotacionada e está morta; deixar o
  repositório privado fecha o resto.
- **PAT do GitHub em texto puro** no `.git/config` (na URL do remote).
- **IDOR multi-tenant em aberto** — `print-queue`, `motoboys/orders`,
  `motoboys/location`, `assign-motoboy`, `store/routes` e `admin/menu-products`
  seguem entregando ou alterando dados de qualquer loja. A correção anterior foi
  revertida por quebrar operação (a impressão parava em todas as lojas; os
  motoboys ficavam trancados fora do app) e precisa ser refeita com alguém
  disponível para testar.
- **Tokens de integração em texto puro no banco** — `mpAccessToken`,
  `ifoodAccessToken`, `jotajaClientSecret`, `food99SecretKey`,
  `metaFbAccessToken`. Quem ler o banco age como a loja em cada parceiro.
- **Row-Level Security** — não está ativa. A separação entre lojas hoje é feita
  no `WHERE` de cada consulta, não pelo banco.
