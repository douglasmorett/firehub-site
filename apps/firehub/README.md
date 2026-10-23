# App FireHub (loja, garçom e tablet da mesa)

Um app só, três entradas (escolhidas na primeira abertura, `src/app/index.tsx`):

| Modo | Abre | O que o app acrescenta ao site |
|---|---|---|
| **Sou a loja** (`loja.tsx`) | `/store/pedidos-clientes` | aviso de pedido novo com o celular bloqueado (campainha própria) e impressora térmica Bluetooth |
| **Sou garçom** (`garcom.tsx`) | `/garcom/<loja>` (tablet) ou `?tela=celular` | tela sempre acesa; abre direto pelo link do garçom |
| **Tablet da mesa** (`mesa.tsx`) | `/tablet` | tela cheia, sempre acesa, sem Voltar; 7 toques no canto de cima à esquerda para sair |

Tudo que é tela é o SITE (WebView): mudou no site, mudou no app, sem atualizar.

## Servidor (já no site, mesma branch)

- `POST /api/app-firehub/sessao`: o painel aberto no app pede o token do app com o cookie do login (`components/Painel.tsx`, ponte `SESSAO_DO_APP`).
- `POST|DELETE /api/app-firehub/aparelho`: registra o celular para o aviso (tabela `LojaAparelho`).
- Aviso: `src/lib/app-firehub/aviso-de-pedido.ts`, chamado pelo gatilho do `prisma.ts` (todo pedido, todo canal; um aviso por pedido).
- Impressão: `GET|POST /api/app-firehub/impressao` — a fila do Assistente, com os papéis já em ESC/POS (o `buildEscPos` do Assistente, gerado por `scripts/gerar-comanda-do-celular.mjs`).

## Impressora Bluetooth

Módulo nativo local em `modules/impressora-bluetooth` (Kotlin, Bluetooth clássico/SPP — a térmica comum de 58/80 mm). O celular puxa a fila a cada 4 s **com o app aberto** (a tela fica acesa sozinha) e confirma cada trabalho só depois de todos os papéis saírem. Onde há PC com o Assistente, o PC continua dono das impressoras dele (`lib/dono-da-impressora.ts`) — o celular imprime o que não tem dono.

**iPhone não imprime**: o iOS não libera Bluetooth clássico para apps (só acessório MFi). No iPhone o aviso de pedido funciona.

## Montar

```bash
cd apps/firehub
npm ci
npx expo prebuild --platform android      # gera android/ (fora do git)
cd android && ./gradlew assembleRelease   # APK em android/app/build/outputs/apk/release
```

O Gradle padrão do prebuild (2 GB, Metaspace 512 MB) estoura com `OutOfMemoryError: Metaspace`. Antes do `assembleRelease`, em `android/gradle.properties`: `org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m`. Para teste rápido, `-PreactNativeArchitectures=arm64-v8a` (APK de 48 MB, 3 min).

Ou na nuvem: `eas init` (uma vez, cria o projeto no Expo) → `eas build -p android --profile preview`.

## Antes de publicar (pendente)

1. `eas init` + `eas update:configure` (atualização pelo ar, como no app do entregador).
2. Firebase: app Android `br.com.firehub.app` no projeto `firehub-entregador` → `google-services.json` (variável de arquivo `GOOGLE_SERVICES_JSON` no EAS) e a chave FCM V1 ligada ao projeto novo no Expo. Sem isso, o Android não recebe o aviso.
3. Apple: bundle `br.com.firehub.app` com Push; criar o app no App Store Connect (só pelo site).
4. Verificação dos links: `assetlinks.json` / `apple-app-site-association` no site com o pacote novo (para o link do garçom abrir direto no app).
5. Ao publicar, preencher `APP_FIREHUB_ANDROID` / `APP_FIREHUB_IPHONE` em `src/components/customer/LinksDoAppFireHub.tsx` no site.
