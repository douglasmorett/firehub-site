# Runbook — subir o módulo de mesas (acesso do garçom, conta impressa, Assistente 1.2.5)

Ordem obrigatória. Fora dela, a impressão de **todas** as lojas para.

## 1. Banco — já aplicado, e o boot regarante

**Não use `prisma db push` neste banco.** Produção tem tabelas e colunas que
nenhum `schema.prisma` declara (`AmbassadorApplication`, `Food99Store`, colunas
`brendi*`, `emergencyFine`, `routeSequence`, `totemIdempotencyKey`). O push
pediria `--accept-data-loss` e apagaria tudo isso, inclusive candidaturas de
embaixador.

O caminho é o que o repositório já usa: instruções aditivas e idempotentes em
`src/lib/garantir-colunas.ts` (`garantirEstruturaDeMesa`), aplicadas no boot
antes do primeiro request.

| Tabela | O que entra |
| --- | --- |
| `Waiter` | `login`, `passwordHash`, `credentialsUpdatedAt`, `lastLoginAt`, único `(franchiseeId, login)` |
| `TableSession` | `closedByKind`, `closedByName` |
| `User` | `cashClosedAt`, `printQueuePolledAt` |
| `PrintRequest` | tabela nova (conta da mesa na fila de impressão) |

**Status: aplicado em produção em 04/09/2026** — 8 colunas, tabela e índice
criados; `AmbassadorApplication` e `Food99Store` conferidas intactas. O boot
roda as mesmas instruções de novo, sem efeito (é idempotente), e cobre qualquer
banco que ainda não as tenha.

## 2. Deploy do site

Push para `master` → Coolify. Depois, o smoke test (leva 1 minuto):

```bash
curl -s "https://firehubfood.com.br/api/store/print-queue?franchiseeId=inexistente"   # {"jobs":[]}
curl -s -o /dev/null -w "%{http_code}\n" https://firehubfood.com.br/api/admin/menu-products  # 401
curl -s -o /dev/null -w "%{http_code}\n" https://firehubfood.com.br/store                    # 307 → /login
```

O terceiro confirma que o `proxy.ts` (ex-`middleware.ts`, renomeado para a convenção do
Next 16) está ativo no build. Se vier 200, o proxy não subiu e o painel está sem CORS,
sem HTTPS forçado e sem o bloqueio anônimo de `/api/admin`.

## 3. Assistente de Impressão 1.2.5

O instalador em `public/downloads` e `VERSAO_ASSISTENTE_ATUAL` sobem no mesmo commit. A
partir do deploy, todo Assistente 1.2.x baixa e reinstala sozinho em até 6 h.

O 1.2.5 traz duas proteções que **precisam** estar no ar antes da atualização em massa:

- **marcas de "já impresso" gravadas em disco** (`%APPDATA%\FireHub\printed-cache.json`):
  sem isso, todo reinício reimprimia as comandas das últimas 2 h — e o próprio
  auto-update reinicia;
- **atualização só em hora calma**: se imprimiu nos últimos 30 min, adia 15 min. Ninguém
  reinicia no meio do jantar.

Ideal deployar fora do horário de pico.

## 4. Depois de subir

- Abrir a aba **Garçons** de uma loja, cadastrar login e senha, copiar o link e testar em
  janela anônima (no mesmo navegador do painel a sessão do painel não atrapalha mais, mas
  a anônima é o teste honesto).
- Abrir uma mesa, lançar um item, clicar em **Imprimir Conta** e conferir o papel.
- Fechar o caixa e confirmar que o celular do garçom cai no login dizendo que o turno
  encerrou.
