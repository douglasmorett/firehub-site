---
name: revisar-robo-do-firehub
description: Revisão periódica das conversas do WhatsApp do próprio FireHub (22 98111-8514) para o robô do atendimento aprender. Use quando o Douglas pedir para "analisar as conversas do robô", "ver o que o robô atendeu", "ver as conversas que a gente teve que atender", "deixar o robô mais inteligente", ou disser /revisar-robo-do-firehub. Lê as conversas desde a última revisão, separa erro do robô e lacuna da base, confere cada fato no código, ensaia com o Gemini real e deixa a branch pronta para o deploy.
---

# Revisar o robô do FireHub pelas conversas

O robô do número do FireHub (`src/lib/atendimento/`) só sabe o que está em três lugares:
1. `conhecimento.ts` — a base escrita (preço, onde fica cada coisa, problemas comuns);
2. a fala de TODOS os vídeos tutoriais (`manualDosVideos`, de `src/lib/tutoriais-busca.json`), que vai inteira no prompt;
3. os "Recados para o robô" da tela do CRM (`CrmConfig.instrucoesExtras`), que valem sem deploy.

O que ele VÊ e CONSULTA (03/10/2026):
- imagem, vídeo e PDF: lidos na chegada (`descreverMidia`, gravado como "[O que a imagem mostra: …]") e a mídia vai junto para o modelo na resposta seguinte (`midias.ts`, só em memória);
- `ver_cardapio_da_loja` (`cardapio-para-o-suporte.ts`): o cardápio da loja do lojista reconhecido, com situação AGORA (pausado, fora do horário/dia, canal desligado) e preços já calculados pelas funções de `lib/preco-por-canal`;
- `estado_da_loja`: impressão, robô, integrações, fatura.

Toda resposta passa por duas travas: `acaoDitaSemFerramenta` ("mudei aqui para você" sem ter mudado) e o revisor (`conferente.ts`), que corta o que não tem fonte. Corte da revisão = lacuna na base.

## Passo a passo

### 1. Ler as conversas (só leitura)
```bash
cd <worktree nova do origin/master>   # nunca no checkout principal, que vive cheio de WIP
ENV_DIR='C:\Users\Micro\Documents\firehub-site' node scripts/conversas-do-atendimento.mjs --desde <data da última revisão> --saida <scratchpad>/conversas.md
```
A data da última revisão está no topo de `Obsidian Vault/Projetos/FireHub - Robô do atendimento aprendendo.md`. O script já põe o horário de Brasília (a coluna vem deslocada pelo driver neon), tira o número do próprio FireHub (anotações do Douglas) e lista no topo o "✋ Onde o robô não soube", com o que a equipe respondeu depois.

Áudio chega transcrito ("🎤 …"). Imagem/vídeo/PDF chegam com "[O que a imagem mostra: …]": leia essa descrição para saber o que o robô viu. Sem ela, a leitura falhou (o robô deve ter pedido o print de novo).

### 2. Classificar cada conversa
Para cada resposta do robô e cada vez que a equipe precisou entrar, uma destas:

| Tipo | Sinal | O que fazer |
|---|---|---|
| **Lacuna da base** | revisão cortou/barrou; robô chamou a equipe por não saber; equipe respondeu algo que o robô poderia ter respondido | linha nova em `conhecimento.ts` (passo 3) |
| **Resposta errada com fonte** | o revisor deixou passar, mas a resposta estava errada (a base ou o vídeo induz ao erro, ex.: exemplo com números que o robô copiou) | corrigir a base ou o vídeo; o revisor NÃO pega isso, só a leitura |
| **Robô disse que fez** | "mudei", "coloquei", "já está aparecendo" | ver se a trava pegou; se não, acrescentar o verbo em `ACAO_NA_LOJA` (conferente.ts) |
| **Chamou sem precisar** | caso fora dos 5 da seção "Quando chamar a equipe" (robo.ts) | regra no prompt ou linha na base |
| **Devia ter chamado e não chamou** | cobrança, cancelamento, reclamação, pediu humano | regra no prompt |
| **Tela confusa** | o lojista errou porque a TELA induz ao erro (ex.: Promo +R$ lido como preço final) | anotar para o Douglas: o conserto pode ser na tela, não no robô |
| **Função que não existe** | o lojista pediu algo que o sistema não faz | não entra na base como "dá"; anotar como pedido de função (fila de deploys / Douglas) |
| **Leu errado a imagem** | a descrição gravada não bate com o que o contato mandou | ajustar `PEDIDO_DA_DESCRICAO` (gemini.ts) e pôr a imagem em `scripts/fixtures/ensaio-robo` como caso |
| **Equipe errou** | a equipe respondeu algo que o código desmente | avisar o Douglas; NÃO vira base |

Robô calado porque alguém respondeu antes (pausa de 10 min pelo celular, 2 h pela tela) não é erro do robô.

### 3. Conferir no código ANTES de escrever na base
A resposta da equipe é ponto de partida, não fonte. Para cada fato novo, achar na tela o rótulo exato do botão/aba e o arquivo:linha (um agente Explore em paralelo resolve vários de uma vez). Escrever a linha com os nomes como aparecem na tela, curta, e o "por quê" quando ajuda o lojista a não errar de novo.
- Exemplo em base: nunca com números parecidos com os do caso real (o robô copiou o "R$ 50" do exemplo como se fosse o preço do lojista, 03/10).
- Assunto que um vídeo já mostra: não repetir na base; se o vídeo estiver desatualizado, regravar o vídeo (skill/roteiros em `tutoriais/`).
- Recado rápido (promoção da semana, aviso temporário): "Recados para o robô" na tela, sem deploy.

### 4. Um caso no ensaio para cada erro
`scripts/ensaio-do-robo-do-firehub.ts`, array `CASOS`: a conversa real (encurtada), `deve`/`naoPode` em regex, `chamaEquipe`. Rodar ANTES de mexer (o caso tem que falhar) e depois (tem que passar, junto com todos os antigos):
```bash
ENV_DIR='C:\Users\Micro\Documents\firehub-site' npx tsx scripts/ensaio-do-robo-do-firehub.ts            # todos
ENV_DIR='C:\Users\Micro\Documents\firehub-site' npx tsx scripts/ensaio-do-robo-do-firehub.ts serpa pix  # só alguns
```
É o Gemini de verdade com o prompt de verdade, ferramentas de mentira (nada é enviado nem gravado). Rodar ao menos 2 vezes: a resposta varia. "✂️ revisão cortou" é aviso (a resposta reescrita sai); "❗" é falha. Custa centavos.

Caso com imagem: `{ de: "contato", texto: "Assim?", imagem: "arquivo.jpg" }` (arquivo em `scripts/fixtures/ensaio-robo/`; print sintético se faz com HTML + Playwright, foto de tela com ffmpeg num quadro de `wt-tutoriais/tutoriais/saida/<id>/video.mp4`). Caso com o cardápio real de uma loja: `loja: "<slug>"` (só leitura).

Mexeu na chegada da mídia (entrada.ts/midias.ts)? Rode também `scripts/e2e-midia-do-robo-pglite.ts` (PGlite local; instruções no topo do arquivo).

Também: `npx tsx scripts/teste-midias-do-robo.ts`, `npx tsx scripts/teste-videos-do-robo.ts`, `npx tsx scripts/teste-robo-nao-diz-que-fez.ts` e `npx tsc --noEmit -p .` (só os erros conhecidos de `lib/nfce`).

### 5. Entregar
- Commit na branch da revisão; deploy segue a regra do Douglas: entra na fila `Projetos/FireHub - Deploys pendentes.md` e sobe junto no fim do dia, a não ser que ele peça antes.
- No vault, `Projetos/FireHub - Robô do atendimento aprendendo.md`: uma seção por revisão (data, período lido, nº de conversas, o que mudou, o que ficou para o Douglas decidir) e a data da última revisão no topo.
- Para o Douglas, em poucas linhas: o que o robô errou, o que aprendeu, o que precisa de decisão dele (tela confusa, função pedida, resposta errada da equipe).

## Regras que não mudam sem o Douglas
- O número do FireHub só RESPONDE: nada de mensagem automática (já perderam um número assim).
- O robô não marca reunião nem demonstração.
- Os 5 casos de chamar a equipe (robo.ts, "Quando chamar a equipe") não afrouxam.
- Checklist/auditoria são do FireCheck: não entram na base.
