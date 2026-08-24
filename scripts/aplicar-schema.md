# Aplicar schema em produção (à mão)

O Dockerfile roda `next build` puro e o entrypoint não aplica schema. As duas
tentativas de automatizar isso no start do container derrubaram o cardápio em
produção — ver `5a953ac`. Enquanto os pré-requisitos de lá não forem atendidos
(healthcheck configurado e start do container reproduzido localmente), o
`db push` continua sendo feito à mão.

## Quando rodar

Depois de qualquer mudança em `prisma/schema.prisma`. Hoje há duas pendentes, e
as duas foram escritas para funcionar SEM o push — degradadas, mas sem quebrar
nada. Um único `db push` resolve as duas.

**1. `ChatbotConversationState`** — anti-loop do chatbot. Sem a tabela, o estado
por conversa vive em memória e se perde a cada restart do container.

    curl -s https://firehubfood.com.br/api/chatbot/diagnostico | grep estadoDoAntiLoop

`"memoria"` = tabela ainda não existe. `"postgres"` = já aplicada.

**2. `MenuProduct.sortOrder`** — ordem dos produtos dentro da categoria. Sem a
coluna, o cardápio continua alfabético e a tela de reordenar responde que a
ordenação ainda não foi aplicada (503, com esta instrução). O código NÃO tenta
ordenar pela coluna enquanto ela não existir — é o que evita repetir a queda
descrita abaixo.

## Como rodar

Com a `DATABASE_URL` de produção no ambiente, a partir da raiz do projeto:

    DATABASE_URL="<url do Neon>" npx prisma db push

**Sem `--accept-data-loss`.** Assim o Prisma recusa qualquer mudança destrutiva
em vez de executá-la: se a saída pedir a flag, é sinal de que o schema divergiu
do banco e alguém precisa olhar antes.

Para ver o que seria feito, sem executar:

    DATABASE_URL="<url do Neon>" npx prisma db push --preview-feature

Depois de aplicar, o anti-loop passa a usar o banco sozinho — não precisa de
novo deploy.
