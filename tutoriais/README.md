# Tutoriais em vídeo do painel

Em cada tela do painel, um botão discreto **Tutorial** na barra do topo abre um vídeo curto
mostrando como usar aquela tela: o mouse clicando, uma voz explicando, legenda e capítulos.
O objetivo é um só: o lojista tirar a dúvida sozinho, na hora, sem chamar o suporte.

Este documento é para quem vai produzir o próximo vídeo ou mexer no que já existe.

## 1. O que o lojista vê

- **Botão "Tutorial <tela>"** na barra vermelha do topo ("Tutorial Pedidos", "Tutorial KDS Cozinha"),
  sempre no mesmo lugar. Só aparece na tela que tem vídeo. Uma bolinha amarela marca o vídeo que a
  pessoa ainda não abriu; depois some. Em tela mais estreita o nome sai e fica "Tutorial".
- **Central de tutoriais** (`CentralDeTutoriais`): depois do login, abre sozinha a tela de orientação
  com todos os vídeos em sequência (um termina, o próximo começa) e o texto ensinando que o tutorial
  de cada aba fica no topo. "Fechar" vale até o próximo login; "Já vi, não mostrar mais" cala de vez
  naquele aparelho. Ao fechar, uma seta destaca o botão "Tutorial". Reabre por "Todos os tutoriais",
  na janela do vídeo de cada tela. Tem **busca** ("aplicativo do motoboy"): procura no título, nos
  capítulos e no que a voz fala (`src/lib/tutoriais-busca.json`, gerado por `indexar-busca.mjs`, que o
  `publicar.mjs` chama), sem acento, com sinônimos de loja (app = aplicativo, entregador = motoboy), e
  leva direto ao capítulo. Não abre sozinha no Totem, na tela cheia da cozinha nem para o
  suporte que entrou pelo "Acessar" do admin.
- **Janela por cima da tela**, sem sair de onde está. Fecha no X, no Esc ou clicando fora.
- **Capítulos ao lado** ("Aceitar o pedido", "Cancelar um pedido"): um clique leva direto ao ponto.
- **Legenda ligada** de saída (cozinha e balcão são barulhentos) e velocidade 1x, 1,25x e 1,5x.
- Tela grande (Cardápio) leva vários vídeos curtos, escolhidos no alto da janela.

Fora a central depois do login, nada abre sozinho, nada pisca, nada tampa a tela.

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
node tutoriais/motor/testar-janela.mjs           # prova o botão e a janela do vídeo no Chrome (desktop e celular)
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

Tela que cobre a barra do topo recebe o mesmo componente no próprio cabeçalho: a tela cheia
da cozinha (`store/kds/tela`) e a Roteirização (`RoteirizacaoModal`, com `rota` e `tom="claro"`).
O Caixa não tem tela própria: o vídeo dele aparece no Balcão (onde o caixa fechado trava a venda)
e no Histórico de caixas. Em Minha loja, a âncora da URL (`#entrega`) escolhe qual vídeo abre.

## 5. A lista

Os 28 vídeos foram aprovados pelo Douglas em 02/10/2026.

| # | Grupo | Vídeo (id) | Tela |
|---|-------|-----------|------|
| 1 | Operação | Um passeio pelo painel (`inicio`) | Início |
| 2 | Operação | Como usar a tela de Pedidos (`pedidos`) | Pedidos |
| 3 | Operação | Como usar a tela da cozinha (`kds`) | KDS da cozinha e tela cheia |
| 4 | Operação | Como usar as Mesas (`mesas`) | Mesas |
| 5 | Operação | Como vender no balcão (`balcao`) | Balcão |
| 6 | Operação | Como abrir e fechar o caixa (`caixa`) | Balcão e Histórico de caixas |
| 7 | Operação | Roteirização: montar a rota e despachar (`roteirizacao`) | Roteirização |
| 8 | Cardápio | Cadastrar e editar um produto (`cardapio-produto`) | Cardápio |
| 8b | Cardápio | Pizza com tamanhos e meio a meio (`cardapio-pizza`, 03/10/2026) | Cardápio |
| 9 | Cardápio | Preço promocional e preço por canal (`cardapio-precos`) | Cardápio |
| 10 | Cardápio | Combos e adicionais (`cardapio-combos`, refeito em 03/10/2026) | Cardápio |
| 11 | Cardápio | Categorias, ordem e disponibilidade (`cardapio-organizar`) | Cardápio |
| 12 | Vendas | Marketing e cupons (`marketing`) | Marketing & cupons |
| 13 | Vendas | Chatbot IA: o robô do WhatsApp (`chatbot`) | Chatbot IA |
| 14 | Gestão | Financeiro: quanto sobrou no mês (`financeiro`) | Financeiro |
| 15 | Gestão | Relatórios: o que cada um responde (`relatorios`) | Relatórios |
| 16 | Gestão | Fiscal: como ligar e usar a nota (`fiscal`) | Fiscal |
| 17 | Gestão | Estoque (`estoque`) | Estoque |
| 18 | Gestão | Validade e etiquetas (`etiquetas`) | Validade & etiquetas |
| 19 | Equipe | Motoboys: cadastro, app e acerto do dia (`motoboys`) | Motoboys |
| 20 | Equipe | Garçons: cadastro, link e comissão (`garcons`) | Garçons |
| 21 | Equipe | Fiado: lançar e cobrar (`fiado`) | Fiado |
| 22 | Config. | Horários e abertura automática (`horarios`) | Minha loja › Horários |
| 23 | Config. | Taxa de entrega (`entrega`) | Minha loja › Entrega |
| 24 | Config. | Formas de pagamento (`pagamento`) | Minha loja › Pagamento |
| 25 | Config. | Equipe e permissões (`equipe`) | Minha loja › Equipe |
| 26 | Config. | Fidelidade: cashback e trilha (`fidelidade`) | Minha loja › Fidelidade |
| 27 | Config. | Impressoras: o Assistente e o que cada uma imprime (`impressoras`) | Impressoras |
| 28 | Config. | Integrações: conectar iFood e 99Food (`integracoes`) | Integrações |
| 30 | Config. | Prazo automático no iFood: a extensão do Chrome (`extensao-ifood`, 03/10/2026) | Extensão iFood |

Fora dos vídeos: Totem e Tráfego pago (EM TESTES) e Checklist e ponto (FireCheck).

## 6. O ambiente de gravação

Tudo local, nada encosta em produção. Cada **ambiente numerado** tem banco PGlite e painel
próprios, para gravar vários vídeos ao mesmo tempo (toda gravação recomeça o banco do zero):

```
npx next build                                   # uma build serve a todos os ambientes
node tutoriais/ambiente/ambiente.mjs subir 1     # banco na 5461, painel (next start) na 3131
eval "$(node tutoriais/ambiente/ambiente.mjs variaveis 1)" && node tutoriais/produzir.mjs pedidos
node tutoriais/ambiente/ambiente.mjs parar 1
```

O banco fica em `C:\Users\Micro\tutoriais-teste\dados-N` (descartável). A build lê o
`.env.local` desta pasta, que não pode ter nada de produção: só `NEXT_PUBLIC_TUTORIAIS_URL=/tutoriais`
e valores locais. `next build` e `next start` brigam pelo `.next`: pare os ambientes antes de buildar.

Precisa de `ffmpeg` no PATH, do Chrome instalado e da chave `GEMINI_API_KEY` (lida do `.env` do
checkout principal, ou da variável de ambiente). A semente recusa qualquer banco que não seja local.
Para escrever um roteiro novo, siga `ROTEIRO.md`.

O relógio da gravação é sempre "noite de movimento": escolhe-se o fuso em que agora são 20h
(`ambiente/relogio.mjs`), para o vídeo nunca mostrar uma loja lotada às 4 da manhã.

## 7. Onde os vídeos ficam

Os arquivos de vídeo **não entram no repositório** (`/public/tutoriais/` está no `.gitignore`).
Em produção moram no **volume de uploads do servidor**, em `uploads/tutoriais/<id>/<versao>/`, servidos
pela rota `/uploads/[...path]` (vídeo em pedaços, legenda `.vtt`). A versão no caminho faz cada gravação
ter endereço próprio: cache eterno, e regravar nunca mostra o vídeo velho.

**O botão de uma tela só aparece quando o vídeo dela já está no disco** (`lib/tutoriais-no-servidor.ts`,
lido pelo layout do painel). Por isso o deploy do código pode ir antes dos vídeos: nada quebra, e cada
vídeo aparece sozinho quando chega.

**Enviar para o servidor:** `POST /api/admin/tutoriais` (só ADMIN), em pedaços de até 6 MB porque o proxy
do Next corta corpo acima de 10 MB. Só aceita a versão atual de um tutorial de `tutoriais-fichas.json`.
`GET /api/admin/tutoriais` diz o que já chegou. O envio é feito do navegador logado como admin
(`tutoriais/enviar-no-navegador.js`), com os arquivos preparados por `tutoriais/preparar-envio.mjs`.

A gravação local usa `NEXT_PUBLIC_TUTORIAIS_URL=/tutoriais` (a pasta public). Para um armazenamento
externo (ex.: Cloudflare R2), basta a variável com o endereço dele. Vídeo não precisa de backup: é
regerável pelo roteiro.

## 8. Custo e manutenção

- **Voz:** centavos de dólar por vídeo (Gemini TTS + a transcrição de conferência).
- **Tela mudou:** rodar `produzir.mjs` de novo. Se falhar numa cena, ajustar o roteiro ali.
- **Rotina sugerida:** rodar `--rascunho` de todos os roteiros antes de um deploy grande; o que
  falhar é tutorial que ficou velho.
- **Voz e ritmo** ficam em `motor/narrar.mjs` (`VOZ`). Trocar a voz regrava todas as falas.
