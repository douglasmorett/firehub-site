# Tirar o FireHub da Vercel

**O plano Pro fica** — `firecheck`, `landing-page` e `hakim-portal` continuam lá.
O que tinha que sair é o **FireHub**, e era ele que respondia por quase toda a
conta.

## Situação (02/09/2026)

Produção do FireHub roda no **Coolify** (`firehubfood.com.br` → HTTP 200).

O projeto `firehub-site` na Vercel está **PAUSADO**. Confirmado pela resposta do
próprio domínio:

```
$ curl -sD - https://firehub-site.vercel.app/api/health
HTTP/1.1 503 Service Unavailable
X-Vercel-Error: DEPLOYMENT_PAUSED
```

Pausar (Settings → Pause Project) para de servir tráfego de produção e **para de
consumir recurso medido**, mantendo deployments, settings e variáveis de
ambiente. É reversível sem redeploy.

### Por que era o FireHub

No ciclo 14/08–14/09/2026 as cobranças por uso somaram US$ 70,26, sendo
**Fast Origin Transfer US$ 70,39** e **Build CPU Minutes US$ 9,62** o grosso. No
detalhamento por projeto do Fast Origin Transfer: `firecheck` 0,9%,
`hakim-portal` 0,0%, Blob Stores 0,0% — o resto (~99%, 1,14 TB de saída) é
`firehub-site`. O gráfico despenca para perto de zero depois de 21/08, que é
quando a produção passou para o Coolify: o que sobrou até agora era deploy velho
de pé mais build a cada push.

### O que já estava resolvido antes da pausa

- **O Git da Vercel já estava desconectado** (Settings → Git mostra a tela de
  conectar, não um repositório). A Action em `.github/workflows/deploy.yml`
  aponta para o **Coolify**, não para a Vercel.
- **Nada no código usa `@vercel/blob`.** Quem grava arquivo é
  `src/lib/storage.ts` (disco do VPS) e quem entrega é
  `src/app/uploads/[...path]/route.ts`. `package.json` não tem dependência da
  Vercel.
- **278 imagens de produto** já migradas para `/uploads` no VPS.
- `www.firehubfood.com.br` estava no projeto como **Invalid Configuration** — o
  DNS já não apontava para lá. Todos os domínios da conta são **Third Party**, ou
  seja, a Vercel não é DNS de nenhum: apagar o projeto não derruba domínio.

## O que ainda falta

### 1. As 11 imagens no Blob (dependência, não custo)

O banco ainda tem linhas apontando para `*.public.blob.vercel-storage.com`
(6 logos + 5 banners de loja, a Hakim Centro entre elas).

**Atenção:** o único Blob Store da conta é o **`hakim-images`**, e ele está
ligado ao projeto **`hakim-portal`** — que continua na Vercel. Ou seja, pausar ou
apagar o `firehub-site` NÃO quebra essas imagens. Mas enquanto elas estiverem lá,
o FireHub continua dependendo da Vercel para servir logo de loja. Em dinheiro é
irrisório (Blob Storage US$ 0,03 + Transfer US$ 0,04 no ciclo).

Rodar DENTRO do container, senão o arquivo cai na máquina errada e o site
devolve 404:

```
docker exec -it <container-firehub> node scripts/migrate-blob-to-uploads.js
docker exec -it <container-firehub> node scripts/migrate-blob-to-uploads.js --apply
```

O primeiro é dry-run. Siga só quando imprimir `restam apontando para o Blob: 0`,
e confira no navegador a logo das lojas que apareceram na lista.

### 2. Apagar o projeto — NÃO antes de resolver 7 variáveis

A pausa já zera o custo. Apagar é o passo final de "nada na Vercel", mas
**destrói junto as 22 variáveis de ambiente guardadas lá**.

Comparação feita em 02/09/2026 (Vercel: 22 variáveis · Coolify: 44). **Estas 7
existem na Vercel e NÃO no Coolify:**

| Variável | Situação | Lida pelo código? |
|---|---|---|
| `ASAAS_API_KEY` | Coolify tem `ASAAS_API_KEY_B64` (mesma chave em base64) | sim, os dois nomes |
| `RESEND_FROM_EMAIL` | Coolify tem `EMAIL_FROM` | sim, os dois nomes |
| `BLOB_READ_WRITE_TOKEN` | morre junto com o Blob | **não** — 0 usos no `src/` |
| `JOTAJA_BASE_URL` | tem default no código (`https://api.jotaja.com/openDelivery`) | sim, com fallback |
| `IFOOD_MERCHANT_ID` | sem equivalente no Coolify | sim (1 arquivo) |
| `IFOOD_MERCHANT_UUID` | sem equivalente no Coolify | sim (5 arquivos) |
| `MP_APP_ID` | sem equivalente no Coolify | sim — `client_id` do OAuth do Mercado Pago |

As quatro primeiras são seguras. **As três últimas merecem checagem por fora do
assunto Vercel**: o código lê `IFOOD_MERCHANT_UUID` em 5 lugares e `MP_APP_ID`
como `client_id` do OAuth do Mercado Pago, e nenhum dos dois está no ambiente de
produção do Coolify. Ou existe fallback no banco (o merchant do iFood hoje é por
loja), ou tem coisa rodando sem valor.

O `DATABASE_URL` guardado na Vercel aponta para o host do Neon **sem** o
`-pooler` e está quebrado, então esse não serve de backup de nada.

### 3. Limpeza de código, sem pressa

- `next.config.ts` → `images.remotePatterns` ainda libera
  `**.blob.vercel-storage.com`. Só serve enquanto existir URL do Blob no banco;
  depois do passo 1 pode sair.
- `scripts/add-env-vercel.js` e `scripts/set-vercel-db.js` — ferramentas de
  quando o deploy era lá.
- a pasta `.vercel/` local (não está no git) e os `.env.vercel*`.

## Como saber que acabou

No ciclo seguinte, `firehub-site` tem que aparecer com **US$ 0,00** no
detalhamento por projeto (Usage → Fast Origin Transfer → aba Projects). O plano
Pro continua sendo cobrado pelos outros projetos — isso é esperado.
