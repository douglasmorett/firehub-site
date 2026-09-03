# Extensão de prazo — o que descobrimos em 03/09/2026

Dois assuntos: **(1)** o bug do ESTOURO que a Hakim sofreu, já corrigido, e **(2)** o
que medimos no Portal do Parceiro do iFood pensando em transformar a extensão num
produto de assinatura. O segundo é o que muda o desenho do produto.

---

## 1. O ESTOURO — causa e correção

O painel mostrava ESTOURO com 9 e 10 pedidos, independente de quantos motoboys o
lojista colocasse. Não era a tabela nem a contagem.

**O servidor nunca soube quantos motoboys havia.** O `etaConfig` da Hakim estava com
`motoboysCount: 1` — e com 1 motoboy o limite de estouro é 4 pedidos.

Provado chamando a rota:

    GET /api/store/dynamic-eta?motoboys=5&token=<loja>
    → activeMotoboys: 1   limits: { max38: 2, max58: 3, max78: 4 }

Mandamos 5, ele calculou com 1. `dynamic-eta` dá prioridade ao valor salvo sobre o
`?motoboys=` (decisão correta), mas o valor salvo estava travado por um defeito de
fundo: **as duas rotas exigiam formatos de token incompatíveis.**

| token                          | `dynamic-eta` (ler) | `eta-config` (gravar) |
|--------------------------------|---------------------|-----------------------|
| id cru (extensão já instalada) | 200                 | **401**               |
| assinado (login de hoje)       | **401**             | 200                   |

Não existia token que servisse nas duas. A extensão da Hakim tinha o antigo: lia o
painel, mas **toda gravação do contador voltava 401**. O número mudava na tela e o
servidor continuava em 1. E o aviso de falha era apagado pelo polling de 3 segundos.

### Corrigido

- `src/app/api/store/dynamic-eta/route.ts` — passa a aceitar os dois formatos na
  leitura, via `lerTokenDeExtensao`. Testado: assinado 200, cru 200, assinatura
  forjada 401 (a proteção contra IDOR continua de pé).
- `firehub-ifood-extension/popup/popup.js` — se a gravação falhar, o número **volta
  para o valor do servidor** em vez de mentir na tela, e aparece um aviso que o
  polling não apaga.

### Ordem de operação

1. Deploy do fix.
2. **Depois** sair e entrar de novo na extensão (o login emite o token assinado).
   Relogar antes do deploy quebra a extensão — é o outro lado da mesma moeda.

Contorno enquanto isso: a aba **Manual**, cujas regras viajam na URL e não dependem
do valor salvo.

---

## 2. Portal do iFood — o que medimos no navegador real

### A loja ativa é global da sessão

Trocar de loja numa aba troca em todas. Duas abas do portal, abertas ao mesmo tempo,
carregaram o **mesmo** merchant UUID. Ou seja: **não existe "3 abas, 3 lojas"** —
nem para a extensão, nem para o lojista na mão.

### Mas a API é endereçável por loja — e isso resolve o problema

As chamadas do portal levam o **UUID do merchant no path**:

    GET https://portal-api.ifood.com.br/next-web-bff/delivery/merchants/{uuid}/all-delivery-flow-routes
    GET https://portal-api.ifood.com.br/next-web-bff/delivery/merchants/v1/pre-configs/{uuid}?typeId=...
    GET https://portal-api.ifood.com.br/next-web-bff/user/restaurants?offset=0&size=5   (lista as lojas)

**Teste decisivo, feito e confirmado:** pedimos os dados da loja *Hakim - Centro*
enquanto a loja ativa era a *Frituras* → **HTTP 200 com os dados da loja pedida**.

Consequência: a extensão **não precisa trocar de loja para agir em várias**. Ela
chama a API uma vez por loja, com o UUID de cada uma, usando a sessão já logada.
Some o clique no seletor (o elemento mais frágil), some o roubo de contexto do dono,
some a fila serial de 2-3 minutos, some o teto de 5 min do service worker.

### A tela de entrega não tem "um campo de prazo"

São **13 faixas de raio** (0,5 / 1 / 1,5 / 2 / 2,5 / 3 / 3,5 / 4 / 5 / 6 / 7 / 10 /
20 km), cada uma com tempo e taxa próprios, mais o "Ajuste Rápido" de ±5 min e ±R$1
que mexe em todas de uma vez. É por isso que a extensão hoje usa os botões ±5 min em
vez de digitar num campo. Pela API dá para mandar a tabela inteira de uma vez, o que
é mais preciso.

### O que ainda falta medir (o próximo teste)

**Como o portal SALVA.** Falta capturar o PUT/POST que sai ao clicar em Salvar e
confirmar que ele também leva o UUID no path. A leitura já provou que leva; o
esperado é que a escrita siga o mesmo padrão, mas isso precisa ser visto, não
suposto. É um teste de 5 minutos com a loja fechada.

### Riscos medidos no próprio portal

- **PerimeterX / HUMAN Security** (`collector-*.px-cloud.net`) roda no portal: existe
  detecção de automação. Chamar a API direto pode ser tratado como bot. O caminho
  mais seguro é fazer as chamadas **de dentro da página do portal** (a mesma origem,
  a mesma sessão, o mesmo device fingerprint), não de fora.
- O token da sessão vive em cookie legível pelo JS da página e **expira** — a
  extensão precisa lidar com renovação, e nunca guardar esse token em servidor
  nenhum.
- Automatizar o Portal do Parceiro continua sendo zona cinzenta nos termos do iFood,
  e a sanção recai sobre a conta do **cliente**.

---

## 3. Desenho do produto que sai daqui

**Leitura** — só o kanban do sistema que o lojista já usa, que soma site + iFood + 99
num número só (sem risco de contar o mesmo pedido duas vezes). Quem não tem kanban
não é cliente. A extensão acha a coluna por palavra (produção / preparo / cozinha),
prefere ler o **contador do cabeçalho** a contar cards, e tem um modo "ensinar" em
que o lojista aponta a coluna uma vez.

**Cuidado já conhecido:** o badge do painel obedece filtro de canal, período e busca.
Se o lojista filtrar por iFood, o número despenca e o prazo vai junto. Tem que
detectar filtro ativo e recusar a leitura.

**Escrita** — só iFood e 99 por enquanto. Nada de mexer no PDV do cliente: ler é
observar, escrever no sistema dele é agir dentro do negócio dele, e o heurístico
atual (`qualquer input entre 5 e 500 com "min" por perto`) pode acertar taxa, raio ou
pedido mínimo. Para o sistema próprio, avisar em vez de alterar.

**Multi-loja / dark kitchen** — o modelo é *um grupo de capacidade → N lojas*. Três
marcas na mesma cozinha dividem os mesmos motoboys: uma leitura, três escritas, mesmo
prazo. Três pontos diferentes são três grupos, três licenças. Hoje `etaConfig` mora
no `User` (uma config por conta) — precisa virar config por grupo.

**Pendências para virar produto pago:** o cálculo hoje é replicado dentro da extensão
(copiar a pasta dá produto grátis) e precisa sair só do servidor; não existe cobrança
recorrente no código, só boleto avulso; a conta da Chrome Web Store ainda não pode
publicar; e o nome com "iFood" é rejeição na revisão.

**Esforço realista:** 6 a 10 semanas para um MVP honesto (iFood, entrega própria,
licença funcionando). Com a descoberta da API endereçável, o multi-loja fica bem mais
barato do que os 2-3 semanas estimados antes.
