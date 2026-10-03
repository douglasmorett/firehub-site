# Textos para a App Store e a Google Play

Rascunho do que as duas lojas pedem na publicação. Ajustar antes de colar.

## Ficha

- **Nome:** FireHub Entregador
- **Subtítulo (iOS, até 30):** Entregas da sua loja no bolso
- **Descrição curta (Play, até 80):** Suas entregas, a rota, o recebimento na porta e o acerto do dia.
- **Categoria:** Negócios (iOS) / Comer e beber ou Negócios (Play)
- **Classificação:** Livre

**Descrição:**

> O app do entregador das lojas que usam o FireHub.
>
> • Veja as entregas na ordem da rota que a loja montou.
> • Abra o caminho no Google Maps ou no Waze com um toque.
> • Puxe o pedido escaneando o QR da comanda.
> • Saiba quanto receber na porta, com o troco já calculado.
> • Confirme a entrega com o código do iFood ou do 99Food.
> • Receba aviso de pedido novo mesmo com o celular no bolso.
> • Confira seu relatório: entregas, quanto tem a receber e o dinheiro a acertar com a loja.
>
> O acesso é criado pela loja no painel do FireHub.

## Privacidade (App Store: "Privacy Nutrition Label" / Play: "Segurança dos dados")

| Dado | Coleta | Para quê | Com quem |
|---|---|---|---|
| Localização precisa | Sim, só durante o expediente (o entregador pode pausar) | Mostrar o entregador no mapa da loja e registrar onde a entrega foi confirmada | A loja que cadastrou o entregador |
| Nome e telefone | Sim (cadastrados pela loja) | Identificar o entregador | A loja |
| Identificador do aparelho para notificações | Sim | Avisar pedido novo | Expo, que entrega o aviso como prestadora de serviço (não usa o dado para outra coisa) |
| Câmera | Só lê o QR, não grava nem envia imagem | Puxar pedido e entrar | — |

- Nada é vendido nem usado para publicidade. Não há rastreamento entre apps (iOS: sem App Tracking Transparency).
- Os dados vão por HTTPS (criptografia em trânsito).
- Excluir os dados: o entregador pede à loja, que apaga o cadastro no painel. A política de privacidade está em https://firehubfood.com.br/privacidade.

## Nota para a revisão

> Este é o app interno dos entregadores das lojas que usam o FireHub (sistema de delivery). A conta é criada pela loja e não existe cadastro dentro do app.
>
> Conta de teste: loja `<slug da loja de demonstração>`, telefone `<...>`, senha `<...>`. Ela tem pedidos de exemplo atribuídos.
>
> Localização: enquanto o entregador está trabalhando, o app manda a posição para a loja ver no mapa. No Android, isso roda num serviço em primeiro plano com notificação visível. No iPhone, aparece o indicador azul de localização. O app pede só a permissão "durante o uso", e o entregador pode pausar a qualquer momento no botão do topo da tela.

**Play Console, declaração de serviço em primeiro plano (`FOREGROUND_SERVICE_LOCATION`):** tipo "Localização". O uso é acompanhar a entrega em andamento, que o próprio usuário inicia. O Google pede um vídeo curto: entrar, mostrar a notificação "Você está trabalhando", abrir o Maps e voltar, e o pino mexendo no painel da loja.

## Imagens

- iPhone 6,9" (1320×2868) e 6,5" (1284×2778): entregas, fluxo de receber, código do iFood, relatório.
- Android: pelo menos 2 capturas de 1080×1920, mais o ícone de 512×512 (`assets/images/icon.png` reduzido) e o banner de 1024×500.
