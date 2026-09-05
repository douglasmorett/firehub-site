# Runbook — subir o módulo de mesas (acesso do garçom, conta impressa, Assistente 1.2.3)

Ordem obrigatória. Fora dela, a impressão de **todas** as lojas para.

## 1. Banco ANTES do código

O `Dockerfile` não roda migração (`entrypoint.sh` só sobe `node server.js`), e não há pasta
`prisma/migrations`: o schema é aplicado à mão. Se o container subir antes, o Prisma Client
novo pede colunas que não existem.

```bash
# 1. Testar na branch da Neon (Branches → New Branch → auto-delete 1 day)
DATABASE_URL="<url da branch>" npx prisma db push

# 2. Só então produção
DATABASE_URL="<url de produção>" npx prisma db push
```

Tudo é **aditivo** — não pede `--accept-data-loss`:

| Tabela/Modelo | O que entra |
| --- | --- |
| `Waiter` | `login`, `passwordHash`, `credentialsUpdatedAt`, `lastLoginAt`, único `(franchiseeId, login)` |
| `TableSession` | `closedByKind`, `closedByName` |
| `User` | `cashClosedAt`, `printQueuePolledAt` |
| `PrintRequest` | tabela nova (conta da mesa na fila de impressão) |

O índice único aceita nulos sem conflito, então garçons já cadastrados não travam o push.

**Rede de segurança**: se o código subir antes por engano, o `GET /api/store/print-queue`
foi feito tolerante — a coluna e a tabela novas falham sozinhas e as comandas continuam
saindo. Isso é rede, não plano: o acesso do garçom e o fechamento de caixa **quebram** sem
o push.

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

## 3. Assistente de Impressão 1.2.3

O instalador em `public/downloads` e `VERSAO_ASSISTENTE_ATUAL` sobem no mesmo commit. A
partir do deploy, todo Assistente 1.2.x baixa e reinstala sozinho em até 6 h.

O 1.2.3 traz duas proteções que **precisam** estar no ar antes da atualização em massa:

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
