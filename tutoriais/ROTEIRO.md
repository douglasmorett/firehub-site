# Como escrever um roteiro

Guia de bolso para quem vai fazer o vídeo de uma tela. O modelo pronto é `roteiros/pedidos.mjs`:
leia-o inteiro antes de começar. As regras gerais estão no `README.md` (seção 3).

## O arquivo

```js
import { dormir } from "../motor/palco.mjs";

export default {
  id: "kds",                              // nome do arquivo e da pasta de saída
  titulo: "Como usar a tela da cozinha",  // aparece no alto da janela do vídeo
  rota: "store/kds",                      // SEM barra inicial
  prontaQuando: "text=Em produção",       // seletor que prova que a tela carregou
  pronuncia: { KDS: "cá dê esse" },       // opcional: troca só para a VOZ; a legenda fica com o texto original

  // opcional: dados desta tela, por cima da loja-base (ver ambiente/semente.mjs)
  async preparar(prisma, { loja, produtos, motoboys, haMin }) { /* prisma.table.create(...) */ },

  cenas: [
    {
      capitulo: "O que é esta tela",      // opcional: abre um capítulo (plaquinha + lista ao lado do vídeo)
      fala: "Frase que a voz diz.",
      acao: async (palco, ctx) => { /* gestos */ },
      pausa: 450,                          // opcional: respiro depois da fala, em ms
    },
  ],
};
```

A cena dura o que a fala dura (mais a pausa). Se a ação demora mais que a fala, fica silêncio no
fim: prefira ação curta. `ctx.ate(0.5)` espera até a metade da fala — é como o gesto cai na palavra.

## O palco

| Chamada | O que faz |
|---|---|
| `palco.pagina` | A página do Playwright, para localizar elementos (`getByRole`, `getByText`, `locator`) |
| `await palco.mover(alvo, { ms })` | Leva a seta até o alvo (elemento ou `{ x, y }`) |
| `await palco.clicar(alvo)` | Move, clica de verdade e mostra a onda |
| `await palco.apontar(alvo)` | Move e mostra a onda SEM clicar (para `<select>` nativo; depois `selectOption`) |
| `await palco.digitar(alvo, "texto")` | Clica no campo e digita letra por letra |
| `await palco.arrastar(origem, destino)` | Arrastar e soltar de verdade |
| `await palco.destacar(alvo, { folga })` | Contorna o alvo (um ou uma lista) e escurece o resto |
| `await palco.apagarDestaque()` | Tira o destaque. Sempre apagar antes de clicar em outra coisa |
| `await palco.camera(alvo, { zoomMax, margem })` | Aproxima a câmera do alvo (um, lista, ou `{ x, y, width, height }`) |
| `await palco.cameraAberta()` | Volta a mostrar a tela inteira |
| `await palco.rolarAte(alvo, { bloco })` | Rola devagar a coluna/janela até o alvo (`center`, `start`, `end`) |
| `await palco.rolarPagina(y)` | Rola a página inteira até `y` |
| `palco.som("pedido-novo")` | Marca o aviso sonoro de pedido novo naquele instante |
| `ctx.prisma` | O banco, para fazer algo "acontecer" durante a gravação (um pedido chegar) |
| `ctx.ate(fracao)` | Espera até aquela fração da fala |
| `dormir(ms)` | Pausa |

## O passo a passo

1. **Subir o ambiente** que lhe foi dado e exportar as variáveis dele:
   `node tutoriais/ambiente/ambiente.mjs subir N` e `eval "$(node tutoriais/ambiente/ambiente.mjs variaveis N)"`.
   Todo comando abaixo precisa dessas variáveis no mesmo comando do shell.
2. **Olhar a tela:** `node tutoriais/motor/sondar.mjs store/kds foto.png` (rota sem barra inicial) e ler a foto.
   Para ver o que um clique faz, escreva um script de exploração curto (login + cliques + fotos).
3. **Ler o código da tela** em `src/app/store/...` e nos componentes: a fala só pode afirmar o que
   o código faz. Na dúvida, não diga.
4. **Escrever** `tutoriais/roteiros/<id>.mjs` (com a ferramenta de escrever arquivo, não com heredoc).
5. **Rascunho** (sem voz): `node tutoriais/produzir.mjs <id> --rascunho`. Se parar numa cena, a
   mensagem diz qual e deixa `saida/<id>/falha.png`.
6. **Revisar:** `node tutoriais/motor/revisar.mjs <id> 0.5,0.97` e LER as folhas em
   `saida/<id>/revisao/folha-NN.jpg`. Conferir: a seta está no lugar certo? o destaque pega o
   elemento inteiro? a câmera mostra o que a fala diz? nada cortado? Repetir 5 e 6 até ficar bom.
7. **Vídeo com voz:** `node tutoriais/produzir.mjs <id>`.
8. **Ouvir:** `node tutoriais/motor/ouvir.mjs <id>` tem que terminar em "trilha conferida".
9. **Limpar:** apagar `tutoriais/saida/<id>/quadros` (1 GB por vídeo). Não rodar `publicar.mjs`.

## Armadilhas já pagas

- Argumento começando com `/` vira caminho de disco no Git Bash: rota sempre sem a barra inicial.
- Heredoc com aspas quebra neste shell: arquivo se escreve com a ferramenta de escrita.
- Nada de `waitUntil: "networkidle"`: o painel consulta o servidor o tempo todo. Esperar um elemento.
- O palco não rola sozinho: alvo fora da área visível dá erro. Usar `rolarAte` antes.
- Item que muda de lista costuma ir para o FIM dela, abaixo da dobra: trabalhar com o do topo.
- `<select>` nativo não aparece na captura: `apontar` + `selectOption`.
- `alert()`/`confirm()` do navegador não aparecem no vídeo e são dispensados: evitar o caminho
  que abre um, ou mostrar só até antes dele.
- A tela é 1366×768. Janela mais alta que isso precisa de `rolarAte` dentro dela.
- Seletor por texto que aparece duas vezes pega o primeiro: ancorar no cartão/linha certa.
- Nada de serviço de fora: não aceitar pedido de iFood, não conectar WhatsApp, não emitir nota,
  não mandar e-mail. O ambiente não tem as chaves; o clique falharia na frente da câmera.

## A fala

- Português falado, de dono de loja: "a comanda sai na impressora".
- Frases curtas. Uma ideia por cena. Dizer o nome do botão como está escrito na tela.
- Abrir com o que a tela É e para que serve; fechar com
  "Para rever este vídeo, é só clicar em Tutorial, aqui no topo." apontando o botão.
- Até 3 minutos (cerca de 330 palavras). Entre 6 e 11 capítulos.
- Números e siglas como se lê: se a voz tropeçar numa sigla, usar `pronuncia`.
