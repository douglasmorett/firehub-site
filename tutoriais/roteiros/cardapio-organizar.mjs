// Tutorial 4 de 4 da tela de Cardápio (/store/cardapio): categorias, ordem e
// disponibilidade (canais, dias da semana, etiquetas, estoque).
//
// Fora do vídeo, de propósito: o botão "Adicionar Categoria" do topo (não abre
// nada nesta versão da tela) e renomear categoria (o nome muda, mas os produtos
// continuam na categoria antiga). A categoria nova é criada pelo caminho que
// funciona, de dentro do formulário do produto.
import { dormir } from "../motor/palco.mjs";
import {
  ROTA, PRONTA, linha, cabecalho, janela, canal, campo, bloco,
  abrirEdicao, esperarFechar, rolarSePreciso, rolarPaginaAte, cenaFinal,
  assentar,
} from "./_cardapio-comum.mjs";

const NOVA = "Sobremesas";
const PRODUTO = "Pizza Calabresa";
const SEGUNDO = "Pizza Marguerita";
const ALTURA_DA_LISTA = 300;

const linhaDeOrdem = (p, lista, texto) => p.locator(`[data-ordem-lista="${lista}"]`).filter({ hasText: texto }).first();
const alca = (p, lista, texto) => linhaDeOrdem(p, lista, texto).locator('span[title="Segure e arraste para mover"]');

export default {
  id: "cardapio-organizar",
  titulo: "Cardápio: categorias, ordem e disponibilidade",
  rota: ROTA,
  prontaQuando: PRONTA,
  antesDeGravar: assentar,

  cenas: [
    {
      capitulo: "O que este vídeo mostra",
      fala: "Neste vídeo do Cardápio: criar categoria, mudar a ordem do cardápio e controlar onde e quando cada produto aparece.",
      acao: async (palco) => {
        await dormir(500);
        await palco.mover({ x: 780, y: 470 }, { ms: 700 });
        await palco.rolarPagina(ALTURA_DA_LISTA);
      },
    },
    {
      capitulo: "Criar uma categoria",
      fala: "A categoria nova se cria de dentro do formulário de um produto. Clique em Criar item e, ao lado de Categoria, em Gerenciar, Nova Categoria.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const criar = cabecalho(p, "Lanches").getByRole("button", { name: "+ Criar item" });
        await ctx.ate(0.16);
        await palco.destacar(criar, { folga: 6 });
        await palco.mover(criar, { ms: 500 });
        await ctx.ate(0.36);
        await palco.apagarDestaque();
        await palco.clicar(criar);
        await janela(p).waitFor({ state: "visible", timeout: 8000 });
        const gerenciar = janela(p).getByRole("button", { name: /Gerenciar \/ Nova Categoria/ });
        await palco.camera([campo.categoria(p), gerenciar, campo.custo(p)], { zoomMax: 1.6, margem: 50 });
        await palco.destacar(gerenciar, { folga: 6 });
        await palco.mover(gerenciar, { ms: 600 });
        await ctx.ate(0.9);
        await palco.apagarDestaque();
        await palco.clicar(gerenciar);
        await ctx.ate(1);
      },
    },
    {
      fala: "Escreva o nome, troque o emoji se quiser, e clique em Adicionar Categoria. Ela já fica escolhida para o produto que você está cadastrando.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const nome = janela(p).getByPlaceholder("Nome da categoria");
        const emoji = janela(p).getByPlaceholder(/^Emoji/);
        const adicionar = janela(p).getByRole("button", { name: /Adicionar Categoria/ });
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(adicionar, { bloco: "center" });
        await palco.camera([campo.categoria(p), emoji, adicionar], { zoomMax: 1.6, margem: 50 });
        await palco.digitar(nome, NOVA);
        await palco.mover(emoji, { ms: 500 });
        await ctx.ate(0.5);
        await palco.clicar(adicionar);
        await janela(p).locator("select.input-field option:checked").filter({ hasText: NOVA }).waitFor({ state: "attached", timeout: 8000 });
        await palco.destacar(campo.categoria(p), { folga: 6 });
        await palco.mover(campo.categoria(p), { ms: 600 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      fala: "Fechando o formulário, a categoria nova já está no fim da lista, pronta para receber produtos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarAte(campo.cancelar(p), { bloco: "end" });
        await palco.clicar(campo.cancelar(p));
        await esperarFechar(palco);
        await palco.rolarPagina(5000);
        await palco.destacar(cabecalho(p, NOVA), { folga: 4 });
        await palco.mover(cabecalho(p, NOVA).getByText(NOVA), { ms: 700 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Mudar a ordem",
      fala: "Para mudar a ordem, clique em Reordenar Cardápio. À esquerda ficam as categorias: arraste pela alça, ou use as setas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(ALTURA_DA_LISTA);
        const reordenar = p.getByRole("button", { name: /Reordenar Cardápio/ });
        await palco.clicar(reordenar);
        const salvar = p.getByRole("button", { name: /Salvar Ordem do Cardápio/ });
        await salvar.waitFor({ state: "visible", timeout: 8000 });
        const coluna = p.locator(".reordenar-coluna").first();
        await palco.camera([p.getByText("Arraste pela alça"), coluna], { zoomMax: 1.35, margem: 24 });
        await ctx.ate(0.5);
        await palco.arrastar(alca(p, "categoria", "Pizzas"), alca(p, "categoria", "Lanches"));
        await ctx.ate(0.85);
        const setas = linhaDeOrdem(p, "categoria", "Bebidas").locator("button");
        await palco.destacar([setas.first(), setas.last()], { folga: 5 });
        await palco.mover(setas.first(), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique numa categoria e, à direita, arrume os produtos dela do mesmo jeito. No fim, Salvar Ordem do Cardápio. É nessa ordem que o cliente vê o cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 500 });
        await palco.clicar(linhaDeOrdem(p, "categoria", "Lanches").getByText("Lanches"));
        const terceiro = linhaDeOrdem(p, "produto", "X-Tudo");
        await terceiro.waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(0.3);
        await palco.clicar(terceiro.locator('button[title="Mover para o topo"]'));
        await palco.destacar(linhaDeOrdem(p, "produto", "X-Tudo"), { folga: 4 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        const salvar = p.getByRole("button", { name: /Salvar Ordem do Cardápio/ });
        await palco.clicar(salvar);
        await salvar.waitFor({ state: "hidden", timeout: 15_000 });
        // A lista só recarregou quando Pizzas passa a ser a primeira categoria e o X-Tudo o primeiro lanche.
        await p.waitForFunction(() => {
          const nomes = [...document.querySelectorAll("h4")].map((h) => (h.textContent || "").trim());
          return nomes.indexOf("Pizza Calabresa") >= 0 && nomes.indexOf("Pizza Calabresa") < nomes.indexOf("X-Tudo") && nomes.indexOf("X-Tudo") < nomes.indexOf("X-Burger");
        }, null, { timeout: 15_000 });
        await dormir(400);
        await rolarPaginaAte(palco, cabecalho(p, "Pizzas"), 110);
        await palco.mover(cabecalho(p, "Pizzas").getByText("Pizzas"), { ms: 700 });
        await ctx.ate(1);
        await dormir(500);
      },
    },
    {
      capitulo: "Em quais canais o produto aparece",
      fala: "Em cada produto, estes botões dizem onde ele é vendido: PDV, que é o balcão, Delivery, Totem e Garçom. Clicou, o produto sai daquele canal. Clicou de novo, volta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botoes = canal(p, PRODUTO, "PDV").locator("xpath=..");
        await palco.camera(linha(p, PRODUTO), { zoomMax: 1.5, margem: 30 });
        await palco.destacar(botoes, { folga: 6 });
        for (const [i, nome] of ["PDV", "Delivery", "Totem", "Garçom"].entries()) {
          await ctx.ate(0.3 + i * 0.09);
          await palco.mover(canal(p, PRODUTO, nome), { ms: 400 });
        }
        // O botão só muda de cor quando o servidor confirma (de 1 a 3 s): os
        // cliques vêm um pouco antes da palavra, e a cena só segue depois de a
        // cor virar — senão a fala diz "volta" e o botão ainda está apagado.
        const totem = canal(p, PRODUTO, "Totem");
        const ligado = () => totem.evaluate((el) => getComputedStyle(el).borderTopColor !== "rgb(226, 232, 240)");
        const esperar = async (estado) => { for (let i = 0; i < 60 && (await ligado()) !== estado; i++) await dormir(150); };
        await ctx.ate(0.6);
        await palco.apagarDestaque();
        await palco.clicar(totem);
        await esperar(false);
        await ctx.ate(0.8);
        await palco.clicar(totem);
        await esperar(true);
        await ctx.ate(1);
        await dormir(500);
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "Dias da semana",
      fala: "Prato que só sai em alguns dias? No lápis do produto, em Dias de Disponibilidade, clique em Dias Específicos e deixe ligados só os dias em que ele aparece no cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.12);
        await abrirEdicao(palco, PRODUTO);
        const dias = bloco(p, "Dias de Disponibilidade no Cardápio");
        await palco.rolarAte(dias, { bloco: "center" });
        await palco.camera(dias, { zoomMax: 1.5, margem: 40 });
        await ctx.ate(0.45);
        await palco.clicar(dias.getByRole("button", { name: /Dias Específicos/ }));
        await dias.locator('button[title="Segunda-feira"]').waitFor({ state: "visible", timeout: 5000 });
        await palco.rolarAte(dias, { bloco: "center" });
        await palco.camera(dias, { zoomMax: 1.5, margem: 40, ms: 400 });
        for (const dia of ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira"]) {
          await palco.clicar(dias.locator(`button[title="${dia}"]`), { ms: 380 });
        }
        await ctx.ate(1);
        await dormir(400);
      },
    },
    {
      capitulo: "Etiquetas e destaque",
      fala: "Logo acima ficam as Tags do Produto, como Novo e Mais Vendido. Marque as que quiser e salve: elas aparecem no cardápio do cliente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const tags = bloco(p, "Tags do Produto");
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(tags, { bloco: "center" });
        await palco.camera(tags, { zoomMax: 1.5, margem: 40 });
        await palco.destacar(tags, { folga: 4 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.clicar(tags.getByRole("button", { name: /Mais Vendido/ }));
        await ctx.ate(0.62);
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
        await palco.clicar(campo.salvar(p));
        await esperarFechar(palco);
        const etiqueta = linha(p, PRODUTO).getByText(/Mais Vendido/);
        await etiqueta.waitFor({ state: "visible", timeout: 10_000 });
        await rolarPaginaAte(palco, cabecalho(p, "Pizzas"), 110);
        await palco.destacar(etiqueta, { folga: 6 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "E o botão Destacar põe o produto nos Destaques da Casa, no topo do cardápio do cliente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const destacar = linha(p, PRODUTO).getByRole("button", { name: /Destacar/ });
        await palco.camera(linha(p, PRODUTO), { zoomMax: 1.3, margem: 30 });
        await palco.destacar(destacar, { folga: 5 });
        await palco.mover(destacar, { ms: 600 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.clicar(destacar);
        const destacado = linha(p, PRODUTO).getByRole("button", { name: /Destacado/ });
        await destacado.waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(destacado, { folga: 5 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "Estoque e pausa",
      fala: "Para o produto parar de vender sozinho quando acabar, clique em Estoque e digite quantos você tem. Cada venda desconta. Com o Sim marcado, zerou, ele pausa até você repor.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const l = linha(p, SEGUNDO);
        const estoque = l.getByRole("button", { name: /Estoque/ });
        await palco.camera(l, { zoomMax: 1.4, margem: 30 });
        await palco.destacar(estoque, { folga: 5 });
        await palco.mover(estoque, { ms: 600 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.clicar(estoque);
        await p.keyboard.type("12", { delay: 140 });
        await dormir(400);
        await p.keyboard.press("Enter");
        const restantes = l.getByText(/restantes/);
        await restantes.waitFor({ state: "visible", timeout: 10_000 });
        await palco.camera(l, { zoomMax: 1.4, margem: 30, ms: 400 });
        await palco.destacar(restantes.locator("xpath=.."), { folga: 5 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      fala: "E Pausar categoria pausa de uma vez todos os produtos dela. A tela pede confirmação antes.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = cabecalho(p, "Pizzas").getByRole("button", { name: /Pausar categoria/ });
        await palco.camera(cabecalho(p, "Pizzas"), { zoomMax: 1.4, margem: 40 });
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    cenaFinal("Para rever este vídeo, é só clicar em Tutorial, aqui no topo. Na janela do Tutorial ficam também os outros vídeos do cardápio: produtos, preços e combos."),
  ],
};
