# TEF no totem (pinpad PayGo Web)

O Assistente roda a PGWebLib.dll num processo filho e o totem conversa com ele
pelas rotas `/tef/*`. Enquanto o kit não chega, o motor `simulador` usa o mesmo
protocolo. O código está em `index.js`. O cabeçalho dele descreve o protocolo,
a regra de ouro e a segurança.

| Arquivo | O que é |
|---|---|
| `index.js` | Supervisor do motor, rotas `/tef`, pendências em `%APPDATA%\FireHub\tef-pendente.json`, conversa com o FireHub e impressão das vias |
| `PayGoHost.cs` | Ponte em C# 5 com a DLL. Faz P/Invoke por LoadLibrary e GetProcAddress, com protocolo JSON por linha |
| `motor-paygo.ps1` | Compila o `PayGoHost.cs` com Add-Type no PowerShell de **32 bits** (SysWOW64) e passa o stdin/stdout para ele |
| `simulador.js` | Motor falso com o mesmo protocolo. Valor terminado em ,99 é recusado. Valor terminado em ,97 derruba o motor no meio |
| `constantes.js` | PWOPER, PWRET, PWINFO, PWDAT, PWCNF e AUTCAP. É o **único** lugar a corrigir |

## Ligar com o kit PayGo

1. **DLL.** Copie a `PGWebLib.dll` do kit e as dependências que vierem junto
   (certificado, DLLs auxiliares) para `%APPDATA%\FireHub\paygo\`. A DLL não
   vai no repositório. O motor chama `SetDllDirectory` na pasta da DLL.
2. **Arquitetura.** O motor sobe em 32 bits por padrão. Se o kit trouxer a DLL
   x64, coloque `"arquitetura": "x64"` em `%APPDATA%\FireHub\tef.json`. Com a
   arquitetura errada, o status mostra "A PGWebLib.dll é de outra arquitetura".
3. **`tef.json`** fica em `%APPDATA%\FireHub\` e pode ser editado à mão. Depois
   de editar, reinicie o Assistente.
   ```json
   {
     "motor": "paygo",
     "dll": "C:\\Users\\<usuário>\\AppData\\Roaming\\FireHub\\paygo\\PGWebLib.dll",
     "arquitetura": "x86",
     "pastaDeTrabalho": "C:\\Users\\<usuário>\\AppData\\Roaming\\FireHub\\paygo\\trabalho",
     "ambiente": null,
     "idleProcSegundos": 30,
     "impressora": "",
     "exigirImpressao": true,
     "aceitarRede": false,
     "respostas": {}
   }
   ```
   - `ambiente`: o número passado a `PW_iSetEnvironment` (homologação ou
     produção). Com `null`, a função não é chamada. Os valores **não estão na
     doc pública**: confira no .h do kit.
   - `respostas`: respostas automáticas para menus e digitação da PayGo, no
     formato `{ "<PWINFO>": "<valor>" }`. Exemplo: responder sempre o mesmo
     adquirente. Sem resposta automática, o menu aparece como botões na tela do
     totem.
   - `impressora`: vazio usa a impressora do Assistente.
4. **Pareamento.** No painel, vá em Totem › TEF no totem, escolha "PayGo" e
   clique em "Ligar neste computador". A tela tem de estar aberta **no
   computador do totem**. Depois aperte F5 no totem.
5. **Instalação do ponto de captura.** Antes da primeira venda, a PayGo exige
   a transação de instalação (`PWOPER_INSTALL`, ret `PWRET_NOTINST` -2498). O
   motor ainda **não** tem botão para isso. Faça pela ferramenta do kit
   (PGWin ou o exemplo C#) usando a mesma `pastaDeTrabalho`, ou acrescente uma
   operação "instalar" no `PayGoHost.cs`. É a mesma `Venda` com `PWOPER_INSTALL`
   e sem parâmetros de valor.

## Homologação (paygodev.readme.io › "Passo a passo homologação")

- Peça o acesso ao **Jira da Setis/PayGo** ("Acesso ao Jira") e abra o chamado
  de homologação da automação "FIREHUB TOTEM" (PWINFO_AUTNAME), com a versão
  do Assistente (PWINFO_AUTVER).
- Peça a liberação do ponto de captura de testes ("Liberação do Ponto de
  Captura") e o pinpad de homologação.
- Rode o roteiro de testes da PayGo com o motor `paygo`. O que a automação
  precisa demonstrar já está implementado:
  - confirmação só depois da venda gravada;
  - desfazimento quando o pedido é cancelado, quando a impressão falha ou
    quando há queda de energia (pendência achada na volta);
  - tratamento de `PWRET_FROMHOSTPENDTRN`;
  - impressão das duas vias (`PWINFO_AUTCAP` = 4 + 8 + 64 + 128);
  - cancelamento no pinpad (`PW_iPPAbort`);
  - mensagens do pinpad no "checkout" (`PWDAT_DSPCHECKOUT`).
- Fica de fora, por enquanto: Pix e carteira digital por QR
  (`PWDAT_DSPQRCODE`, AUTCAP 256), cartão digitado, cancelamento de venda já
  confirmada (`PWOPER_SALEVOID`) e relatórios. Se o roteiro exigir algum
  desses, é preciso implementar.

## CONFERIR NO .h DO KIT

Os valores de `constantes.js` vieram da doc pública e do exemplo C# oficial
(github.com/adminti2/Integracao-PayGoWeb-CSharp), e as duas fontes batem entre
si. Mesmo assim, confira:

- **PWRET**: OK, MOREDATA, DISPLAY, NOTHING, CANCEL e FROMHOSTPENDTRN. O
  `index.js` também trata `-2589` (FROMHOSTTRNNFOUND) na confirmação.
- **PWINFO**: os 30 códigos usados.
- **PWDAT**: os tipos de captura.
- **PWCNF**: CNF_AUTO e os REV_* usados (PRN, OTHER, PWR, ABORT).
- **Layout do `PW_GetData`** no `PayGoHost.cs`: tamanhos 84, 41 e 256, e
  40 opções.
- **Convenção de chamada**: StdCall, como no exemplo.
- **Não achei na doc pública**:
  - os valores de `iEnv` do `PW_iSetEnvironment`;
  - o formato do `PWINFO_IDLEPROCTIME`. Hoje o `PW_iIdleProc` é chamado a cada
    `idleProcSegundos` com o pinpad ocioso;
  - o tamanho máximo do `PWINFO_FISCALREF` (mandamos até 10 caracteres).

## Se o Add-Type de 32 bits não servir

O Add-Type no PowerShell x86 foi testado aqui: compila, carrega uma DLL por
LoadLibrary e fala JSON pelo stdin/stdout. Ainda não foi testado com a DLL de
verdade. Se o antivírus da loja barrar a compilação em tempo de execução,
compile um executável de 32 bits uma vez:

```
%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe /platform:x86 /target:exe ^
  /r:System.Web.Extensions.dll /out:PayGoHost.exe PayGoHost.cs Main.cs
```

O `Main.cs` só precisa de `static void Main(){ PayGoHost.Rodar(); }`. Depois,
troque o `spawn` do motor "paygo" em `index.js` para chamar o `.exe`.

## Testes

```
node scripts/teste-tef.js            # motor simulador ponta a ponta (Assistente)
npx tsx scripts/teste-tef-totem.ts   # lado do servidor (na raiz do site)
```

`teste-tef.js` precisa do `express` para a parte das rotas. Rode com
`NODE_PATH` apontando para o `node_modules` do Assistente.
