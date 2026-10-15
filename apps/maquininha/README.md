# FireHub Maquininha

App Android nativo que roda **dentro** de uma maquininha Smart POS e cobra os
pedidos que o cliente fecha no totem de autoatendimento (e, do lado do servidor,
também as contas de mesa).

O mesmo código gera **um APK por adquirente**: PagBank (SDK PlugPag), Stone,
Cielo e Getnet (deeplink para o app de pagamento de cada uma). Ver
[Quatro adquirentes](#quatro-adquirentes). O resto deste arquivo foi escrito
para o PagBank e continua valendo para ele; o que muda nas outras está naquela
seção.

O totem é uma página web num tablet; a maquininha fica ao lado. O cliente monta
o pedido no totem e paga aqui. Quem cobra é este app, usando a
PlugPagServiceWrapper.

## Por que o aparelho é que pergunta

A PagBank não expõe API de nuvem para acender uma cobrança à distância. Isso
inverte o sentido da conversa:

```
FireHub  <---- "tem cobrança pra mim?" ----  app na maquininha
FireHub  ---- "sim, R$ 45,90, pedido 42" -->  app na maquininha
FireHub  <---- "aprovado, NSU 123456"  ----  app na maquininha
```

O servidor já está no ar e não precisa de nada novo. São duas rotas:

| Rota | O que faz |
|---|---|
| `GET /api/pos/terminal/pendente?token=…&versao=…` | Devolve a cobrança e **reserva** o pedido para esta maquininha |
| `POST /api/pos/terminal/resultado` | Registra o que aconteceu com o cartão. É idempotente |

`401 TERMINAL_DESCONHECIDO` e `403 TERMINAL_DESATIVADO` são paradas definitivas:
o app para de perguntar e pede o pareamento de novo, em vez de martelar o
servidor para sempre.

## As três telas

1. **Pareamento** — o lojista gera um código de 64 caracteres no painel do
   FireHub (Maquininhas) e digita aqui. O código **é** a credencial. Só é
   gravado depois que o servidor responde 200.
2. **Ativação do terminal** (só no APK do PagBank) — só aparece se o terminal ainda não estiver ativado
   no PagBank. Aceita o código de ativação ou entrega a tarefa ao aplicativo de
   boas-vindas do próprio PagBank.
3. **Operação** — o dia inteiro em "Aguardando pedido". Quando chega cobrança,
   mostra o valor em corpo grande, pergunta a forma de pagamento e depois espelha
   o andamento do pinpad ("APROXIME O CARTÃO", "DIGITE A SENHA"). Termina em
   verde ou vermelho, com o motivo.

Pareamento (FireHub) e ativação (PagBank) são coisas diferentes e as telas não
as misturam: a primeira diz de qual loja o aparelho é, a segunda habilita o
aparelho a passar cartão.

## Como compilar

Pré-requisitos: **JDK 17** e Android SDK com **compileSdk 34**. Kotlin 1.9.24 e
AGP 8.4.0 já vêm declarados no projeto.

```bash
cd apps/maquininha
./gradlew assemblePagbankDebug assembleStoneDebug assembleCieloDebug assembleGetnetDebug
./gradlew assemblePagbankRelease          # APK para homologação (um por adquirente)
./gradlew :simulador:assembleDebug        # simulador das adquirentes de deeplink
```

`local.properties` (fora do git) precisa de
`sdk.dir=C:/Users/<você>/AppData/Local/Android/Sdk` — com barras normais: no
formato `.properties` a barra invertida é escape e `C:\Users` vira `C:Users`.

Se não houver `gradlew` na pasta (o `.jar` do wrapper não vai ao repositório),
abra a pasta no Android Studio uma vez — ele o gera — ou rode `gradle wrapper`
com um Gradle 8.7 instalado.

O SDK de pagamento vem de um repositório Maven hospedado no GitHub do PagBank,
já declarado em `settings.gradle.kts`. **O POM dele é vazio e não declara
dependência nenhuma.** Isso é intencional deste app: como aqui só se usam os
métodos síncronos do wrapper, as classes que dependem de RxJava nunca são
carregadas. Se alguém trocar `doPayment` por `doAsyncPayment`, tem que adicionar
`io.reactivex.rxjava2:rxjava` e `:rxandroid` na mesma hora — senão compila e
estoura `NoClassDefFoundError` na hora de cobrar.

### Assinatura

O PagBank amarra a homologação ao `packageName` **e** à assinatura. Se a chave
mudar, o app deixa de ser o mesmo app para eles. Crie
`apps/maquininha/keystore.properties` (fora do controle de versão):

```properties
storeFile=../chaves/firehub-maquininha.jks
storePassword=…
keyAlias=firehub
keyPassword=…
```

A configuração já liga **V1 e V2** juntas: a homologação exige as duas, e o
padrão do Gradle moderno é só V2.

### Instalar no terminal de debug

```bash
adb install -r app/build/outputs/apk/pagbank/release/app-pagbank-release.apk
```

O terminal de debug já vem apontado para o ambiente de testes e identificado por
marca d'água na tela. As transações vão para o simulador de vendas do PagBank:
dá para passar cartão real sem cobrança de verdade.

## Como parear

1. No painel do FireHub: **Maquininhas → gerar código de pareamento**.
2. O código aparece **uma única vez** — depois disso o painel o esconde, porque
   ele é credencial.
3. Abra o app no terminal, digite os 64 caracteres e toque em "Ligar à loja".
4. O app valida chamando a própria rota da fila. 200 significa que vale.

Maiúsculas e espaços são normalizados na digitação: o gerador do FireHub produz
hexadecimal minúsculo e o servidor compara o texto exato, então um código
digitado em maiúsculo não bateria e o lojista veria "maquininha não cadastrada"
olhando para o código certo.

O token fica em `EncryptedSharedPreferences`, com a chave mestra no Android
Keystore — o guia de boas práticas do PagBank proíbe credencial em
`SharedPreferences` puro ou SQLite.

## O orçamento de dados do chip

Este é o número que manda no desenho do polling. A franquia de trabalho é de
**~30 MB/mês**.

### Quanto custa uma consulta

| Situação | Custo aproximado |
|---|---|
| Conexão reaproveitada (keep-alive) | **~0,8 KB** |
| Conexão nova, com retomada de sessão TLS | ~2,3 KB |
| Conexão nova, handshake completo | ~5,5 KB |

A consulta em si é minúscula: a URL com o token, uns 200 bytes de cabeçalho, e
uma resposta de `{"cobranca":null,"terminal":"…"}`. O que custa é **abrir
conexão**. Por isso `ApiDoFireHub` nunca chama `disconnect()`: fechar o socket
obriga a próxima consulta a refazer o TLS inteiro.

A consequência é contraintuitiva e vale registrar: **intervalos logo acima da
janela de keep-alive custam mais por consulta do que intervalos menores.**

### Loja aberta 12 h/dia, 30 dias (1.296.000 s)

| Intervalo fixo | Consultas/mês | Tráfego/mês |
|---|---|---|
| 2 s | 648.000 | ~518 MB |
| 5 s | 259.200 | ~207 MB |
| 30 s | 43.200 | ~35 MB |
| 60 s | 21.600 | ~50 MB (keep-alive já caiu) |
| 180 s | 7.200 | ~17 MB |

Nenhum intervalo fixo serve: os rápidos estouram a franquia, e os lentos deixam
o cliente parado na frente do totem esperando a maquininha acordar.

### A escada adaptativa

Daí os degraus em `Ajustes.kt`. O relógio zera a cada sinal de movimento
(cobrança recebida, resultado enviado, tela aberta):

| Parado há | Wi-Fi | Chip |
|---|---|---|
| 0 – 90 s / 2 min | 2 s | 5 s |
| até 10 min | 5 s | 20 s |
| até 30 min | 15 s | 60 s |
| mais que isso | 30 s | 180 s |

Restaurante recebe pedido em rajada: um pedido quase sempre significa outro logo
atrás, e é justamente aí que o cliente não pode esperar. Fora da rajada, ninguém
está olhando.

### O veredito honesto

Com 80 pedidos/dia, a escada do chip dá por volta de **2.300 consultas/dia ≈ 55
MB/mês**. Ou seja: **não cabe em 30 MB.**

Cabe se a loja tiver menos movimento, ou se os dois primeiros degraus forem
afrouxados para 10 s e 40 s — o que custa até 10 segundos de espera do cliente
depois de fechar o pedido no totem.

**A conclusão de projeto é essa: a maquininha precisa estar no Wi-Fi da loja.**
O chip é plano B para quando o Wi-Fi cai, e nesse modo o app degrada de propósito
para caber. `RitmoDoPolling` detecta o transporte sozinho e troca de escada; se
não conseguir descobrir, assume chip, porque errar para o lado do Wi-Fi queima a
franquia do mês numa tarde.

Os números ficam todos em `Ajustes.ESCADA_NO_WIFI` e `Ajustes.ESCADA_NO_CHIP`,
num arquivo só, para poderem ser ajustados sem mexer em lógica.

## O caso que o app existe para não deixar acontecer

O cartão foi debitado e a rede caiu antes de o FireHub saber. O dinheiro já saiu.
Se esse resultado se perder, **o cliente pagou e o pedido não sai da cozinha.**

Quatro defesas, em `FilaDeResultados` e `ServicoDeCobranca`:

1. **O resultado vai para o disco antes de qualquer tentativa de envio**, e só
   sai de lá quando o servidor confirmar. Reenviar é seguro: a rota é idempotente
   e responde `jaConfirmado`. O app insiste para sempre, com espera dobrando até
   um minuto.
2. **Um marcador é gravado antes de o cartão ser tocado.** Se faltar energia no
   meio da transação, o app encontra o marcador na volta e pergunta ao terminal,
   com `getLastApprovedTransaction()`, se aquela venda chegou a ser aprovada.
   Essa pergunta tem **três** respostas possíveis, e tratá-las como duas é como
   se perde dinheiro:
   - *foi esta venda* → o resultado aprovado entra na fila;
   - *foi outra venda* → o cartão não passou; a recusa devolve o pedido para a
     fila na hora, sem esperar os cinco minutos do servidor;
   - *não deu para perguntar* → **o marcador fica no disco.** Acontece de
     verdade logo depois do boot, quando o app sobe pelo `BOOT_COMPLETED` e o
     serviço do PagBank ainda não está no ar. A pergunta se repete a cada cinco
     segundos por um minuto; passou disso, o registro vai para a lista de
     atenção com o código da venda, para alguém procurar no extrato do PagBank.
3. **Gravação atômica**: escreve em arquivo temporário, força a descida ao disco
   com `sync()`, e só então renomeia. Numa maquininha de balcão, onde o cabo é
   chutado com frequência, escrever direto no arquivo final significaria perder
   *todos* os pendentes de uma vez por causa de um JSON pela metade.
4. **Antes de cobrar, o app pergunta se já cobrou.** Se existir resultado
   aprovado em aberto para aquele `pedidoId` — na fila de reenvio ou na lista de
   atenção — o cartão **não** passa de novo: o app reenvia o resultado que já
   tem. É o que fecha o buraco descrito abaixo, em "cobrar duas vezes".

Quando o servidor recusa em definitivo (404, 409), o resultado sai da fila de
reenvio e vai para uma lista de atenção, que aparece na tela até alguém resolver.
Ela **não** bloqueia a maquininha: parar a loja inteira por causa de um pedido
que já não tem conserto automático seria pior. Um toque longo sobre o aviso, com
confirmação, marca a lista como resolvida — sem isso o alerta ficaria na tela
para sempre e o operador aprenderia a não ler aquela área, que é a mesma onde
aparece o contador de pagamentos ainda não confirmados.

### Cobrar duas vezes

O caminho que existia era este: o cartão passa, o POST do resultado não chega ao
servidor, e **cinco minutos depois o servidor destrava o pedido sozinho** e o
devolve para a fila — a mesma fila que esta maquininha consulta. Sem a defesa 4,
o app pegava o pedido de volta e mandava o cliente encostar o cartão numa compra
que ele já tinha pagado.

A comparação é por `pedidoId`, e não por tentativa, por um motivo concreto: **o
servidor não incrementa `posTentativas` quando devolve um pedido recusado para a
fila.** A `referencia` que volta é sempre a mesma (`<pedidoId>:<n>`), então
comparar por tentativa não separaria nada. Isso também significa que o código da
venda mandado ao PagBank se repete entre tentativas do mesmo pedido — ver
"pendências do lado do servidor", no fim deste arquivo.

### O pedido abandonado que trava a fila

A fila do servidor é atendida por ordem de criação (`orderBy createdAt asc`) e um
pedido recusado volta para ela na hora. Um cliente que fecha o pedido no totem e
vai embora deixa, portanto, o pedido **mais antigo** da fila — e é ele que a
maquininha recebe de novo, e de novo, e de novo. Com os dois minutos cheios de
espera por forma de pagamento, esse pedido sozinho prende o terminal em ciclos de
dois minutos e ninguém que pediu depois consegue pagar.

O app faz o que dá para fazer do lado dele: na segunda vez que o **mesmo**
pedido volta sem ninguém pagar, o prazo cai para 20 segundos, o laço ganha meio
minuto de respiro para não girar em vazio (nem queimar franquia do chip), e a
tela passa a dizer qual pedido é e que alguém precisa resolvê-lo no painel.

Isso é mitigação, não conserto: **quem tira o pedido da fila é uma pessoa no
painel do FireHub.** O conserto de verdade é do lado do servidor — ver o fim
deste arquivo.

### O risco que sobra, escrito por extenso

Quando o app desiste de descobrir o que houve com um cartão (defesa 2, terceiro
caso), ele para de mandar qualquer coisa ao servidor. O pedido continua
reservado lá e volta para a fila cinco minutos depois. Se aquele cartão **tiver**
sido debitado, e alguém encostar outro cartão quando o pedido reaparecer, houve
cobrança dupla.

O que segura esse caso não é código, é a tela: o motivo do registro travado, com
o código da venda, fica visível na faixa de avisos **inclusive durante a escolha
da forma de pagamento**, e cobrar exige que uma pessoa toque em CRÉDITO, DÉBITO
ou VOUCHER. Ou seja, há sempre um humano no caminho da segunda cobrança, e ele
está olhando para o aviso enquanto decide.

Não há como fazer melhor só do lado do app: bloquear o pedido para sempre puniria
o caso mais comum, que é o cartão **não** ter passado e o cliente estar esperando
para pagar.

### Quando a transação diverge

`doPayment` devolve duas fontes de verdade: `result == RET_OK` (o que os exemplos
do KDoc conferem) e `errorCode == "0000"` (o que o app-demo oficial confere).
Normalmente concordam. Quando discordam, este app considera **aprovado**, e
registra a divergência no log.

A escolha é assimétrica de propósito, porque os dois erros não custam o mesmo:
dizer "aprovado" sem ter debitado deixa um pedido sem lastro, que aparece na
conciliação do fim do dia; dizer "recusado" tendo debitado manda o cliente pagar
duas vezes a mesma compra, na frente do caixa.

## O que depende do PagBank

### O caminho inteiro, na ordem

Nada disto é técnico e nada disto se resolve escrevendo código. É a parte que
trava o projeto se ninguém começar cedo.

| # | O que fazer | Onde | Prazo |
|---|---|---|---|
| 1 | **Fechar parceria comercial** e ter conta avançada no PagBank. Sem isso não existe nem acesso ao terminal de debug | formulário de Contato Comercial no portal do desenvolvedor | não publicado; é o passo mais lento |
| 2 | **Receber o terminal de debug.** Não se compra; vem emprestado e fica com o parceiro enquanto durar a parceria. São dois modelos, GPOS780 e P2, **ambos Android 11** | comercial PagBank | — |
| 3 | **Homologar o app.** Abre-se chamado na opção "Homologação de App" com: APK **release**, **vídeo demonstrativo** mostrando a chamada de pagamento acontecendo, e o **guia do usuário** da aplicação. Junto vai a **lista de endpoints e IPs** (ver APN privada, abaixo) | portal de suporte | **7 dias úteis** por rodada |
| 4 | **Vincular os terminais dos clientes ao Reseller.** Abre-se chamado "Vinculação de terminais" com um `.txt` contendo os **números de série** das maquininhas. Só o desenvolvedor pode pedir — lojista não consegue pedir sozinho | portal de suporte | **24 h úteis** |
| 5 | **Pedir a atualização automática.** Ela **não vem ligada**. Sem esse chamado, toda versão nova exige alguém abrir a Loja de Apps em cada terminal, em cada loja | chamado com Integrações | — |

Consequências práticas que valem estar escritas:

- **A distribuição é fechada.** O app não vai para a Play Store: vai para a Loja
  de Aplicativos do terminal, visível só para os aparelhos vinculados ao
  Reseller. Terminal movido para outro Reseller perde o acesso ao app.
- **Trocar o `packageName` ou a chave de assinatura exige homologação nova.**
  São os dois identificadores do app para o PagBank.
- **Atualização depois de homologado** sobe direto na loja interna, com SLA de
  até 24 h úteis. É a única parte rápida do processo.
- **Um terminal, uma loja.** Cada aparelho é vinculado a um único CNPJ no
  PagBank. Maquininha não se compartilha entre franqueados.
- **Terminal de debug não vira terminal de produção**, e vice-versa.

### Não dá para testar sem hardware

**Não existe emulador, mock nem sandbox de software.** O único ambiente de teste
é o terminal de debug, que é hardware emprestado pelo PagBank e sai por contato
comercial (GERTEC GPOS780 ou SUNMI P2, ambos Android 11). Este app não foi
executado em terminal nenhum: foi escrito contra o KDoc oficial, o AAR 1.35.0
descompactado e o app-demo do PagBank.

Código de ativação fixo do ambiente de debug: **749879**.

Detalhe que muda o planejamento: o `minSdk` é 23 por causa do **SK800**, o
terminal de totem, que roda Android 6. Mas os terminais de debug que o PagBank
empresta são só o GPOS780 e o P2, **ambos Android 11** — ou seja, **não há como
testar o app no SK800 antes de vendê-lo para uma loja.** Se o alvo for o SK800,
vale pedir um ao comercial explicitamente antes de prometer prazo.

### Regras que reprovam na homologação

- **WebView é proibida.** `ACCESS_WEBVIEW` está na lista de permissões bloqueadas
  e o FAQ cita Ionic e Cordova pelo nome. Este app é Kotlin nativo, sem WebView.
- **Não citar outra adquirente nem outra forma de pagamento** — nem em string,
  nem em ícone, nem em comentário que apareça na tela. Por isso o APK do
  PagBank só mostra três botões (`PagamentoNaMaquininha.formasAceitas`), e todo
  texto que cita adquirente mora em `src/<flavor>/res/values/adquirente.xml` —
  o APK do PagBank não leva o nome de nenhuma outra (conferido no dex e nos
  recursos). O enum `TipoDePagamento` tem `PIX` por causa das outras três; no
  PagBank ele nunca vira botão nem texto de recurso.
- **O app tem que chamar o SDK de verdade.** App que não cobra não passa.
- **Não separar em dois apps** (um de pedidos, outro de pagamento).
- APK ≤ 200 MB, assinatura **V1 e V2**, `versionCode` único e crescente, sem
  `allowBackup`, `testOnly` ou `debuggable` no release.
- HTTPS com TLS 1.2+, `cleartextTrafficPermitted` desligado.
- Credencial no Android Keystore, nunca em `SharedPreferences` ou SQLite.
- Sem Google Play Services em produção, sem SDK de terminal de terceiros
  (SUNMI, PAX), sem serviço de acessibilidade, sem SDCARD.
- `QUERY_ALL_PACKAGES` é **proibida**: a checagem do serviço do PagBank usa
  `<queries>` com o pacote nomeado.
- `SYSTEM_ALERT_WINDOW` é **proibida**: é por isso que trazer a tela para a
  frente usa `fullScreenIntent`, e não janela sobreposta.
- `DISABLE_KEYGUARD` também é **proibida**. Fazer a tela aparecer com o aparelho
  bloqueado usa `setShowWhenLocked()` / `setTurnScreenOn()`, que são chamadas de
  API e não pedem permissão nenhuma.

Todas as permissões declaradas estão na lista de **permitidas** do guia, com uma
exceção que precisa de justificativa no chamado:

- **`USE_FULL_SCREEN_INTENT`** não aparece em nenhuma das duas listas, e o guia
  diz que "qualquer permissão não mencionada será analisada pontualmente". Ela é
  obrigatória: sem ela o Android **não devolve erro**, apenas rebaixa o
  `fullScreenIntent` para um aviso comum na barra — ou seja, a tela de cobrança
  deixa de vir para a frente e o pedido fica reservado numa maquininha que
  ninguém está olhando. A justificativa a mandar é essa.
- `br.com.uol.pagseguro.permission.MANAGE_PAYMENTS` é a permissão do próprio
  SDK; entraria pelo merge do AAR de qualquer jeito e está declarada explícita
  para não aparecer "do nada" na análise.

### A APN privada — item que precisa entrar no formulário

A APN do chip do PagBank é **privada**. Só sai pacote para endereço que estiver
na lista de endpoints enviada na homologação.

> **`firehubfood.com.br` (443/TCP) tem que ser declarado.** Se o domínio ou o IP
> mudar depois — troca de servidor, CDN na frente, IP dinâmico — o app para de
> falar com o FireHub no chip até alguém abrir chamado. Vale considerar IP fixo
> antes de homologar.

Por isso o endereço é constante compilada e não campo de tela: um servidor
digitado pelo lojista simplesmente não teria resposta no 4G.

## Conferir com o terminal de debug na mão

Pontos que a documentação não fecha. Cada um está isolado numa função só, com
comentário, para ser verificado com hardware:

| O que | Onde | Por quê |
|---|---|---|
| `targetSdk` 23 ou 34 | `app/build.gradle.kts` | O guia de boas práticas diz 23, o app-demo oficial usa 34. Ficamos em 34. **Perguntar ao contato de integrações antes de submeter** |
| Código da venda de 10 caracteres | `PagamentoNaMaquininha.montarReferenciaCurta` | `userReference` aceita 10 caracteres alfanuméricos; a referência do FireHub (`ckx…:1`) não cabe. Decisão tomada: 6 últimos do pedido + `T` + tentativa, ex. `A1B2C3T1`. Confirmar que aparece legível no extrato |
| Popup de comprovante | `PagamentoNaMaquininha.prepararPopupDeComprovante` | Não está documentado se o popup aparece com `printReceipt = false`. `maxTimeShowPopup = 60` está posto por precaução: sem timeout, um popup esperando toque trava a fila do totem |
| Thread do `onEvent` | `PagamentoNaMaquininha.ouvinteDeAndamento` | A documentação não garante em qual thread os eventos chegam. O ouvinte só entrega texto e não toca em View, então funciona nos dois casos |
| Trazer a tela para a frente | `ServicoDeCobranca.chamarOperador` + `USE_FULL_SCREEN_INTENT` no manifesto | `startActivity` direto funciona até o Android 9; da API 29 em diante o caminho é `fullScreenIntent`, e ele **depende da permissão** — sem ela o Android rebaixa o aviso em silêncio. Confirmar no GPOS780 (Android 11) que a tela sobe mesmo com o operador em outro app |
| Tipo do serviço em primeiro plano | `AndroidManifest.xml` | `connectedDevice` foi escolhido em vez de `dataSync` porque `dataSync` tem teto de 6 h/dia a partir da API 34, e loja abre 12 |
| `getLastApprovedTransaction()` devolve mesmo só venda aprovada? | `PagamentoNaMaquininha.conferirUltimaAprovada` | O app **assume que sim** e marca `aprovado = true` quando o código da venda bate, em vez de reaproveitar o teste do `doPayment` — os campos `result` e `errorCode` são todos anuláveis no SDK e, vindo vazios nesta consulta, aquele teste concluiria "recusado" e o app jogaria fora um cartão debitado de verdade. **Este é o ponto que mais precisa de terminal.** Teste: passe um cartão, mate o app no meio, reabra e confira que o pedido é liberado |
| Formato de `amount` na volta | mesma função | O KDoc diz centavos na ida (`1000` = R$ 10,00) e não fala da volta. O app tira os não-dígitos, o que cobre `"1000"` e `"0001000"`. Se algum terminal devolver `"10.00"`, a segunda conferência (valor) rejeita um casamento legítimo e o registro vai para a lista de atenção em vez de liberar o pedido. Ver o valor cru no log de `conferirUltimaAprovada` |

Não implementado de propósito: **estorno**. O SDK oferece `voidPayment` e o FAQ
oficial diz "cancelamento em até 24h", mas o FireHub ainda não tem fluxo de
estorno no painel. Quando tiver, `transactionCode` e `transactionId` são os dois
campos a guardar.

## Pendências do lado do servidor

Duas coisas que o app **não consegue** consertar sozinho, achadas lendo
`src/app/api/pos/terminal/*`:

1. **`posTentativas` nunca é incrementado no caminho da maquininha.** Quem o
   incrementa é só `/api/totem/payment/start`. Quando a rota de resultado
   devolve um pedido recusado para a fila, ela mexe em `posStatus` e
   `posTerminalId` e deixa o contador parado. Consequências:
   - a `referencia` de duas tentativas do mesmo pedido é idêntica, então o
     `userReference` mandado ao PagBank se repete e o extrato não separa as
     tentativas;
   - a recuperação por `getLastApprovedTransaction()` não consegue distinguir a
     tentativa 1 da tentativa 2 do mesmo pedido pelo código da venda.

   O conserto é uma linha: `posTentativas: { increment: 1 }` junto do
   `posStatus: aguardando` no bloco de recusa.

2. **Pedido abandonado trava a fila.** `findFirst` com `orderBy createdAt asc`
   devolve sempre o mais antigo, e um pedido recusado volta para a fila na hora.
   Quem fecha o pedido no totem e vai embora deixa o terminal preso nele, e
   ninguém que pediu depois consegue pagar. O app mitiga (prazo curto, respiro e
   aviso na tela) mas não resolve: quem pode tirar o pedido da fila é o servidor.
   O desenho mais simples é usar o contador do item 1 — a partir de N recusas
   sem cartão encostado, o pedido sai da fila para um estado de atenção que o
   painel mostra.

Também não implementada: **impressão de comprovante**. Quem imprime o pedido é o
FireHub, na impressora da cozinha, e bobina de terminal é consumível que acaba no
meio do movimento.

## Quatro adquirentes

O mesmo app roda nas Smart POS de **PagBank, Stone, Cielo e Getnet**. Cada
adquirente homologa e assina o APK dela, e cada uma reprova app que cite a
concorrente ou carregue SDK de terminal de terceiro. Por isso não existe "um APK
com as quatro": existe um **product flavor** por adquirente (dimensão
`adquirente`), e cada flavor só compila o código e os textos dela.

| Flavor | applicationId | Como cobra | Recuperação depois de queda |
|---|---|---|---|
| `pagbank` | `br.com.firehub.maquininha` (o de sempre) | SDK PlugPag, `doPayment` bloqueante | `getLastApprovedTransaction()` |
| `stone` | `br.com.firehub.maquininha.stone` | deeplink `payment-app://pay`, volta por deeplink | não existe consulta |
| `cielo` | `br.com.firehub.maquininha.cielo` | deeplink `lio://payment`, volta por deeplink | não existe consulta |
| `getnet` | `br.com.firehub.maquininha.getnet` | deeplink `getnet://pagamento/v3/payment`, volta por `onActivityResult` | `getnet://pagamento/v1/checkstatus` pelo `callerId` |

O `pagbank` **não mudou de applicationId**: a homologação PagBank amarra ao
packageName. Ele é o único com a dependência do SDK (`pagbankImplementation`), e
`PagamentoNaMaquininha`/`AtivacaoActivity` moram em `src/pagbank` — os outros
flavors nem compilam esses arquivos (conferido: zero classe `PlugPag` nos APKs
de Stone, Cielo e Getnet).

### O desenho

Tudo que protege o dinheiro continua em `src/main` e vale para as quatro: fila
em disco, marcador gravado **antes** de tocar o cartão, "antes de cobrar,
pergunta se já cobrou", lista de atenção. O que muda por adquirente fica atrás
de `CobradorDaAdquirente` (`src/main/.../pagamento/`):

- `nome`, `formasAceitas` (os botões da tela), `podeAbortar`;
- `cobrar(cobranca, tipo, identificador, aoProgredir) -> ResultadoDoSdk`,
  bloqueante, chamado da thread do serviço como sempre foi;
- `conferir(identificador, valor, tipo) -> ConferenciaDaUltima` (as mesmas três
  respostas: foi esta / não foi / não deu para conferir);
- `montarIdentificador(cobranca)`: o código desta tentativa, gravado no marcador.

Cada flavor tem um `Adquirente.kt` (mesmo pacote, mesmo nome) que diz qual
cobrador está no APK. O polling passa `&adquirente=PAGBANK|STONE|CIELO|GETNET` e
o POST de resultado leva `adquirente` e, quando houver, `idsDaAdquirente`
(ATK/ITK da Stone, `cvNumber` da Getnet, `cieloCode` da Cielo).

**A ponte de deeplink** (`src/deeplink`, compartilhado só por Stone, Cielo e
Getnet): o serviço chama `CanalDaPonte.executar`, que abre a
`PonteDaAdquirenteActivity` (transparente, `singleTop`), que abre o app da
adquirente e recebe a volta — por `onNewIntent`/`onCreate` com a URI (Stone,
Cielo) ou por `onActivityResult` (Getnet). A thread do serviço espera num latch
com prazo de **3 minutos** (`Ajustes.PRAZO_NO_APP_DA_ADQUIRENTE_MS`). Uma
cobrança por vez, por cadeado. Três desfechos, e a diferença entre eles é
dinheiro:

| Desfecho | O que vira | Por quê |
|---|---|---|
| A ponte não abriu (tela do FireHub fora da frente, app da adquirente ausente) | **recusa** | nada chegou ao app da adquirente; o cartão não foi tocado |
| O app da adquirente abriu e não voltou no prazo | **incerto** | o marcador fica; a recuperação decide |
| Voltou | o cobrador lê | na dúvida (campo faltando, valor diferente, resposta de outra venda), **incerto** |

O app fica o dia todo na tela Operação, então a ponte abre normalmente. Se não
estiver em primeiro plano, o Android (API 29+) bloqueia a abertura **em
silêncio**: a ponte não aparece em 10 s, a cobrança é recusada com "a tela do
FireHub não estava aberta" e o pedido volta para a fila — seguro, porque nada
foi aberto.

Resposta que chega **depois** do prazo não se perde: fica guardada em memória e
a recuperação (`conferir`) a usa. Resposta de outra venda é rejeitada onde dá
para saber (a Cielo devolve a `reference`, a Getnet o `callerId`; ambos são o
identificador desta tentativa).

### Recuperação sem consulta (Stone e Cielo) — a decisão

Nenhuma das duas oferece, no deeplink, um jeito de perguntar "a venda X
passou?". Então, quando uma cobrança fica incerta, o app espera um pouco (3
conferências de 5 s) por uma resposta atrasada e, sem ela, manda o registro
para a **lista de atenção** com o recado "confira no aplicativo de pagamento da
Stone/Cielo (últimas transações) antes de cobrar de novo". **Nunca vira
recusa**: recusa devolveria o pedido para a fila e, se o cartão tiver passado,
o cliente pagaria duas vezes. O custo da escolha é uma pessoa olhar o histórico
da maquininha; o da outra seria cobrança dupla.

Na Getnet, incerto (incluindo voltar sem dados, que as libs comunitárias tratam
como "cancelado") vai para o `checkstatus` com o mesmo `callerId`. O `callerId`
é **único por toque de cartão** (pedido + tentativa + relógio), porque o
servidor repete a tentativa quando devolve um pedido recusado, e um `callerId`
repetido faria a consulta devolver a tentativa anterior.

### Formas de pagamento

| | Crédito | Débito | Pix | Voucher |
|---|---|---|---|---|
| PagBank | sim | sim | **não** (regra de homologação) | sim |
| Stone | `CREDIT` | `DEBIT` | `PIX` | `VOUCHER` |
| Cielo | `CREDITO_AVISTA` | `DEBITO_AVISTA` | `PIX` | `VOUCHER_REFEICAO` |
| Getnet | `credit` | `debit` | `pix` | `voucher` |

Sempre à vista. A tela mostra "Conectado - <adquirente>" e só os botões que a
adquirente aceita. Nos deeplinks o botão "Cancelar" some durante a transação:
quem cancela é o cliente, na tela da adquirente.

### O que cada uma pede, e o que falta

**PagBank** — nada mudou; ver "O que depende do PagBank".

**Stone** — fonte: <https://sdkandroid.stone.com.br/reference/pagamento-deeplink.md>.

- Ida: `payment-app://pay?return_scheme=firehubmaquininha&amount=<centavos>&transaction_type=…&installment_type=NONE&editable_amount=0`, com `FLAG_ACTIVITY_NEW_TASK`.
- Volta: `firehubmaquininha://pay-response?code=0&…` (code 0 = aprovado; senão `message`/`reason`/`response_code`). NSU = `atk`; ATK e ITK vão os dois em `idsDaAdquirente`.
- Falta: credenciamento como parceiro Stone, homologação do APK e POS Stone para teste — **o deeplink só funciona em POS Stone**.
- Conferir no terminal: (1) que `installment_type=NONE` sem `installment_count` não faz o app perguntar parcelas (a doc só aceita `installment_count` de 2 a 99, por isso ele não vai); (2) qual dos dois, ATK ou ITK, aparece no portal/extrato; (3) se o app da Stone devolve o deeplink para a ponte existente (`onNewIntent`) ou cria outra — o código aguenta os dois.
- `order_id` **não vai**: a doc exige número (até `Long.MAX`) e a função ligada no app de Ajustes do POS; o `pedidoId` do FireHub é texto opaco.
- Risco aceito: a volta da Stone não traz nenhum identificador nosso, então a única conferência de que a resposta é desta cobrança é o **valor**. Uma resposta atrasada de outra venda **com o mesmo valor** seria aceita. Só acontece se o app da Stone devolver uma venda depois de mais de 3 minutos *e* outra cobrança já estiver aberta.

**Cielo (Cielo Smart / LIO)** — fonte: manual de integração por deep link da Cielo LIO.

- Manifesto: `<meta-data android:name="cs_integration_type" android:value="uri"/>`; `minSdk 24` e `targetSdk 29` **só neste flavor**; WebView proibida (o app não tem).
- Ida: JSON em Base64 (`NO_WRAP`, codificado na query) em `lio://payment?request=…&urlCallback=firehubcielo://response`. Volta: `response` em Base64 com o pedido; aprovado = `payments[0]` (bandeira, `authCode`, `nsu`/`cieloCode`).
- **Credenciais por loja**: `clientId` e `accessToken` vêm do servidor no campo opcional `credenciaisCielo:{clientId, accessToken, email?}` da resposta do `pendente`. Sem eles a cobrança é **recusada antes de abrir qualquer tela**, com "A loja ainda não cadastrou as credenciais da Cielo". Nunca vão para log nem para disco. O nome do campo vem de `BuildConfig.CAMPO_DE_CREDENCIAIS`, preenchido só no flavor cielo — o APK do PagBank não leva a palavra "Cielo".
- Falta: cadastro no portal de desenvolvedores da Cielo (gera clientId/accessToken por estabelecimento), homologação do APK, POS Cielo Smart para teste.
- Conferir no terminal: (1) **unidade de `value`/`unitPrice`** — o app manda centavos; se a tela da Cielo mostrar o valor 100× maior, é em `CobradorCielo.montarSaida`; (2) o formato da resposta de cancelamento/erro (o app aceita `code`/`reason`/`message`/`status`; sem nada reconhecível é incerto); (3) se `email` vazio é aceito; (4) se voucher refeição recusa cartão alimentação.

**Getnet (Get Smart, Santander)** — a especificação oficial é fechada; o formato segue as duas integrações comunitárias em produção:
<https://github.com/CarvalhoWesley/getnet_payments> e
<https://github.com/ControleOnline/react-native-getnet-payment>.

- **As duas mandam os parâmetros como query string na URI**, não como extras do Bundle. O app segue as fontes (query) e repete os mesmos valores como extras, o que é inofensivo e cobre a variante antiga.
- Ida (`startActivityForResult`): `getnet://pagamento/v3/payment?paymentType=credit|debit|voucher|pix&amount=<12 dígitos em centavos>&callerId=<único>&installments=1&allowPrintCurrentTransaction=false&orderId=<o mesmo>`. O valor é montado do inteiro em centavos, sem passar por double (as libs fazem `amount * 100` em double).
- Volta (extras): `result` 0 aprovado / 1 negado / 2 cancelado / 3 falha / 4 desconhecido / 5 pendente; `nsu`, `cvNumber`, `authorizationCode`, `brand`, `cardLastDigits`, `installments`. 4, 5 e "voltou sem dados" são **incertos** e vão para o `checkstatus`.
- Falta: parceria Getnet (acesso à doc oficial e ao ambiente de homologação), homologação do APK, POS Getnet para teste.
- Conferir no terminal: (1) query vs. extras; (2) tamanho máximo do `callerId` (o app manda uns 20 alfanuméricos); (3) o que o `checkstatus` responde para um `callerId` que a Getnet não conhece (se for 2/3, o pedido volta para a fila; se for 4, vai para a lista de atenção depois de um minuto — o lado seguro); (4) se o `checkstatus` mostra tela.

### Simulador (testar sem maquininha)

`apps/maquininha/simulador` é um app separado
(`br.com.firehub.simuladoradquirente`) que registra os mesmos deeplinks
(`payment-app://pay`, `lio://payment`, `getnet://pagamento/v3/payment` e
`/v1/checkstatus`) e mostra **Aprovar / Recusar / Cancelar / Fechar sem
responder**, devolvendo exatamente o formato de cada adquirente. O "fechar sem
responder" testa o caminho que importa: a cobrança tem que ficar **incerta**,
nunca recusada. **Nunca instalar numa maquininha de verdade.**

```bash
./gradlew assembleStoneDebug :simulador:assembleDebug
adb install -r app/build/outputs/apk/stone/debug/app-stone-debug.apk
adb install -r simulador/build/outputs/apk/debug/simulador-debug.apk
```

Pareie o app com um código de teste, gere uma cobrança no painel e escolha a
forma: o simulador abre no lugar do app da Stone. **Ainda não foi rodado em
emulador** — nesta máquina não há emulador instalado (nem AVD).

### Do lado do servidor

- `GET pendente` recebe `&adquirente=PAGBANK|STONE|CIELO|GETNET`.
- Para terminal Cielo, mandar `credenciaisCielo:{clientId, accessToken, email?}` dentro de `cobranca` (o app também aceita na raiz da resposta, ao lado dela).
- `POST resultado` passa a trazer `adquirente` e, opcionalmente, `idsDaAdquirente` (objeto texto→texto). São campos a mais; o servidor pode ignorar.
- `pedidoId` é texto opaco no app: `"mesa:<id>"` com `descricao` "Mesa 5" funciona sem mudança (conferido: nada no app assume formato de id; os códigos de referência só usam os alfanuméricos dele).

## Modo garçom

O garçom tira o pedido da mesa e cobra **na própria maquininha**, sem celular.
Botão **Modo garçom** na tela de operação (só aparece com a maquininha parada).

Telas **nativas** (Views montadas por código em `tela/GarcomActivity.kt` +
`tela/Pecas.kt`). Nada de WebView: Cielo e PagBank reprovam app de maquininha
que abre página web. Compose ficou de fora pelo mesmo motivo de sempre: mais
dependência, APK maior e mais pergunta na homologação.

### Nenhuma API nova

São as mesmas rotas do garçom web (`/garcom/<slug>/mesas`), com a mesma
credencial:

| O quê | Rota |
|---|---|
| Entrar | `POST /api/garcom/login {slug, login, senha}` → cookie `__Secure-firehub_garcom` (Set-Cookie) |
| Quem sou / motivo do 401 | `GET /api/garcom/me` |
| Sair | `POST /api/garcom/logout` |
| Mesas (livre/ocupada/total) e taxa da loja | `GET /api/store/tables` |
| Abrir mesa livre | `POST /api/store/table-sessions {tableId}` |
| Conta (itens, taxa, total) | `GET /api/store/table-sessions/<id>/conta?taxa=<taxaServicoPadrao>` |
| Já pago | `GET /api/store/table-sessions/<id>/pagamentos` |
| Cardápio do salão | `GET /api/garcom/cardapio` |
| Lançar | `POST /api/store/table-sessions/<id>/add-order` |
| Cobrar / acompanhar / cancelar | `POST`, `GET`, `DELETE /api/store/table-sessions/<id>/maquininha` |

O cookie fica em `EncryptedSharedPreferences` (arquivo `cofre_do_garcom`,
separado do crachá da maquininha) e vai em toda chamada junto com
`x-operador: garcom` — o cabeçalho que obriga o servidor a usar SÓ o cookie do
garçom (`lib/garcom-auth.ts`). Qualquer 401 volta ao login; antes, o app
pergunta a `/api/garcom/me` o porquê (senha trocada, caixa fechado, acesso
desativado) e mostra.

O app descobre o próprio `terminalId` e o slug da loja pelo polling:
`GET /api/pos/terminal/pendente` passou a devolver `terminalId` e `lojaSlug`
em toda resposta 200 (com ou sem cobrança). Ficam no `CofreDoToken`. Sem o slug
(servidor antigo, ou antes da primeira volta) o login pede o final do link.

### O fluxo

1. **Login** — loja (do polling), usuário e senha do cadastro Garçons.
2. **Mesas** — grade de 3 por linha: número, livre ou total da conta. Mesa
   livre pergunta e abre a conta (como o web).
3. **Mesa** — itens lançados, consumo, taxa, total, já pago, **falta pagar**.
   Botões *Lançar itens* e *Cobrar*. Cobrança viva aparece no topo
   (acompanhar).
4. **Lançar** — categorias (na ordem da loja, com a aba transversal "Combos")
   → produtos → opções → carrinho → *Enviar para a cozinha*. Produto simples:
   toque soma 1 (como o web); toque longo abre quantidade e observação.
5. **Cobrar** — valor (padrão = falta pagar; atalhos Tudo, ÷2, ÷3), mínimo
   R$ 1,00. Manda `POST maquininha {valor, terminalId: <esta maquininha>}`.

### O cardápio e o corpo do add-order (o que foi portado)

`/api/garcom/cardapio` devolve a lista de produtos do salão com o preço do
canal já aplicado. O app filtra igual a `lib/cardapio-da-mesa.ts`: ativo,
`activeGarcom`, sem `esgotado`, fora do dia/horário (`foraDoCardapioAgora`),
espelho de integração, e complemento de combo (`apenasOpcaoDeCombo`, ou a
regra de reserva de `idsSoDeOpcaoDeCombo`).

Cada produto pode ter `comboGroups` (ou o `comboConfig` antigo):

```
{ id, title, maxQty, minQty (nulo = exige maxQty), priceRule (SOMA|MAIOR|MEDIA),
  items: [{ additionalPrice, adicionalDe?, maxPerItem?, optionNote?,
            precoPorEscolha? {"Grande": 15, "Pequena": null},
            menuProduct: { id, name, active } }] }
```

A tela de opções segue o `ComboModal.tsx`: grupo sem escolha possível já vem
marcado; item fixo do combo vai em "Vem no combo"; mínimo/máximo do grupo e
"Máx N" da opção; escolha única (max 1) é toque que marca/desmarca; opção que
outra escolha bloqueia (`precoPorEscolha: null`, a meia pizza na Pequena) some e
é desmarcada; pergunta que depende de outra (a borda que espera o tamanho)
fica escondida; "Meio a meio?" nunca espera. O preço é o de
`lib/preco-combo.ts` (`precoDaOpcao` por escolha, SOMA / mais caro / média),
portado em `garcom/Cardapio.kt`.

O corpo é o MESMO do MesasApp:

```json
{ "items": [ { "menuProductId": "…", "quantity": 2, "price": 54.9,
               "comboSelections": "[{\"name\":\"Calabresa\",\"quantity\":1}]",
               "tableGuestId": null, "notes": "sem cebola" } ] }
```

`comboSelections` é a lista `[{name, quantity}]` **em texto** (o MesasApp
achata o `{grupoId: {nome: qtd}}` do modal assim). O `price` vai por
compatibilidade: `lib/lancar-na-mesa.ts` recalcula tudo pelo canal salão. A
tela mostra um "total estimado" e, depois de enviar, o `order.totalAmount` que
o servidor devolveu.

### A cobrança: um caminho só

O modo garçom **não cobra**. Ele põe a cobrança na fila do servidor endereçada
a esta maquininha e acorda o serviço (`ServicoDeCobranca.acordar`, que também
reinicia a escada do polling). O serviço pega na próxima volta e cobra pelo
caminho de sempre — fila em disco, marcador, recuperação, tudo igual ao totem.
A tela acompanha pelo `GET maquininha` de 2 em 2 s até `PAGO`, `RECUSADO`,
`CANCELADO` ou `EXPIRADO`; aprovado volta sozinho para a mesa, recusado oferece
*Tentar de novo* (recusa de mesa não volta para a fila sozinha). Enquanto a
maquininha não pegou (`AGUARDANDO_TERMINAL`) dá para cancelar daqui.

A rota recusa cobrança para maquininha calada há mais de 2 min
(`TERMINAL_OFFLINE`) — no chip, com a loja parada, o polling chega a 3 min.
Por isso a tela de cobrar acorda o serviço ao abrir, e se mesmo assim vier
`TERMINAL_OFFLINE` ela acorda de novo, espera 4 s e tenta uma vez.

### Totem tem prioridade, e a tela do garçom não se perde

O servidor entrega o pedido do totem antes da cobrança de mesa. Quando
qualquer cobrança chega, o serviço traz a `OperacaoActivity` para a frente como
sempre. A `GarcomActivity` mora numa **task própria** (`taskAffinity` no
manifesto): sem isso o `singleTask` da tela de operação destruiria o pedido que
o garçom estava montando. `garcom/ModoGarcom.kt` guarda o recado
"devolver ao garçom": quando a tela de operação volta a "aguardando" depois de
mostrar uma cobrança, ela reabre o modo garçom, que recarrega a tela em que
estava (o carrinho fica em memória).

### O que ficou de fora

- **Permissões do garçom**: `/api/garcom/me` hoje só devolve id, nome e
  comissão. O app lê `podeFecharConta` se um dia vier (o botão Cobrar vira
  "Cobrança só pelo caixa"); até lá quem barra é o servidor, com 403 e a
  mensagem dele.
- Divisão por pessoa (`tableGuestId`), desconto, taxa editável, gorjeta,
  pagamento em dinheiro e fechar a mesa: continuam no garçom web e no caixa. O
  "falta pagar" usa a taxa padrão da loja.
- Busca por nome no cardápio e foto do produto.
- Editar um item já no carrinho (dá para mudar a quantidade ou remover e
  lançar de novo).

### Não testado

Compila nos quatro flavors, mas **não rodou em aparelho nem emulador**. Conferir
na mão: login (cookie `__Secure-`), abrir mesa, combo com meio a meio e borda,
pizza com tamanho que bloqueia meia, envio, cobrança na própria maquininha
(Wi-Fi e chip), pedido do totem chegando com o garçom no meio do carrinho, e a
volta para o garçom depois do aprovado/recusado.

## Mapa dos arquivos

```
app/src/main/java/br/com/firehub/maquininha/      comum às quatro adquirentes
├── Ajustes.kt                    números e endereços num lugar só
├── AplicacaoDaMaquininha.kt      guarda o Context do processo para o cobrador
├── CofreDoToken.kt               o token de 64 caracteres, no Keystore
├── TrabalhoDeTela.kt             tira as telas da thread principal
├── rede/
│   ├── Modelos.kt                Cobranca, ResultadoDeCobranca, respostas
│   └── ApiDoFireHub.kt           as duas chamadas HTTP, sem biblioteca
├── fila/
│   └── FilaDeResultados.kt       o caderninho: pendentes, travados, marcador
├── pagamento/
│   └── CobradorDaAdquirente.kt   o contrato: cobrar, conferir, impedimento
├── servico/
│   ├── ServicoDeCobranca.kt      o laço, em primeiro plano
│   ├── RitmoDoPolling.kt         a escada adaptativa
│   └── ReceptorDeBoot.kt         volta a funcionar depois de reiniciar
├── estado/
│   └── EstadoDoTerminal.kt       ponte entre a thread do serviço e a tela
├── garcom/                      modo garçom (ver "Modo garçom")
│   ├── ApiDoGarcom.kt            rotas do garçom web, cookie + x-operador
│   ├── CofreDoGarcom.kt          o cookie do garçom, no Keystore
│   ├── Cardapio.kt               filtro do cardápio e preço das opções (porte do web)
│   ├── Dinheiro.kt               reais <-> centavos, R$ formatado
│   └── ModoGarcom.kt             recado "devolver ao garçom" depois da cobrança
└── tela/
    ├── PareamentoActivity.kt
    ├── OperacaoActivity.kt
    ├── GarcomActivity.kt         as telas do modo garçom (task própria)
    └── Pecas.kt                  botões, cartões e campos montados por código

app/src/pagbank/      só no APK do PagBank (único com o SDK PlugPag)
├── AndroidManifest.xml           MANAGE_PAYMENTS, <queries>, ativação, filtro PAYMENT
├── java/.../pagamento/Adquirente.kt
├── java/.../pagamento/PagamentoNaMaquininha.kt  o ÚNICO arquivo que toca o SDK
├── java/.../tela/AtivacaoActivity.kt
└── res/                          tela de ativação e textos que citam o PagBank

app/src/deeplink/java/.../pagamento/ponte/        Stone, Cielo e Getnet
├── CanalDaPonte.kt               a espera bloqueante (latch) entre serviço e ponte
├── PonteDaAdquirenteActivity.kt  Activity transparente que abre o app da adquirente
└── CobradorPorDeeplink.kt        a regra de dinheiro comum aos três

app/src/stone|cielo|getnet/
├── AndroidManifest.xml           <queries> e o intent-filter da volta
├── java/.../pagamento/Adquirente.kt
├── java/.../pagamento/Cobrador<Adquirente>.kt   monta a ida, lê a volta
└── res/values/adquirente.xml     textos que citam a adquirente

simulador/                        app separado que finge ser Stone/Cielo/Getnet
```

### Por que tudo numa thread só

Comentário do app-demo oficial do PagBank, literal:

> "Operações de pagamento, ativações e outras operações são BLOCANTES e não
> permitem outras operações em paralelo. Caso seja chamado outra operação
> enquanto uma BLOCANTE esta rodando sera retornado os Erros SV03 ou PP1047."

O serviço roda um laço sequencial numa thread de trabalho. Isso torna
impossível, por construção, perguntar por cobrança nova enquanto um cartão está
sendo passado. `PagamentoNaMaquininha` ainda põe um cadeado em volta de tudo
(para que uma tela não atropele o laço) e estoura de propósito se alguém chamar
o SDK da thread principal — melhor um erro na primeira execução do que uma tela
congelada com o cliente na frente.

A única exceção é `abort()`, que precisa rodar **enquanto** o `doPayment` está
bloqueado e por isso não pega o cadeado. Vale lembrar: `abort()` não encerra a
chamada anterior. O `doPayment` continua bloqueado e vai retornar do jeito dele
— e é sempre ele quem registra o resultado.

## Dependências

Quatro, e é de propósito: cada SDK de terceiro a mais é uma pergunta a mais na
análise de homologação.

- `br.com.uol.pagseguro.plugpagservice.wrapper:wrapper:1.35.0` — o SDK, **só
  no flavor pagbank** (`pagbankImplementation`). Stone, Cielo e Getnet não
  levam SDK nenhum: falam com o app da adquirente por Intent.
- `androidx.appcompat:appcompat` — as Activities
- `androidx.core:core-ktx` — notificação e serviço em primeiro plano
- `androidx.security:security-crypto:1.0.0` — o cofre do token

Sem OkHttp, sem Retrofit, sem Gson, sem coroutines. `HttpURLConnection`,
`org.json` e threads comuns já vêm no Android e dão conta de duas rotas.
