# FireHub Maquininha

App Android nativo que roda **dentro** de uma maquininha PagBank Smart POS e
cobra os pedidos que o cliente fecha no totem de autoatendimento.

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
2. **Ativação do terminal** — só aparece se o terminal ainda não estiver ativado
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
./gradlew assembleDebug     # APK de teste
./gradlew assembleRelease   # APK para homologação
```

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
adb install -r app/build/outputs/apk/release/app-release.apk
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
  nem em ícone, nem em comentário que apareça na tela. Por isso `TipoDePagamento`
  tem exatamente três valores.
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

## Mapa dos arquivos

```
app/src/main/java/br/com/firehub/maquininha/
├── Ajustes.kt                    números e endereços num lugar só
├── AplicacaoDaMaquininha.kt      guarda o Context do processo para o SDK
├── CofreDoToken.kt               o token de 64 caracteres, no Keystore
├── TrabalhoDeTela.kt             tira as telas da thread principal
├── rede/
│   ├── Modelos.kt                Cobranca, ResultadoDeCobranca, respostas
│   └── ApiDoFireHub.kt           as duas chamadas HTTP, sem biblioteca
├── fila/
│   └── FilaDeResultados.kt       o caderninho: pendentes, travados, marcador
├── pagamento/
│   └── PagamentoNaMaquininha.kt  o ÚNICO arquivo que toca o SDK do PagBank
├── servico/
│   ├── ServicoDeCobranca.kt      o laço, em primeiro plano
│   ├── RitmoDoPolling.kt         a escada adaptativa
│   └── ReceptorDeBoot.kt         volta a funcionar depois de reiniciar
├── estado/
│   └── EstadoDoTerminal.kt       ponte entre a thread do serviço e a tela
└── tela/
    ├── PareamentoActivity.kt
    ├── AtivacaoActivity.kt
    └── OperacaoActivity.kt
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

- `br.com.uol.pagseguro.plugpagservice.wrapper:wrapper:1.35.0` — o SDK
- `androidx.appcompat:appcompat` — as Activities
- `androidx.core:core-ktx` — notificação e serviço em primeiro plano
- `androidx.security:security-crypto:1.0.0` — o cofre do token

Sem OkHttp, sem Retrofit, sem Gson, sem coroutines. `HttpURLConnection`,
`org.json` e threads comuns já vêm no Android e dão conta de duas rotas.
