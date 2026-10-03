// Tutorial 1 de 4 da tela de Cardápio (/store/cardapio): cadastrar, editar e
// pausar um produto, e onde isso aparece para o cliente.
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
import { dormir, BASE } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";
import {
  ROTA, PRONTA, linha, cabecalho, janela, lapis, pausar, botaoDaLinha, campo,
  abrirEdicao, esperarFechar, redigitar, rolarSePreciso, cenaFinal, caixa, voltarAoPainel,
  assentar, perguntaDoNovoItem, botaoOutroItem, botaoPizza,
} from "./_cardapio-comum.mjs";

const NOVO = "Misto Quente";
/** A lista rolada até a categoria Lanches ficar no alto: cabem as quatro linhas dela. */
const ALTURA_DA_LISTA = 300;

export default {
  id: "cardapio-produto",
  titulo: "Cardápio: cadastrar e editar um produto",
  rota: ROTA,
  prontaQuando: PRONTA,
  antesDeGravar: assentar,

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela do Cardápio. É aqui que você cadastra tudo o que a loja vende. Neste vídeo: como cadastrar, editar e pausar um produto.",
      acao: async (palco) => {
        await dormir(900);
        await palco.mover({ x: 780, y: 470 }, { ms: 1300 });
      },
    },
    {
      capitulo: "A lista de produtos",
      fala: "Os produtos ficam separados por categoria. Cada linha é um produto, com a foto, o nome, a descrição e o preço.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(ALTURA_DA_LISTA);
        const l = linha(p, "X-Burger");
        await palco.camera([cabecalho(p, "Lanches"), linha(p, "X-Tudo")], { zoomMax: 1.5, margem: 24 });
        await palco.mover(cabecalho(p, "Lanches").getByText("Lanches"), { ms: 600 });
        await ctx.ate(0.32);
        await palco.destacar(l, { folga: 5 });
        await ctx.ate(0.62);
        await palco.mover(l.locator("h4"), { ms: 500 });
        await ctx.ate(0.78);
        await palco.mover(l.getByText("Pão, hambúrguer de 150 g e queijo"), { ms: 400 });
        await ctx.ate(0.92);
        await palco.mover(l.getByText("R$ 22,00"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "A busca, aqui em cima, acha um produto pelo nome.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 500 });
        const busca = p.getByPlaceholder(/Buscar produto por nome/);
        await palco.digitar(busca, "batata");
        await ctx.ate(1);
        await dormir(900);
        await busca.fill("");
        await dormir(400);
        // Com a lista curta a página encolhe e volta ao topo: devolve à altura da lista.
        await rolarSePreciso(palco, ALTURA_DA_LISTA);
      },
    },
    {
      capitulo: "Cadastrar um produto",
      fala: "Para cadastrar, clique em Criar item, na categoria onde o produto vai ficar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const criar = cabecalho(p, "Lanches").getByRole("button", { name: "+ Criar item" });
        await palco.destacar(criar, { folga: 6 });
        await palco.mover(criar, { ms: 700 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        await palco.clicar(criar);
        await perguntaDoNovoItem(p).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Antes, o sistema pergunta o que você vai cadastrar. Pizza tem um passo a passo só dela, com vídeo próprio. Combo tem o botão Novo Combo. Para lanche, porção ou bebida, clique em Outro item.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const caixaDoCombo = perguntaDoNovoItem(p).locator(".fh-pz-combo");
        await palco.camera(perguntaDoNovoItem(p), { zoomMax: 1.25, margem: 16 });
        await ctx.ate(0.2);
        await palco.destacar(botaoPizza(p), { folga: 4 });
        await palco.mover(botaoPizza(p), { ms: 600 });
        await ctx.ate(0.5);
        await palco.destacar(caixaDoCombo, { folga: 4 });
        await palco.mover(caixaDoCombo.getByText("Novo Combo", { exact: true }), { ms: 600 });
        await ctx.ate(0.7);
        await palco.destacar(botaoOutroItem(p), { folga: 4 });
        await palco.mover(botaoOutroItem(p), { ms: 600 });
        await ctx.ate(0.92);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
        await palco.clicar(botaoOutroItem(p));
        await janela(p).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Escreva o nome do produto e o preço de venda. A categoria já vem escolhida, e dá para trocar aqui.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([campo.nome(p), campo.preco(p), campo.categoria(p)], { zoomMax: 1.45, margem: 44 });
        await palco.digitar(campo.nome(p), NOVO);
        await palco.digitar(campo.preco(p), "14");
        await ctx.ate(0.7);
        await palco.destacar(campo.categoria(p), { folga: 6 });
        await palco.mover(campo.categoria(p), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "A foto",
      fala: "Para a foto, clique em Inserir Foto e escolha a imagem no seu computador.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const foto = janela(p).locator('label[for="hero-photo-file-input"]');
        await palco.camera([janela(p).getByText("SEM FOTO"), foto, janela(p).getByRole("button", { name: /Inserir Link/ })], { zoomMax: 1.7, margem: 50 });
        await palco.destacar(foto, { folga: 6 });
        await palco.mover(foto, { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Descrição e comanda",
      fala: "Na descrição, conte o que vem no produto: é o texto que o cliente lê embaixo do nome. Sem nome, preço e descrição, o produto não salva.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(campo.descricao(p), { bloco: "center" });
        await palco.camera(campo.descricao(p), { zoomMax: 1.5, margem: 60 });
        await palco.digitar(campo.descricao(p), "Pão de forma, presunto e queijo na chapa");
        await ctx.ate(1);
      },
    },
    {
      fala: "Se for bebida, marque esta caixa: a comanda impressa sai com o aviso de bebida, para ninguém esquecer o item.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bebida = janela(p).locator("label").filter({ hasText: "Sinalizar como BEBIDA" });
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(bebida, { bloco: "center" });
        await palco.camera(bebida, { zoomMax: 1.5, margem: 50 });
        await palco.destacar(bebida, { folga: 10 });
        await palco.mover(bebida.locator("input"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Para terminar, clique em Cadastrar Produto. Ele já entra na lista.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
        await ctx.ate(0.3);
        await palco.clicar(campo.salvar(p));
        await esperarFechar(palco);
        await linha(p, NOVO).waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(linha(p, NOVO), { folga: 5 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Editar um produto",
      fala: "Para mudar qualquer coisa de um produto, clique no lápis da linha dele.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botoes = caixa(1050, (await linha(p, NOVO).boundingBox()).y - 6, 300, 90);
        await palco.camera(botoes, { zoomMax: 1.8, margem: 60 });
        await palco.destacar(lapis(p, NOVO), { folga: 5 });
        await palco.mover(lapis(p, NOVO), { ms: 700 });
        await ctx.ate(0.75);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
        await abrirEdicao(palco, NOVO);
        await ctx.ate(1);
      },
    },
    {
      fala: "O formulário abre preenchido. Troque o que precisar, o preço por exemplo, e clique em Salvar Alterações.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([campo.nome(p), campo.preco(p)], { zoomMax: 1.5, margem: 50 });
        await ctx.ate(0.25);
        await redigitar(palco, campo.preco(p), "15");
        await ctx.ate(0.6);
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
        await palco.clicar(campo.salvar(p));
        await ctx.ate(1);
      },
    },
    {
      // A espera pelo servidor (fechar o formulário e a lista voltar com o
      // preço novo) cai durante esta fala: numa cena só, quando o servidor de
      // gravação demorava, sobrava tela parada depois da fala.
      fala: "Pronto: na lista, o produto já aparece com o preço novo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await esperarFechar(palco);
        await linha(p, NOVO).getByText("R$ 15,00").waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(linha(p, NOVO).getByText("R$ 15,00"), { folga: 8 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Pausar e ativar",
      fala: "Acabou um ingrediente? Clique no botão de pausar. O produto fica marcado como pausado e sai de venda, em todos os canais, até você ativar de novo no mesmo botão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const l = linha(p, "X-Tudo");
        await rolarSePreciso(palco, ALTURA_DA_LISTA);
        await palco.camera([linha(p, "X-Bacon"), l], { zoomMax: 1.2, margem: 16 });
        await palco.destacar(pausar(p, "X-Tudo"), { folga: 5 });
        await palco.mover(pausar(p, "X-Tudo"), { ms: 700 });
        await ctx.ate(0.2);
        await palco.apagarDestaque();
        await palco.clicar(pausar(p, "X-Tudo"));
        await l.getByText("PAUSADO").waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(l, { folga: 5 });
        await palco.mover(l.getByText("PAUSADO"), { ms: 700 });
        await ctx.ate(0.8);
        await palco.apagarDestaque();
        await palco.mover(pausar(p, "X-Tudo"), { ms: 700 });
        await ctx.ate(1);
      },
    },
    {
      fala: "A lixeira é para excluir o produto. Se é só por um tempo, prefira pausar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const lixeira = botaoDaLinha(p, "X-Bacon", "Excluir produto");
        await palco.destacar(lixeira, { folga: 5 });
        await palco.mover(lixeira, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Como o cliente vê",
      fala: "Para conferir como ficou para o cliente, clique em Ver cardápio e em Abrir o cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const ver = p.getByRole("button", { name: /Ver cardápio/ }).first();
        await ctx.ate(0.4);
        await palco.clicar(ver);
        const abrir = p.getByText("Abrir o cardápio");
        await abrir.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera([ver, abrir], { zoomMax: 1.6, margem: 80 });
        await palco.destacar(abrir, { folga: 8 });
        await ctx.ate(0.85);
        await palco.apagarDestaque();
        // O link abre em outra aba; a gravação segue nesta, então a aba nova é
        // fechada e o mesmo endereço é aberto aqui.
        p.context().once("page", (nova) => nova.close().catch(() => {}));
        await palco.clicar(abrir);
        await palco.cameraAberta({ ms: 300 });
        await p.goto(`${BASE}/loja/${LOJA.slug}`, { waitUntil: "load" });
        await p.getByText(NOVO, { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Este é o cardápio que o cliente vê. O produto que cadastramos está aqui, com o preço novo, e o lanche que pausamos não aparece. Produto novo e mudança de preço podem levar até um minuto para chegar aqui.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const nome = p.getByText(NOVO, { exact: true }).first();
        const c = await nome.boundingBox();
        const cartao = caixa(c.x - 82, c.y - 22, 880, 96);
        await palco.camera(caixa(100, 240, 900, 460), { zoomMax: 1.35, margem: 20 });
        await ctx.ate(0.17);
        await palco.destacar(cartao, { folga: 4 });
        await palco.mover(nome, { ms: 600 });
        await ctx.ate(0.46);
        await palco.apagarDestaque();
        await palco.mover(p.getByText("X-Bacon", { exact: true }).first(), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.cameraAberta({ ms: 300 });
        await voltarAoPainel(palco);
      },
    },
    cenaFinal("Para rever este vídeo, é só clicar em Tutorial, aqui no topo. Na janela do Tutorial ficam também os outros vídeos do cardápio: pizza, combos, preços e organização."),
  ],
};
