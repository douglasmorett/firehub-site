# FireAccess — acesso remoto próprio do FireHub

Criado em 19/11/2026 a pedido do Douglas.

## O que é

Programa nosso para o lojista baixar, abrir e **permitir** que o suporte do FireHub controle o computador dele.
Quem controla é o Claude (o atendente), conversando com o lojista pelo WhatsApp ao mesmo tempo.
O Douglas acompanha a tela do cliente ao vivo e pode assumir quando quiser.

Uso principal: instalar impressora e o Assistente, ligar iFood/99/Keeta, fazer a implantação da loja nova
e resolver o "Desconectado" do Assistente. O lojista só precisa ficar ao lado do computador.

**A dor de hoje:** o AnyDesk não está funcionando, então a regra atual é "impressora se ensina, não se acessa".
O lojista trava no passo a passo e a implantação demora.

## Por que não usar AnyDesk/RustDesk/MeshCentral

O essencial é **o Claude conseguir controlar por comando**: pedir a tela, clicar em (x, y), digitar e apertar tecla,
do mesmo jeito que controla o Chrome do Douglas hoje. Nenhum dos três oferece isso de forma simples.
- **RustDesk:** licença AGPL e nenhuma API de controle.
- **MeshCentral** (Apache 2.0): só daria para controlar pela tela do navegador. Fica como plano B rápido, se o próprio atrasar.

Um agente nosso é pequeno: captura a tela, recebe clique e tecla e fala com um servidor nosso por WebSocket.

## Como funciona (resumo)

```
 PC do lojista                       servidor (Coolify)                  nós
 ┌──────────────┐  WebSocket de     ┌────────────────┐   HTTPS/WS     ┌───────────────────────┐
 │ FireAccess.exe    │──saída (sem abrir │ fireaccess-relay    │◄──────────────►│ Claude: CLI/MCP fireaccess │
 │ código 6 díg.│  porta, passa NAT)│ sessões + log  │                │ Douglas: /fireaccess ao    │
 │ faixa vermelha│◄────────────────►│                │                │ vivo + "assumir"      │
 └──────────────┘                   └────────────────┘                └───────────────────────┘
```

- **Agente (Windows):** Electron, igual ao Assistente, para aproveitar o build e o instalador que já conhecemos.
  - É um .exe portátil, sem instalação.
  - Abre mostrando o código e o botão **"Permitir suporte FireHub"**.
  - Captura a tela pelo `desktopCapturer` e envia clique e teclado por módulo nativo (nut-js ou equivalente).
- **Relay:** serviço Node separado do site no Coolify. Com vários processos, o site não segura WebSocket.
  - Guarda a sessão e repassa os comandos.
  - Grava o log de cada comando, com a tela de antes e de depois.
- **Claude:** usa a CLI `fireaccess` (`tela`, `clicar x y`, `digitar "…"`, `tecla ctrl+v`, `rolar`). Depois vira um MCP.
- **Douglas:** acompanha pela página `/fireaccess` (tela ao vivo, 3 a 5 quadros por segundo), com lista de sessões, botão **Assumir** e o log.

## Regras de segurança (contrato — não negociar)

1. **Só com o cliente presente e aceitando.**
   - O cliente abre o programa e clica em Permitir a cada sessão.
   - O código vale 10 minutos.
   - Não existe acesso sem ele presente, serviço do Windows, nem início junto com o Windows.
2. **Sempre visível.**
   - Uma faixa vermelha fica no topo da tela o tempo todo, com o texto "Suporte FireHub conectado" e o botão **Encerrar**.
   - Fechar o programa corta o acesso na hora.
3. **Conexão só de saída**, criptografada (WSS). O PC do cliente não abre porta.
4. **Senha quem digita é o cliente.** Isso vale para o iFood, a 99, o banco e o Windows. Quando aparece campo de senha, o Claude para e pede.
5. **Tudo registrado:** cada comando, com hora e tela, fica guardado para auditoria.
6. **Só a equipe do FireHub entra** no relay e no /fireaccess, com token de admin. Lojista nunca vê sessão de outro.
7. **Termo curto** aceito no primeiro uso, por conta da LGPD (acesso à tela e aos dados).

## Limites conhecidos (falar antes ao lojista)

- **Janela "Deseja permitir que este app faça alterações?" (UAC):** o Windows a mostra numa tela protegida, e nenhum acesso remoto sem serviço clica nela.
  - Desde a v0.2 o FireAccess já abre como administrador (o cliente diz **Sim** uma vez, na abertura). O que o atendente abre por `abrir`/`executar` nasce administrador e **não mostra UAC**.
  - Instalador: rodar por `abrir <codigo> "C:\...\setup.exe"`, nunca por duplo clique no Explorer (o Explorer não é administrador e o UAC volta).
  - Se ainda assim aparecer (cliente não é administrador, selo "SEM administrador"), quem clica em **Sim** é o cliente: "vai aparecer uma janela, clica em Sim".
- **Segunda tela:** o FireAccess vê só a tela principal (o `info` lista as telas). Janela que abriu na outra tela: `tecla <codigo> win+shift+left` traz para a principal.
- **Antivírus e SmartScreen:** um programa que controla mouse e teclado sem assinatura digital tende a ser bloqueado. Sem assinatura, o cliente passa pelo aviso do Windows, como já faz com o Assistente. O atendente ensina o caminho (ver Decisões).
- **Só Windows** no começo. Mac fica para depois, se aparecer demanda.

## Fases

| Fase | Entrega | Como verificar |
|---|---|---|
| **0. Decisões** | Feitas em 19/11 (abaixo) | — |
| **1. Prova** (2–3 dias) | Agente portátil (código, Permitir, faixa, tela, clique e digitação), relay no Coolify e CLI `fireaccess` | O Claude abre o Bloco de Notas, digita e salva num PC de teste (VM), comandado da sessão do Claude Code |
| **2. Ao vivo** | Página `/fireaccess` para o Douglas (tela ao vivo, Assumir, log) e MCP `fireaccess` | O Douglas vê o Claude mexendo e assume no meio |
| **3. Atendimento** | Link `firehubfood.com.br/fireaccess`, mensagem pronta, regras novas na memória, termo e gravação | Instalar o Assistente e uma impressora num PC real, do zero, pelo WhatsApp |
| **4. Sem download** | Botão "Permitir suporte" dentro do Assistente de Impressão (quem já tem não baixa nada) | O lojista com o Assistente abre a sessão em 1 clique |

## Decisões (19/11/2026)

O Douglas definiu que é **ferramenta interna da equipe, não produto**: o AnyDesk foi só a referência. Ele mandou o Claude decidir o resto.
- **Nome:** FireAccess.
- **Relay:** no mesmo servidor do Coolify (custo zero). Subir para lá só com comando do Douglas.
- **Gravação:** 30 dias, apagando sozinha depois.
- **Certificado de assinatura:** NÃO assinar (Douglas, 19/11). O atendente ensina o cliente a passar pelo aviso do Windows igual se faz com o Assistente: "O Windows protegeu o computador" › **Mais informações** › **Executar assim mesmo**. Se o antivírus apagar o arquivo, ensina a liberar no Windows Defender (Proteção contra vírus › Histórico de proteção › Permitir).

## Estado (19/11/2026, noite)

**Fase 1 feita e testada no PC do Douglas** (relay local, sem subir nada):
- Comando antes do Permitir é recusado; token errado é recusado.
- Pela CLI: tela, Win+R, clique no Bloco de Notas, digitação com acento, Ctrl+S, salvou o arquivo certo.
- Encerrar fecha o agente na hora; registro em `registros/AAAA-MM-DD.jsonl` + JPG de cada ação.
- **Fase 2 em parte:** `/fireaccess` lista a sessão e mostra ao vivo (~2,4 quadros/s, ~100 KB por quadro). O MCP ficou de fora; a CLI resolve.
- `agente/dist/FireAccess.exe` (69 MB, portátil, sem assinatura) testado: conecta, Permitir, tecla, Encerrar.

**Peças:**
- `relay/` (server.mjs, ver.html, Dockerfile)
- `agente/` (main.js, entrada.js + entrada.ps1 = SendInput, janela/faixa)
- `cli/fireaccess.mjs`

**Teste no mesmo PC:** cada comando que o Claude roda abre um processo que tira o foco da janela. Por isso: clicar antes de digitar, ou mandar a sequência num script só. No PC do cliente isso não acontece.

**No ar (Douglas mandou subir, 19/11):** o projeto mora no repositório do site, em `fireaccess/`.
- **Relay:** app `fireaccess-relay` no Coolify, mesmo repositório, base `fireaccess/relay`, Dockerfile.
  - Domínio por caminho: `https://firehubfood.com.br/fireaccess-relay`, porta 8790 (sem DNS novo; o relay aceita com e sem o prefixo).
  - Volume `/dados`.
  - Variável `FIREACCESS_TOKEN`, só de runtime. A cópia local fica em `~/.fireaccess-token`.
- **Página do Douglas:** `https://firehubfood.com.br/fireaccess-relay/`.
- **CLI:** `node fireaccess/cli/fireaccess.mjs sessoes` (já usa o relay no ar e `~/.fireaccess-token`).
- **Lojista:** `https://firehubfood.com.br/fireaccess` (página `src/app/fireaccess`) → `/downloads/FireAccess.exe`.
- **Gerar o .exe de novo:** em `fireaccess/agente`, `npm install --omit=dev`, depois `env -u ELECTRON_RUN_AS_NODE <firehub-print-assistant>/node_modules/.bin/electron-builder --win portable` e copiar `dist/FireAccess.exe` para `public/downloads/`.

**Mensagem pronta para o lojista (fase 3):**
> Consigo fazer isso direto no seu computador. Baixa este programa: https://firehubfood.com.br/fireaccess
> Se o Windows avisar "O Windows protegeu o computador", clica em Mais informações › Executar assim mesmo.
> Abre, me passa o código de 6 números que aparece e clica em Permitir suporte FireHub. Fica do lado do computador. Senha quem digita é você.

## v0.2 (20/11/2026) — autonomia total

Douglas, 20/11: "melhore tudo que puder" e "certificar que você vai ter autonomia total de mexer em tudo".
- **Administrador:** o .exe pede elevação na abertura (`requestExecutionLevel: highest`). Sem conta de administrador, abre normal e a sessão mostra "SEM administrador".
- **`executar`:** PowerShell no PC do cliente, devolve a saída (até 85 s; instalador demorado vai por `Start-Process` sem `-Wait`). `abrir` e `info` da CLI usam ele.
- **`enviar`:** manda um arquivo local (até 30 MB) para `Downloads\FireHub` do cliente. Maior que isso: baixar no PC dele com `executar` + `Invoke-WebRequest`.
- **Queda de internet:** a sessão espera o agente voltar por 90 s (segredo combinado no Permitir). A faixa mostra "reconectando…". Relay reiniciado = sessão acaba e o agente fecha.
- **Ao vivo:** o agente transmite sozinho (1280 px, ~40–60 KB, até ~5 quadros/s) só enquanto alguém está olhando; a página do Douglas busca o quadro novo (long-poll) e ocupa a janela. Clique direito, duplo e roda do mouse funcionam no "assumir".
- **CLI:** usa o relay no ar e `~/.fireaccess-token` sem configurar nada; `sessoes` mostra administrador, versão e queda.
- **Registro:** `executar` grava o script e a saída (até 4 KB); `enviar` grava nome, tamanho e sha256; queda e volta também entram.
- Compatível com o .exe 0.1 (sem ao vivo nem retomada nele).

## Regras atuais que mudam quando a fase 3 estiver no ar

- `impressora-se-ensina-nao-se-acessa` e "não oferecer acesso remoto" passam a ser **"oferecer o FireAccess"**.
- `ensinar-com-video-nao-fazer` continua valendo para loja já implantada em tarefa do dia a dia. O FireAccess serve para instalação, integração e travamento.
- Até lá, as regras atuais valem. Não prometer acesso a ninguém antes da fase 3.

## v0.3 (20/11/2026) — mais rápido, como o Claude usa o navegador do Douglas

Primeiro teste real (Victor, notebook Windows): funcionou, mas levou 26 min até a primeira tela (Edge e Windows barrando o download) e cada ação dependia de foto. Douglas: "mexer no PC igual é você comigo aqui", "controle de tudo, mexer em impressora".
- **Modo navegador (`nav`):** o agente abre um Chrome/Edge separado (perfil `%LOCALAPPDATA%\FireHub\fireaccess-navegador`, porta de depuração só em 127.0.0.1) e o atendente lê o texto da página e clica por seletor ou texto, sem foto. Medido no teste local: abrir 1,5 s, ler a página inteira 0,1 s. `preencher` recusa campo de senha (regra 4); login quem faz é o cliente, uma vez, e fica no perfil do FireAccess.
- **Janelas do Windows pelo nome (UI Automation):** `janelas`, `controles`, `apertar`, `escrever` (recusa campo de senha). Testado: apertar "Sete" na Calculadora sem mexer no mouse. Serve para diálogo de impressora, instalador, Configurações. A janela do próprio FireAccess (Electron) não aparece para o UI Automation: ninguém aperta Permitir por script.
- **`impressoras` e `testar-impressora`:** lista com porta, driver, status, fila e padrão; página de teste do Windows.
- **`lote`:** vários passos de mouse/teclado numa ida, uma foto no fim.
- **Faixa mostra o que o suporte está fazendo** ("Suporte FireHub: clicando…", "usando o navegador…") e volta para "conectado". O cliente vê que não está parado, sem animar a seta (Douglas preferiu assim).
- **Código:** o cliente não precisa mais passar o código (o Victor estranhou que entramos sem ele). A janela diz só "Clique em Permitir"; a página `/fireaccess` e a mensagem pronta também. O código continua aparecendo para identificar a sessão quando houver várias.
- **Relay:** aceita `lote` e `navegador` (prazo próprio). Precisa do **Deploy manual** do app `fireaccess-relay` no Coolify antes de soltar o .exe 0.3.
- **Pendente:** o 502 que derrubou a sessão do Victor às 15:01 (relay reiniciou? sessões vivem só na memória). Assinatura do .exe para acabar com o aviso de download: decisão do Douglas (custo).
