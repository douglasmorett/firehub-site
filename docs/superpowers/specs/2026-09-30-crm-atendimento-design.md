# CRM, caixa de atendimento, agenda da equipe e robô do FireHub

Pedido do Douglas em 29–30/09/2026: um atendente com IA no número do próprio
FireHub (22 98111-8514), que atende **lojista** (suporte) e **interessado**
(venda até o teste grátis), e em volta dele um CRM no admin — ver quem o robô
está atendendo, pausar o robô, responder pela tela, distribuir os contatos para
os vendedores, agenda compartilhada de demonstrações e o desempenho da equipe.

Decisões tomadas com ele:

| Pergunta | Resposta |
|---|---|
| Quem fala com o número | lojistas (suporte) e interessados (venda) |
| Até onde o robô vai no suporte | diagnostica e faz ações simples (dono confirmado pelo telefone) |
| Objetivo com o interessado | levar ao teste grátis; demonstração com vendedor quando pedir |
| Número | o atual; ele continua respondendo pelo celular |
| Por onde o vendedor conversa | pelo número do FireHub, na tela (conversa fica na empresa) |
| Agenda | compartilhada pela equipe, por dia, mostrando as vagas de cada vendedor |
| Comissão | os 3% de quem está na carteira já existem (`sellerPercent`); o lead de um vendedor leva o vendedor para a loja quando se cadastra |

## O número é da plataforma, não uma loja

A instância do gateway se chama `firehub_atendimento` e **não pertence a
nenhum `User`**. Motivo: o `User` carrega semântica de loja — cobrança,
crons que varrem `chatbotConfig` (keepalive, abertura, impressão parada), as
listas do admin. Uma loja de mentira apareceria em tudo isso.

O gateway de produção manda **todas** as instâncias para um webhook só
(`FIREHUB_WEBHOOK_URL`), então o desvio é no começo do `POST` de
`/api/webhook/whatsapp`: se a instância é a do atendimento, o evento vai
inteiro para `lib/atendimento/entrada.ts` e a rota devolve 200. Nada do
caminho das lojas roda para esse número.

## Dados (tabelas novas, criadas no boot)

Todas por `CREATE TABLE IF NOT EXISTS` em `garantirEstruturaDoCrm`
(`lib/garantir-colunas.ts`), chamada no `instrumentation.ts`. Nenhuma coluna
nova em tabela existente.

- **`CrmContato`** — uma pessoa/número. `telefone` único (só dígitos, com 55),
  `jid` para responder, nome, loja, cidade, e-mail, `origem`, `etapa`
  (NOVO → CONVERSANDO → DEMO_MARCADA → EM_TESTE → CLIENTE, ou PERDIDO),
  `userId` (loja vinculada), `vendedorId` + `vendedorAtribuidoEm` +
  `primeiroContatoEm`, notas, resumo do robô, travas do robô
  (`roboPausadoAte`, `roboDesligado`, `aguardandoHumanoDesde`), não lidas e a
  última mensagem (para a lista).
- **`CrmMensagem`** — o histórico durável. `waId` único (id do WhatsApp),
  direção, autor (CLIENTE, ROBO, ADMIN, VENDEDOR, CELULAR, SISTEMA), tipo,
  texto, status.
- **`CrmEvento`** — linha do tempo: etapa, vendedor, nota, reunião, cadastro.
- **`AgendaReuniao`** — vendedor, contato, tipo (DEMONSTRACAO, ACOMPANHAMENTO,
  TREINAMENTO, BLOQUEIO), início/fim, local/link, status (MARCADA, REALIZADA,
  FALTOU, CANCELADA), quem marcou, marcas de lembrete.
- **`AgendaDisponibilidade`** — por vendedor: dias da semana com faixas de
  horário, duração da demonstração e intervalo. Sem cadastro = padrão
  seg–sex 9h–12h e 14h–18h, 45 min + 15.
- **`CrmConfig`** — linha única: robô ligado (padrão **desligado**), número
  para avisar o Douglas, lembretes, instruções extras do robô, estado da
  conexão.

Loja vinculada: o vendedor de uma loja continua morando em `User.vendedorId`
(é o que o billing lê). O CRM espelha: atribuir no CRM um contato com loja
grava os dois; atribuir na aba Lojistas também atualiza o contato.

## Telas

Admin (barra lateral, grupo "Comercial"):
- **Atendimento** — lista de conversas (busca, filtros: aguardando pessoa,
  não lidas, sem vendedor, por vendedor), conversa ao centro com autor de cada
  mensagem, caixa de resposta, pausar/devolver o robô; à direita a ficha do
  contato (etapa, vendedor, loja e o estado dela, notas, reuniões, marcar
  demonstração). No topo, a conexão do número (QR / código) e o interruptor
  do robô.
- **CRM** — funil por etapa (colunas) e lista, novo contato à mão, atribuir
  vendedor em lote.
- **Agenda** — grade do dia com uma coluna por vendedor, horários livres
  clicáveis ("3 vagas"), semana resumida, disponibilidade de cada um.
- **Vendedores** — ganha o desempenho por período.

Vendedor (`/vendedor`, abas): Carteira (a de hoje), Meus contatos,
Conversas (só as dele, responde pelo número do FireHub), Agenda (a da equipe
inteira; nas colunas dos outros só "ocupado"), Minha disponibilidade.

## Robô

`lib/atendimento/robo.ts`, Gemini com chamada de ferramentas (mesmos modelos
e chave do robô das lojas). Base de conhecimento curta e versionada em
`lib/atendimento/conhecimento.ts` (preço, teste grátis, o que o sistema faz,
passo a passo de suporte). Ferramentas:

- `estado_da_loja` — só para contato com loja vinculada: robô do WhatsApp
  conectado, Assistente de impressão (última consulta e versão), iFood,
  teste/fatura, último pedido, loja aberta.
- `horarios_livres` / `marcar_demonstracao` — agenda da equipe; escolhe o
  vendedor do contato ou o com menos reuniões no dia; avisa o vendedor.
- `atualizar_contato` — nome, loja, cidade, resumo do que o lead precisa.
- `enviar_link_de_senha` — dispara o e-mail de redefinição da conta
  (nunca o link pelo WhatsApp).
- `chamar_pessoa` — pausa o robô na conversa, marca "aguardando pessoa" e
  avisa o Douglas e o vendedor.

Travas: robô só responde com o interruptor ligado, contato não pausado nem
desligado, e no máximo 15 respostas por contato em 24 h (depois chama
pessoa). Quem responde pela tela ou pelo celular pausa o robô naquela
conversa (2 h pela tela, 12 h pelo celular).

## Lembretes

Job novo no `cron-runner` (5 min): lembrete ao contato 1 h antes da
demonstração, aviso ao vendedor quando alguém marca na agenda dele, e a
reconexão do número se o gateway derrubou.

## Fora desta entrega

Mídia (foto/documento) na resposta pela tela; importar histórico antigo do
WhatsApp; Google Agenda; distribuição automática por rodízio.
