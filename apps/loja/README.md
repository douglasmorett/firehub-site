# App próprio da loja

Um projeto só gera o app de cada loja que assina o plano (Android R$ 97/mês, Android + iPhone R$ 197/mês).
O cardápio, o carrinho, o pagamento e o acompanhamento são as páginas do FireHub (`/lojas/<slug>` e
`/loja/<slug>/pedido/<id>`) dentro do app — mudou no painel, mudou no app, sem atualizar nada.
O que o app acrescenta: aba **Pedidos** nativa, aba **Loja** (WhatsApp, mapa, avisos) e **aviso no celular**
quando o pedido é aceito, sai para entrega, fica pronto, é entregue ou cancelado.

## Como funciona o aviso

1. O cliente faz o pedido no app. A página manda `PEDIDO_FEITO` pela ponte do WebView (`src/lib/app-da-loja/ponte.ts` no site).
2. O app guarda o id no celular (aba Pedidos) e liga o aparelho ao pedido: `POST /api/app-da-loja/aparelho`.
3. Cada mudança de status passa por `sendOrderNotification` (`src/lib/order-notifications.ts`), que chama
   `avisarAparelhosDoPedido` antes das regras do WhatsApp.

O aparelho se liga ao **pedido** (id secreto), nunca ao telefone digitado: ninguém recebe o status do pedido de outra pessoa.

## Loja nova

1. `marcas/<id>/marca.json` (copiar o da Hakim) e as imagens:
   - `icon.png` 1024×1024 **sem transparência**
   - `android-fundo.png` 1024×1024 (a logo inteira; o Android corta em círculo, então o desenho tem de caber nos 66% do meio)
   - `android-frente.png` 1024×1024 transparente
   - `splash.png` (a logo, ~600 px)
   - `notificacao.png` 96×96 branco com fundo transparente
2. `paginaInicial`: `/lojas/<slug>` se a loja tem (ou vai ter) mais de uma unidade — a página escolhe a unidade
   pelo bairro e, com uma só, cai direto nela. Senão `/loja/<slug>`.
3. Perfis `teste-<id>` e `producao-<id>` no `eas.json` com `"env": { "MARCA": "<id>" }`.
4. `MARCA=<id> npx eas-cli@latest init` cria o projeto no Expo — copiar o `projectId` para `easProjectId`.
5. Firebase (aviso no Android): app Android com o `bundleId` no projeto do Firebase → `google-services.json`
   em `marcas/<id>/` (fora do git) e, no EAS, como variável de arquivo `GOOGLE_SERVICES_JSON`; a chave da conta de
   serviço (FCM V1) vai em `eas credentials`.
6. Build: `npx eas-cli@latest build -p android --profile producao-<id>` (e `-p ios`).

## Regra das lojas (importante para vender)

A Apple (diretriz 4.2.6) e o Google (conteúdo repetitivo) **não aceitam** app de modelo publicado pela FireHub em nome
do cliente. Cada loja publica na **conta de desenvolvedor dela** (Google US$ 25 uma vez; Apple US$ 99/ano), de
preferência com CNPJ e D-U-N-S (conta pessoal nova no Google exige 12 testadores por 14 dias), e adiciona a FireHub
como administradora. A Hakim é marca nossa e sai nas nossas contas.
