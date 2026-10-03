// Tutorial da tela /store/extensao-ifood: a extensão do Chrome que muda sozinha
// o prazo de entrega no iFood (firehub-ifood-extension/).
//
// O vídeo percorre a própria tela, que já desenha cada passo (Chrome, o 🔥, o
// login, a aba do iFood, o robô). NÃO abre o portal do iFood de verdade: ele
// mostraria pedidos e dados de uma loja real num vídeo que todo lojista vê.
//
// O que a fala afirma está na página e na extensão: o prazo sai da tabela de
// 4 pedidos por motoboy (28/38/58/78 min, background.js); a extensão escreve SÓ
// no iFood, NÃO pausa a loja e NUNCA abre aba sozinha. O passo 1 é o da loja do
// Google (aprovada em 03/10/2026): Abrir na Chrome Web Store → Usar no Chrome.
// A instalação e a extensão mexendo no iFood ao vivo estão no outro vídeo da
// tela (extensao-ifood-ao-vivo).
import { dormir } from "../motor/palco.mjs";
import { assentar } from "./_cardapio-comum.mjs";

const secao = (p, titulo) => p.getByRole("heading", { name: titulo }).locator("xpath=..");
const passo = (p, n) => p.locator(".eta-passo").nth(n - 1);

export default {
  id: "extensao-ifood",
  titulo: "Prazo automático no iFood: a extensão do Chrome",
  rota: "store/extensao-ifood",
  prontaQuando: "text=PRAZO AUTOMÁTICO NO IFOOD",
  antesDeGravar: assentar,
  pronuncia: { "58 minutos": "cinquenta e oito minutos", "78": "setenta e oito", "4 pedidos": "quatro pedidos" },

  cenas: [
    {
      capitulo: "O que é",
      fala: "Esta é a tela da extensão de prazo automático. Ela muda sozinha o tempo de entrega da sua loja no iFood, conforme a fila da cozinha: encheu de pedido, o prazo sobe; esvaziou, ele desce.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByRole("heading", { level: 1 });
        await dormir(400);
        await palco.destacar(titulo, { folga: 8 });
        await palco.mover(titulo, { ms: 800 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.mover(p.getByText(/FireHub: 58 min/).first(), { ms: 700 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Como funciona",
      fala: "Funciona assim: o FireHub conta os pedidos em produção, a extensão calcula o prazo, e muda o prazo no iFood, pelo Portal do Parceiro. Ela confere a fila a cada minuto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const fluxo = p.getByText("Três coisas acontecendo sozinhas, o dia inteiro").locator("xpath=../..");
        await palco.rolarAte(fluxo, { bloco: "start" });
        await palco.camera(fluxo, { zoomMax: 1.3, margem: 20 });
        await palco.destacar(fluxo, { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "O que você precisa",
      fala: "Você vai precisar do computador do caixa com o Google Chrome, do seu login do FireHub, do login do iFood da loja, e de saber quantos motoboys tem hoje.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const caixa = secao(p, "O que você precisa ter em mãos");
        await palco.rolarAte(caixa, { bloco: "center" });
        await palco.camera(caixa, { zoomMax: 1.35, margem: 16 });
        for (const [i, nome] of ["O computador do caixa", "Seu login do FireHub", "O login do iFood", "Quantos motoboys tem hoje"].entries()) {
          await ctx.ate(0.08 + i * 0.22);
          await palco.destacar(p.getByText(nome, { exact: true }).locator("xpath=.."), { folga: 4 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "Instalar",
      fala: "O passo a passo tem cinco passos, e você faz uma vez só, no computador do caixa. No primeiro, clique em Abrir na Chrome Web Store, e lá em Usar no Chrome e Adicionar extensão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByRole("heading", { name: "Configure uma vez, em 5 passos" });
        await palco.rolarAte(titulo, { bloco: "start" });
        await palco.destacar(titulo, { folga: 6 });
        await ctx.ate(0.4);
        const botao = p.getByRole("link", { name: /Abrir na Chrome Web Store/ });
        await palco.rolarAte(passo(p, 1), { bloco: "center" });
        await palco.destacar(passo(p, 1), { folga: 4 });
        await ctx.ate(0.72);
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Fixar o ícone",
      fala: "Depois, deixe o ícone de fogo sempre à vista: na peça de quebra-cabeça do Chrome, clique no alfinete ao lado da extensão do FireHub.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(passo(p, 2), { bloco: "center" });
        await palco.camera(passo(p, 2), { zoomMax: 1.3, margem: 10 });
        await palco.destacar(passo(p, 2), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "Entrar",
      fala: "Clique no ícone de fogo e entre com o mesmo e-mail e a mesma senha do FireHub. Depois, Entrar e Conectar Loja. É uma vez só.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(passo(p, 3), { bloco: "center" });
        await palco.camera(passo(p, 3), { zoomMax: 1.3, margem: 10 });
        await palco.destacar(passo(p, 3), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "A aba do iFood",
      fala: "Abra a tela de Entrega do iFood por este botão, entre com o login da loja, e não feche essa aba. Ela pode ficar atrás das outras. Deixe aberta também a tela de pedidos do FireHub.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("link", { name: /Abrir a tela de Entrega do iFood/ });
        await palco.rolarAte(passo(p, 4), { bloco: "center" });
        await palco.camera(passo(p, 4), { zoomMax: 1.3, margem: 10 });
        await ctx.ate(0.12);
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 700 });
        await ctx.ate(0.5);
        await palco.destacar(passo(p, 4), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "Motoboys e robô",
      fala: "Por último, no ícone de fogo, diga quantos motoboys tem na casa, no menos e no mais, e ligue a chave Robô Automático. Ela fica verde, e o prazo passa a acompanhar a cozinha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(passo(p, 5), { bloco: "center" });
        await palco.camera(passo(p, 5), { zoomMax: 1.3, margem: 10 });
        await palco.destacar(passo(p, 5), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      fala: "Para saber que está funcionando: na tela de pedidos do FireHub aparece esta pílula, com o prazo e os pedidos em produção.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const conferir = p.getByText("Como saber que está funcionando").locator("xpath=..");
        await palco.rolarAte(conferir, { bloco: "center" });
        await palco.camera(conferir, { zoomMax: 1.4, margem: 16 });
        await palco.destacar(conferir, { folga: 4 });
        await ctx.ate(0.6);
        await palco.mover(conferir.getByText(/FireHub: 38 min/), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "Como o prazo é escolhido",
      fala: "Cada motoboy dá conta de até 4 pedidos na fila. Aqui, três motoboys e sete pedidos: o iFood fica em 58 minutos. Com um motoboy a menos, o prazo sobe para 78.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const regra = p.locator("#regra");
        const resultado = regra.getByText(/o iFood fica em/).locator("xpath=..");
        await palco.rolarAte(regra.getByRole("heading"), { bloco: "start" });
        await palco.camera(regra, { zoomMax: 1.2, margem: 10 });
        await ctx.ate(0.3);
        await palco.destacar(resultado, { folga: 6 });
        await ctx.ate(0.68);
        await palco.apagarDestaque();
        await palco.clicar(regra.getByRole("button", { name: "2", exact: true }));
        await regra.getByText("78 min", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
        await palco.destacar(resultado, { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Atenção: a extensão não pausa a loja sozinha. Passou do limite, o prazo fica no máximo e a pílula fica vermelha. Pausar ou não, você decide no próprio iFood.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // O último bloco da seção #regra é o aviso vermelho "não pausa a loja sozinha".
        const aviso = p.locator("#regra > div").last();
        await palco.rolarAte(aviso, { bloco: "center" });
        await palco.camera(aviso, { zoomMax: 1.5, margem: 24 });
        await palco.destacar(aviso, { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "No dia a dia",
      fala: "No dia a dia: ao abrir a loja, deixe abertas a tela de pedidos e a tela de Entrega do iFood, e confira os motoboys. Quando um motoboy sair ou chegar, ajuste no ícone de fogo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const dia = secao(p, "O que fazer em cada turno");
        await palco.rolarAte(dia, { bloco: "center" });
        await palco.camera(dia, { zoomMax: 1.3, margem: 14 });
        await ctx.ate(0.1);
        await palco.destacar(p.getByText("Ao abrir a loja", { exact: true }).locator("xpath=../.."), { folga: 4 });
        await ctx.ate(0.62);
        await palco.destacar(p.getByText("Quando um motoboy sai ou chega", { exact: true }).locator("xpath=../.."), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "Se aparecer um aviso",
      fala: "Se aparecer um aviso, aqui embaixo está o que cada um quer dizer e como resolver. E se travar em algum passo, chame a gente no WhatsApp: a equipe configura junto com você.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const avisos = secao(p, "O que cada aviso quer dizer");
        await palco.rolarAte(avisos, { bloco: "start" });
        const primeiro = p.getByText("“O Portal iFood foi desconectado!”");
        await palco.clicar(primeiro);
        await p.getByText(/Reconectar no iFood/).first().waitFor({ state: "visible", timeout: 5000 });
        await palco.destacar(primeiro.locator("xpath=.."), { folga: 4 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        const whats = p.getByRole("link", { name: /Chamar no WhatsApp/ });
        await palco.rolarAte(whats, { bloco: "center" });
        await palco.destacar(whats, { folga: 6 });
        await palco.mover(whats, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Para rever este vídeo, é só clicar em Tutoriais em vídeo, aqui no menu. Lá ficam todos os vídeos do FireHub.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const botao = p.getByRole("button", { name: "Tutoriais em vídeo" });
        await ctx.ate(0.12);
        await palco.camera(botao, { zoomMax: 1.7, margem: 80 });
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 900 });
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
      pausa: 600,
    },
  ],
};
