# FireAccess em tudo: Windows, Mac, Android (totem) e iPad

Douglas, 20/11/2026: "eu só queria ter 1 ferramenta só de acesso a tudo" e "nós somos desenvolvedores Apple e Android".
Ler junto com `PLANO.md` (as 7 regras de segurança continuam contrato) e `CLAUDE.md`.

## Meta

Uma ferramenta só: **um relay, uma página ao vivo, uma CLI**. O que muda por sistema é o programa pequeno (agente) no aparelho do cliente. Hoje só o do Windows existe (`agente/`, Electron, 254 linhas em `main.js`).

## O que cada sistema permite (limite de plataforma, não de esforço)

| Sistema | Ver a tela | Controlar (toque/clique/tecla) | Executar comando | Enviar arquivo |
|---|---|---|---|---|
| Windows | sim (feito) | sim (feito) | PowerShell (feito) | sim (feito) |
| Mac | sim | sim, com 2 permissões do cliente | shell | sim |
| Android (totem, tablet, celular) | sim, o cliente aceita a captura a cada sessão | sim, com o serviço de acessibilidade ligado uma vez | não | pelo app, só dentro dele |
| iPad / iPhone | sim, transmissão da tela escolhida pelo cliente | **não** (a Apple não permite) | não | não |

No iPad o atendente vê a tela e guia a pessoa por voz ou texto. Isso precisa ser dito ao lojista antes.

## Arquitetura

- **Mesmo relay** (`relay/server.mjs`) e mesma página (`relay/ver.html`).
- **Handshake novo:** o agente informa `plataforma` ("windows" | "mac" | "android" | "ios") e `capacidades` (lista: `tela`, `clicar`, `digitar`, `tecla`, `rolar`, `executar`, `enviar`, `tocar`, `deslizar`, `voltar`, `inicio`). O relay recusa comando que o agente não declarou, com mensagem clara. Agente antigo sem esses campos = Windows com as capacidades da v0.2.
- **CLI** (`cli/fireaccess.mjs`): `sessoes` mostra a plataforma; comandos de toque do Android entram como `tocar x y`, `deslizar x1 y1 x2 y2`, `voltar`, `inicio`.
- **Segurança por plataforma** (as 7 regras do `PLANO.md` valem em todas):
  - Mac: o cliente abre o app e clica em Permitir a cada sessão; faixa vermelha no topo; fechar o app corta tudo.
  - Android: a captura de tela exige aceitar o diálogo do sistema a cada sessão; notificação fixa "Suporte FireHub conectado" com botão Encerrar; código de 6 dígitos de 10 min como no Windows.
  - iOS: o seletor de transmissão do próprio iOS (o cliente escolhe e para quando quiser).

## Fases (cada uma só vale com a verificação feita)

### Fase 0: preparar o código (1 dia)
- Separar no agente o que é do sistema: entrada (mouse/teclado), `executar`, pasta de destino do `enviar`, elevação. Hoje é `entrada.js` + `entrada.ps1` e `main.js` chamando `powershell.exe`.
- Handshake com `plataforma` e `capacidades`; relay e CLI lendo isso.
- **Verificar:** repetir o teste da v0.2 no Windows (Bloco de Notas, digitar com acento, Ctrl+S, `executar`, `enviar`, queda de rede de 90 s). Nada pode regredir.

### Fase 1: Mac (2 a 3 dias, precisa de um Mac para testar)
- **Controle sem dependência extra:** `osascript -l JavaScript` com `ObjC.import('CoreGraphics')` para mover o mouse, clicar, rolar e digitar (CGEvent). Não usar `cliclick` nem Xcode no cliente. Plano B: módulo nativo (nut-js) construído no CI.
- **Permissões:** tela de ajuda dentro do app para "Gravação de tela" e "Acessibilidade" (abrir direto o painel do sistema); o app só diz "pronto para Permitir" depois que as duas estiverem liberadas.
- **Build:** `electron-builder --mac dmg` para arm64 e x64, em máquina Mac do GitHub Actions (workflow `fireaccess-mac.yml`, só dispara por tag ou manualmente).
- **Assinatura e notarização:** a conta de desenvolvedor da Apple já existe. Diferente do Windows (onde a decisão foi não assinar), no Mac é recomendado assinar e notarizar: sem isso o Gatekeeper bloqueia mais. Certificado e senha entram só como segredo do GitHub, nunca no repositório. Precisa do Douglas fornecer isso.
- **Distribuição:** `public/downloads/FireAccess.dmg`; página `src/app/fireaccess/page.tsx` detecta o sistema e mostra o botão certo com o passo a passo do Mac (arrastar para Aplicativos, abrir, liberar as duas permissões).
- **Verificar (num Mac real):** abrir o TextEdit, digitar com acento, salvar, `executar "sw_vers"`, `enviar` de um arquivo, Encerrar fecha tudo.

### Fase 2: Android, totem incluso (5 a 8 dias, precisa de aparelho Android real)
- **Projeto:** app próprio e pequeno "FireAccess" (pacote `br.com.firehub.fireaccess`), separado do app da loja, para não misturar permissão sensível com o app comum. Se preferir dentro do app existente, dá, mas pior para a revisão da Play.
- **Captura:** MediaProjection com serviço em primeiro plano (aceite do cliente a cada sessão).
- **Toque e teclado:** AccessibilityService com `dispatchGesture` (toque, deslize) e entrada de texto no campo em foco; ações globais voltar e início. O cliente liga a acessibilidade uma vez.
- **Conexão:** o mesmo WebSocket do relay, com o mesmo código de 6 dígitos e a mesma retomada de 90 s.
- **Totem sem ninguém ao lado:** fica como etapa à parte. Dá para o aparelho que a FireHub entrega configurado ter permissão fixa (provisionamento como dono do dispositivo, por ADB), mas isso muda a regra "só com o cliente presente" e precisa de decisão do Douglas.
- **Play Store:** a captura e a acessibilidade passam por revisão com declaração de uso; começar por teste interno e por instalação direta (APK) nos totens.
- **Verificar:** num totem Android real e num celular: ver a tela, `tocar`, `deslizar`, digitar num campo, `voltar`, Encerrar pela notificação.

### Fase 3: iPad e iPhone (3 a 5 dias, só ver e guiar)
- App iOS com extensão de transmissão de tela (ReplayKit Broadcast Upload Extension) mandando quadros para o relay.
- Sem controle, e a página mostra isso ("somente visualização").
- Distribuição por TestFlight no começo.
- **Verificar:** iPad real: o cliente inicia a transmissão pelo seletor do sistema e o atendente vê a tela no `/fireaccess`; parar a transmissão corta o acesso.

### Fase 4: totem sem tela remota (2 dias, independe das outras)
- Canal de comando pelo painel para o totem (recarregar, ver erro e versão, limpar cache), usando o `lastHeartbeat` que o totem já manda. Resolve boa parte do suporte do totem sem controlar a tela.

## Ordem recomendada
Fase 0 → Fase 1 (Mac, mais barata) e Fase 4 em paralelo → Fase 2 (Android) → Fase 3 (iPad).
Se a prioridade for o totem, trocar a ordem: 0 → 4 → 2.

## O que cada fase precisa do Douglas
- Fase 1: certificado da Apple (Developer ID) e a senha dele, como segredos do GitHub, e um Mac para o teste final.
- Fase 2: um totem ou celular Android para teste e decisão sobre o totem sem ninguém ao lado (permissão fixa).
- Fase 3: um iPad e o acesso ao App Store Connect para o TestFlight.
- Qualquer deploy do relay (mudança de protocolo) é **Deploy manual** do app `fireaccess-relay` no Coolify; o push no master não publica o relay.

## Riscos
- Mac sem assinatura: o sistema bloqueia e o cliente não consegue abrir. Por isso assinar.
- Android: revisão da Play para captura de tela e acessibilidade; começar pelo APK direto nos totens.
- iOS: não há controle; não prometer.
- Nunca digitar senha do cliente, em nenhuma plataforma (regra 4).
