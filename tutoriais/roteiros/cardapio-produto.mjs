// Tutorial 1 de 4 da tela de Cardápio (/store/cardapio): cadastrar, editar e
// pausar um produto (cadastro em 3 passos, etiqueta do preço, menu ⋮), e onde
// isso aparece para o cliente. Refeito em 08/11/2026 para a tela no modelo do iFood.
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
import { dormir, BASE } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";
import {
  ROTA, PRONTA, linha, cabecalho, janela, pausar, campo, maisAcoes, itemDoMenu, etiquetaDoPreco,
  abaDoFormulario, esperarFechar, redigitar, rolarSePreciso, cenaFinal, caixa, voltarAoPainel,
  assentar, perguntaDoNovoItem, botaoOutroItem, botaoPizza, fecharMenu,
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
      fala: "Para cadastrar, clique em Adicionar produto, na categoria onde ele vai ficar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const criar = cabecalho(p, "Lanches").getByRole("button", { name: "+ Adicionar produto" });
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
      fala: "O cadastro tem três passos, como no iFood: sobre o produto, preço e onde ele aparece.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const passos = [abaDoFormulario(p, "Sobre o produto"), abaDoFormulario(p, "Disponível em")];
        await palco.camera(passos, { zoomMax: 1.8, margem: 40 });
        await palco.destacar(passos, { folga: 6 });
        await palco.mover(abaDoFormulario(p, "Sobre o produto"), { ms: 600 });
        await ctx.ate(0.6);
        await palco.mover(abaDoFormulario(p, "Preço"), { ms: 400 });
        await ctx.ate(0.8);
        await palco.mover(abaDoFormulario(p, "Disponível em"), { ms: 400 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Sobre o produto",
      fala: "No primeiro passo, escreva o nome. A categoria já vem escolhida, e dá para trocar aqui.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([campo.nome(p), campo.categoria(p)], { zoomMax: 1.45, margem: 44 });
        await palco.digitar(campo.nome(p), NOVO);
        await ctx.ate(0.6);
        await palco.destacar(campo.categoria(p), { folga: 6 });
        await palco.mover(campo.categoria(p), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
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
      fala: "Na descrição, conte o que vem no produto: é o texto que o cliente lê embaixo do nome.",
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
      fala: "Se for bebida, marque esta caixa: a comanda impressa sai com o aviso de bebida, para ninguém esquecer o item. Depois, clique em Continuar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bebida = janela(p).locator("label").filter({ hasText: "Sinalizar como BEBIDA" });
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(bebida, { bloco: "center" });
        await palco.camera(bebida, { zoomMax: 1.5, margem: 50 });
        await palco.destacar(bebida, { folga: 10 });
        await palco.mover(bebida.locator("input"), { ms: 700 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(campo.continuar(p), { bloco: "end" });
        await palco.clicar(campo.continuar(p));
        await campo.preco(p).waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Preço",
      fala: "No segundo passo vai o preço de venda. A promoção e o preço por canal também ficam aqui, e têm um vídeo só deles. Clique em Continuar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([campo.preco(p), campo.faixaDaPromo(p)], { zoomMax: 1.45, margem: 44 });
        await palco.digitar(campo.preco(p), "14");
        await ctx.ate(0.4);
        await palco.destacar(campo.faixaDaPromo(p), { folga: 6 });
        await ctx.ate(0.8);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(campo.continuar(p), { bloco: "end" });
        await palco.clicar(campo.continuar(p));
        await campo.salvar(p).waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Onde aparece",
      fala: "No último passo você escolhe os dias, o horário e os canais onde o produto aparece. Do jeito que vem, ele vende todo dia, em todos os canais. Clique em Cadastrar Produto, e ele já entra na lista.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const canais = janela(p).locator("p").filter({ hasText: "Canais de Venda" }).first();
        await palco.rolarAte(canais, { bloco: "center" });
        await palco.destacar(canais.locator("xpath=.."), { folga: 6 });
        await ctx.ate(0.6);
        await palco.apagarDestaque();
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
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
      fala: "Para mudar o preço, clique na etiqueta, ao lado do valor. O produto abre direto no passo do preço.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const etiqueta = etiquetaDoPreco(p, NOVO);
        await palco.rolarAte(linha(p, NOVO), { bloco: "center" });
        const botoes = caixa(1050, (await linha(p, NOVO).boundingBox()).y - 6, 300, 90);
        await palco.camera(botoes, { zoomMax: 1.8, margem: 60 });
        await palco.destacar(etiqueta, { folga: 5 });
        await palco.mover(etiqueta, { ms: 700 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
        await palco.clicar(etiqueta);
        await campo.preco(p).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Troque o valor e clique em Salvar Alterações. As outras partes do produto ficam nestas abas, aqui em cima.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([campo.preco(p)], { zoomMax: 1.5, margem: 50 });
        await redigitar(palco, campo.preco(p), "15");
        await ctx.ate(0.45);
        await palco.cameraAberta({ ms: 400 });
        await palco.destacar([abaDoFormulario(p, "Sobre o produto"), abaDoFormulario(p, "Disponível em")], { folga: 6 });
        await palco.mover(abaDoFormulario(p, "Perguntas"), { ms: 600 });
        await ctx.ate(0.85);
        await palco.apagarDestaque();
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
        await palco.clicar(campo.salvar(p));
        await ctx.ate(1);
      },
    },
    {
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
        await palco.rolarAte(l, { bloco: "center" });
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
      capitulo: "Mais ações",
      fala: "Nos três pontinhos ficam as outras ações: editar, duplicar, destacar na vitrine, ficha técnica, dias e horário, e excluir. Se é só por um tempo, prefira pausar em vez de excluir.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const menu = maisAcoes(p, "X-Bacon");
        await palco.destacar(menu, { folga: 5 });
        await palco.mover(menu, { ms: 600 });
        await ctx.ate(0.15);
        await palco.apagarDestaque();
        await palco.clicar(menu);
        const excluir = itemDoMenu(p, "X-Bacon", "Excluir produto");
        await excluir.waitFor({ state: "visible", timeout: 5000 });
        const editar = itemDoMenu(p, "X-Bacon", "Editar produto");
        await palco.camera([editar, excluir], { zoomMax: 1.6, margem: 40 });
        await palco.mover(editar, { ms: 500 });
        await ctx.ate(0.75);
        await palco.destacar(excluir, { folga: 4 });
        await palco.mover(excluir, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await fecharMenu(palco);
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
