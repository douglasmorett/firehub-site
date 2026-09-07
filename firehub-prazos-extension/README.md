# FireHub Prazos — extensão vendida (v0.2.0)

Extensão do Chrome vendida fora do FireHub (assinatura na Cakto). Lê a fila da
cozinha no painel de pedidos que o lojista já usa e ajusta sozinha:

- **iFood** — o prazo de entrega de cada loja marcada, no Portal do Parceiro;
- **99Food** — o tempo de preparo de cada loja marcada, no 99Food Admin (o 99
  soma por cima o prazo de entrega da área, que é tabela fixa por raio).

Não confundir com `firehub-ifood-extension` (a interna, das lojas FireHub):
esta não sabe calcular — o servidor (`/api/prazos/*`) é quem devolve "ponha M
minutos no iFood e P de preparo no 99Food, nestas lojas". Sem conta ativa,
é um popup sem função.

## Como funciona

1. `scripts/leitor.js` roda no painel do lojista (registrado por host, com a
   permissão pedida no clique **Marcar coluna**): soma as colunas marcadas e
   manda `PRAZOS_LEITURA` ao service worker.
2. `scripts/background.js` chama `POST /api/prazos/calcular` e recebe o prazo
   do iFood, o preparo do 99 e as lojas marcadas de cada plataforma.
3. Escreve pelas APIs internas dos próprios portais, executadas **no contexto
   da página** (`chrome.scripting.executeScript` com `world: "MAIN"`), com o
   cookie/token que a página usa — o mesmo que o botão Salvar faz:
   - iFood: `PATCH portal-api.ifood.com.br/next-web-bff/delivery/merchants/{uuid}?setupV2=…&deliveredBy=MERCHANT`
     com as faixas de raio; a extensão **desloca** todas as faixas pela mesma
     diferença (preserva a escada 34/44/53… de quem escalona por distância);
   - 99Food: `POST b.99app.com/shop/setting/avgProduceTime` com
     `avgProduceTime` (segundos) e os períodos especiais no mesmo valor.
   Depois lê de volta e confere. Uma aba de cada portal aberta e logada basta
   (não precisa estar na tela de configuração).
4. `scripts/ifood.js` e `scripts/noventanove.js` só mostram a pílula 🔥 com o
   estado e avisam quando a sessão do portal cai.

## Regras que valem mais que o código

- Só mexe em loja **marcada** no popup. Loja do login não marcada fica como está.
- Todas as lojas de uma plataforma precisam estar **no mesmo login** — é dentro
  dele que a extensão troca de loja (pela API, sem clicar).
- Coluna marcada que sumiu do painel **não vira zero**: segura o último prazo e avisa.
- Servidor recusou (conta sem pagamento, `402`) = para de escrever, com o motivo na tela.
- Nunca abre aba do iFood/99Food sozinha: só pelo clique do lojista.
- Cota de lojas do plano (`lojasIncluidas`, por plataforma) é conferida no servidor.

## Popup

Login da conta → colunas marcadas → lojas do iFood e do 99Food (caixinhas, lidas
das abas abertas com **Atualizar lista**) → regra do iFood (auto por motoboys ou
faixas manuais) → regra do 99 (iFood − N min de entrega, ou faixas próprias em
minutos de preparo) → robô liga/desliga → Relatório (`/prazos/relatorio`) →
Trocar senha.

## Instalar (lojista)

`https://firehubfood.com.br/downloads/FireHub-Prazos-Extensao.zip` →
`chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação.
Guia com passos em `https://firehubfood.com.br/prazos#instalar`.

## Testar

- Servidor: `scripts/teste-prazos-api.js` no scratch da sessão de 07/09/2026
  (conta piloto no banco, login → config → calcular → cota → 402).
- Navegador de verdade: `driver-cdp.js` + `kanban/kanban.html` (Edge com
  `--load-extension`; Chrome 152 ignora o flag).
- Escrita real: ver a sessão de 07/09/2026 — iFood em 3 lojas com deslocamento
  e restauração faixa a faixa; 99Food na Brasa (30→35→30) e Chapa Quente.
