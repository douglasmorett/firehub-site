# FireHub Entregador

O app do motoboy para iPhone e Android, feito em Expo (SDK 57, React Native 0.86).
Ele faz o mesmo que a página `/loja/[slug]/motoboy`, mais as duas coisas que uma
página no navegador não consegue fazer:

- **Manda o GPS com a tela apagada e com o Maps aberto.** No Android, isso é um
  serviço em primeiro plano, com a notificação fixa "Você está trabalhando". No
  iPhone, é a atualização em segundo plano, com o indicador azul no topo da tela.
  Nos dois, basta a permissão de localização "durante o uso".
- **Avisa pedido novo com o celular no bolso.** O aviso sai quando a loja
  atribui o pedido, monta ou despacha a rota, troca o entregador, e também
  quando cancela um pedido que estava com ele.

| Pacote | `br.com.firehub.entregador` (Android e iOS) |
|---|---|
| Servidor | `https://firehubfood.com.br`. Para testar contra outro servidor: `EXPO_PUBLIC_API_URL=http://192.168.0.10:3001 npx expo start` |
| Login | Loja, telefone (ou nome) e senha. É o mesmo login da página web (`/api/motoboys/login`) |

## Como o app fala com o site

Toda chamada leva a sessão assinada (`Authorization: Bearer`, gerada por
`src/lib/motoboy-sessao.ts` no site). É dela que o servidor tira o entregador e
a loja; o corpo da requisição nunca diz quem é o entregador.

| O que o app faz | Rota |
|---|---|
| Entrar / trocar a senha | `POST` e `PATCH /api/motoboys/login` |
| Lista de entregas | `GET /api/motoboys/orders?formato=app` |
| Dar baixa (com código do iFood/99 e forma de pagamento) | `PATCH /api/motoboys/orders` |
| Puxar pela comanda / devolver | `POST` e `DELETE /api/motoboys/orders` |
| GPS | `POST /api/motoboys/location` |
| Relatório | `GET /api/motoboys/relatorio` |
| Registrar o celular para avisos | `POST` e `DELETE /api/app-motoboy/aparelho` |

O app **não tem regra de negócio**. Quem decide quanto cobrar na porta, quais
bebidas conferir, se o pedido pede o código do iFood e qual endereço vai para o
mapa é o servidor (`src/lib/app-motoboy/pedido-no-app.ts`). O motivo: uma versão
instalada fica meses no bolso do entregador, e uma regra corrigida no servidor
vale na hora para todo mundo.

## Rodar no computador

```bash
npm install
npx expo start          # precisa de um "development build" instalado no celular
npx tsc --noEmit        # tipos
npx expo lint           # lint (regras do React Compiler)
npx expo-doctor         # dependências e configuração
```

O Expo Go **não serve** para este app, porque ele não tem GPS em segundo plano
nem avisos. Use um development build (`eas build --profile development`).

## Gerar os instaláveis

**Pelo EAS (nuvem)**, recomendado e único caminho para o iPhone sem Mac:

```bash
npx eas-cli@latest login
npx eas-cli@latest init                                       # cria o projeto e grava o projectId no app.json
npx eas-cli@latest build -p android --profile preview         # APK para instalar direto
npx eas-cli@latest build -p ios --profile production          # pede o login da Apple Developer
npx eas-cli@latest submit -p ios                              # manda para o TestFlight
```

**APK local (Android)**, sem precisar de conta:

```bash
npx expo prebuild --platform android
# o padrão do template (2 GB, Metaspace 512 MB) estoura com OutOfMemoryError: Metaspace
sed -i 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m/' android/gradle.properties
cd android && ./gradlew assembleRelease
# sai em android/app/build/outputs/apk/release/app-release.apk
```

A primeira vez baixa o NDK e as plataformas do SDK que faltarem (precisa ter as
licenças aceitas em `Android/Sdk/licenses`) e leva uns 20 a 30 minutos. O APK
local é assinado com a chave de debug: serve para testar no celular, não para
a Play. O APK da Play sai do EAS, com a chave guardada lá.

As pastas `android/` e `ios/` são geradas pelo prebuild e **não vão para o
git**. Configuração nativa (permissões, ícones, plugins) se muda no `app.json`.

## Antes de publicar

1. **Avisos no Android**: crie um projeto no Firebase, adicione o app
   `br.com.firehub.entregador`, baixe o `google-services.json`, coloque na raiz
   deste app, aponte `android.googleServicesFile` no `app.json`, e suba a chave
   FCM V1 no EAS (`eas credentials`). Sem isso, o app funciona, mas o Android não
   recebe o aviso de pedido novo.
2. **Avisos no iPhone**: o `eas build` cria a chave APNs sozinho no login da Apple.
3. **Play Console**: o app pede `FOREGROUND_SERVICE_LOCATION`. O formulário de
   serviço em primeiro plano pede um vídeo curto mostrando o rastreio durante a
   entrega. Ele **não** pede localização em segundo plano
   (`ACCESS_BACKGROUND_LOCATION` está bloqueada no `app.json`).
4. **App Store**: na revisão, explique que a localização é mostrada para a loja
   durante o expediente do entregador, e que existe o botão de pausar. Conta de
   teste: um entregador de uma loja de demonstração.
5. **Privacidade**: o app aponta para `https://firehubfood.com.br/privacidade`.
   A conta do entregador é criada pela loja, não dentro do app. Por isso não
   precisa de "excluir conta" no app; a tela Conta diz para falar com a loja.
