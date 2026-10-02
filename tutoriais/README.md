# Tutoriais em vídeo do painel

Em cada tela do painel, um botão discreto **Tutorial** na barra do topo abre um vídeo curto
mostrando como usar aquela tela: o mouse clicando, uma voz explicando, legenda e capítulos.
O objetivo é um só: o lojista tirar a dúvida sozinho, na hora, sem chamar o suporte.

Este documento é para quem vai produzir o próximo vídeo ou mexer no que já existe.

## 1. O que o lojista vê

- **Botão "Tutorial"** na barra vermelha do topo, sempre no mesmo lugar. Só aparece na tela que
  tem vídeo. Uma bolinha amarela marca o vídeo que a pessoa ainda não abriu; depois some.
- **Janela por cima da tela**, sem sair de onde está. Fecha no X, no Esc ou clicando fora.
- **Capítulos ao lado** ("Aceitar o pedido", "Cancelar um pedido"): um clique leva direto ao ponto.
- **Legenda ligada** de saída (cozinha e balcão são barulhentos) e velocidade 1x, 1,25x e 1,5x.
- Tela grande (Cardápio) leva vários vídeos curtos, escolhidos no alto da janela.

Nada abre sozinho, nada pisca, nada tampa a tela. É ajuda para quem procura.

## 2. Como um vídeo é feito: tutorial é código

Ninguém grava a tela à mão. Cada vídeo é um **roteiro** (`roteiros/<tela>.mjs`): uma lista de
cenas, cada uma com a **fala** e a **ação** (mover o mouse, clicar, destacar, aproximar a câmera).
Um comando faz o resto:

```
node tutoriais/produzir.mjs pedidos              # vídeo completo
node tutoriais/produzir.mjs pedidos --rascunho   # sem voz: rápido e de graça, para acertar os movimentos
node tutoriais/produzir.mjs pedidos --so-montar  # remonta a gravação que já existe
node tutoriais/motor/revisar.mjs pedidos         # folhas de contato: fotos de cada cena para revisar
node tutoriais/motor/ouvir.mjs pedidos           # transcreve a trilha pronta e confere cada fala com o roteiro
node tutoriais/publicar.mjs pedidos              # depois de APROVADO: leva para o painel
```

O que o comando faz, em ordem:

1. **Voz** (`motor/narrar.mjs`): cada fala vira áudio pela voz sintética do Gemini. O áudio é
   transcrito de volta e comparado com o texto; fala errada, com sotaque de Portugal ou fora do
   ritmo é refeita. Áudio já gerado fica guardado: regravar a tela não gasta voz.
2. **Loja fictícia** (`ambiente/semente.mjs`): banco local descartável, sempre do zero, com a loja
   "Sabor da Praça". Nenhum cliente, telefone ou valor de loja real aparece em vídeo.
3. **Gravação** (`motor/palco.mjs`): navegador sem janela, seta desenhada, onda no clique, destaque
   que escurece o resto. Cada cena dura o que a fala dura; `ctx.ate(0.5)` faz o gesto cair na
   palavra certa. A captura é quadro a quadro, com o dobro de pontos.
4. **Montagem** (`motor/montar.mjs`): aplica a câmera (a aproximação é um recorte sobre os quadros,
   não distorce a página), põe a voz no tempo, a plaquinha do capítulo, o som de pedido novo, e
   gera `video.mp4`, `capa.jpg`, `legendas.vtt` e `tutorial.json` em `tutoriais/saida/<tela>/`.

**Por que assim:** o painel muda toda semana. Vídeo gravado à mão envelhece no primeiro botão
que troca de lugar, e ninguém regrava trinta vídeos. Com roteiro, regravar é rodar o comando. E se
a tela mudou a ponto de um botão do roteiro não existir mais, a gravação **para e diz em qual
cena** — é o aviso de que aquele tutorial ficou velho.

## 3. Regras do roteiro

- **A fala só afirma o que a tela faz de verdade naquela gravação.** Se descreve um clique, o
  clique acontece na imagem. Na dúvida sobre uma regra, ler o código antes de escrever a frase.
- **Até 3 minutos.** Passou disso, vira dois vídeos. Um capítulo por assunto.
- **Linguagem de dono de loja**, não de sistema: "a comanda sai na impressora", não "dispara o job".
- **Uma ideia por cena.** Fala curta, um gesto, pausa.
- **Usar o cartão/linha do topo.** O que está no meio da lista fica abaixo da dobra da tela.
- **Rolagem aparece** (`palco.rolarAte`): a tela nunca "pula" sozinha.
- **Lista nativa** (`<select>`) não aparece na captura: usar `palco.apontar` + `selectOption`.
- **Nada que saia da loja fictícia:** não clicar em aceitar/despachar pedido de iFood, não mandar
  WhatsApp, não emitir nota. O ambiente local nem tem as chaves, de propósito.
- **Fora dos vídeos:** Checklist e ponto (é o FireCheck, produto à parte) e telas "EM TESTES"
  (Totem, Tráfego pago) até estabilizarem.

## 4. Ligar o vídeo à tela

`src/lib/tutoriais.ts` tem o mapa **rota → vídeos**. Vídeo novo = uma linha em `TELAS`.
O botão (`src/components/TutorialDaTela.tsx`) mora uma vez só, na barra do topo
(`StoreTopNav`), e descobre o vídeo pela rota. Título, duração e capítulos vêm de
`src/lib/tutoriais-fichas.json`, escrito pelo `publicar.mjs` (não editar à mão).

Tela que não mostra a barra do topo (KDS em tela cheia, mesa no celular) recebe o mesmo
componente dentro da própria página.

## 5. A lista, em ordem

Ordem pelo que mais gera dúvida no dia a dia. Cada linha é um vídeo de até 3 minutos.

| # | Tela | Vídeo | Estado |
|---|------|-------|--------|
| 1 | Pedidos | Como usar a tela de Pedidos | **piloto, aguardando aprovação** |
| 2 | KDS da cozinha | A tela da cozinha: produção, pronto e desfazer | a fazer |
| 3 | Mesas | Abrir mesa, lançar pedido e fechar a conta | a fazer |
| 4 | Balcão | Lançar uma venda no balcão, do produto ao pagamento | a fazer |
| 5 | Caixa | Abrir e fechar o caixa, sangria e conferência | a fazer |
| 6 | Cardápio | Cadastrar e editar um produto (nome, preço, foto, pausar) | a fazer |
| 7 | Cardápio | Preço promocional e preço por canal | a fazer |
| 8 | Cardápio | Combos, adicionais, sabores e meio a meio | a fazer |
| 9 | Cardápio | Categorias, ordem e disponibilidade (dias, canais, esgotado) | a fazer |
| 10 | Fiscal | Ligar a NFC-e, automática ou manual, e emitir pelo pedido | a fazer |
| 11 | Impressoras | Instalar o Assistente e escolher o que cada impressora imprime | a fazer |
| 12 | Minha loja › Entrega | Taxa de entrega: bairros, raio, km e área de atendimento | a fazer |
| 13 | Minha loja › Horários | Horários e abertura automática | a fazer |
| 14 | Minha loja › Pagamento | Formas de pagamento e Pix online | a fazer |
| 15 | Integrações | Conectar iFood e 99Food | a fazer |
| 16 | Chatbot IA | Conectar o WhatsApp e o que o robô faz | a fazer |
| 17 | Roteirização | Montar a rota e despachar os motoboys | a fazer |
| 18 | Motoboys | Cadastro, app do entregador e acerto do dia | a fazer |
| 19 | Garçons | Link do garçom, QR da mesa e comissão | a fazer |
| 20 | Minha loja › Equipe | Criar funcionário e escolher as telas dele | a fazer |
| 21 | Marketing & cupons | Criar cupom e campanha | a fazer |
| 22 | Minha loja › Fidelidade | Cashback e trilha premiada | a fazer |
| 23 | Estoque | Controle de estoque e reposição | a fazer |
| 24 | Financeiro | Ler o DRE: quanto sobrou no mês | a fazer |
| 25 | Relatórios | Os relatórios e o que cada um responde | a fazer |
| 26 | Validade & etiquetas | Imprimir etiqueta de validade | a fazer |
| 27 | Fiado | Lançar e cobrar fiado | a fazer |
| 28 | Início | Um passeio pelo painel em 2 minutos | a fazer (por último: mostra as outras telas prontas) |

Cada vídeo novo pede três coisas: os dados daquela tela na semente (mesas, produtos com opção,
caixa com movimento), o roteiro, e a revisão das folhas de contato antes de gastar com a voz.

## 6. O ambiente de gravação

Tudo local, nada encosta em produção:

```
# 1. banco descartável (pasta fora do repositório)
cd C:\Users\Micro\tutoriais-teste && npx pglite-server --db=./dados --port=5451 --max-connections=10

# 2. .env.local desta pasta (NÃO pode haver .env de produção aqui)
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5451/postgres?sslmode=disable&connection_limit=1&pgbouncer=true"
NEXTAUTH_SECRET=tutoriais-local
NEXTAUTH_URL=http://localhost:3121
COTACAO_SECRET=tutoriais-local
NEXT_PUBLIC_TUTORIAIS_URL=/tutoriais

# 3. tabelas e painel
npx prisma db push --skip-generate && npx next dev -p 3121
```

Precisa de `ffmpeg` no PATH e da chave `GEMINI_API_KEY` (lida do `.env` do checkout principal,
ou da variável de ambiente). A semente recusa qualquer banco que não seja local.

O relógio da gravação é sempre "noite de movimento": escolhe-se o fuso em que agora são 20h
(`ambiente/relogio.mjs`), para o vídeo nunca mostrar uma loja lotada às 4 da manhã.

## 7. Onde os vídeos ficam (decisão em aberto)

Os arquivos de vídeo **não entram no repositório** (`/public/tutoriais/` está no `.gitignore`).
O painel busca em `NEXT_PUBLIC_TUTORIAIS_URL`. **Sem a variável, nenhum botão aparece**: publicar
este código antes de decidir a hospedagem não muda nada para o lojista.

| Opção | A favor | Contra |
|-------|---------|--------|
| **Armazenamento externo** (Cloudflare R2 ou parecido) — recomendado | Não pesa no servidor; envio por script; player próprio | Criar a conta e o bucket uma vez |
| Pasta `public/` do site | Nada a configurar | ~8 MB por vídeo no repositório e na imagem; vídeo servido pelo mesmo Node que já aperta no pico |
| Volume de uploads do servidor | Fora do repositório | Mesma carga no Node; envio manual ao servidor |
| YouTube não listado | Grátis, leve em qualquer internet | Perde capítulos e legenda próprios, mostra marca do YouTube, regravar muda o link |

Vídeo não precisa de backup: é regerável pelo roteiro.

## 8. Custo e manutenção

- **Voz:** centavos de dólar por vídeo (Gemini TTS + a transcrição de conferência).
- **Tela mudou:** rodar `produzir.mjs` de novo. Se falhar numa cena, ajustar o roteiro ali.
- **Rotina sugerida:** rodar `--rascunho` de todos os roteiros antes de um deploy grande; o que
  falhar é tutorial que ficou velho.
- **Voz e ritmo** ficam em `motor/narrar.mjs` (`VOZ`). Trocar a voz regrava todas as falas.
