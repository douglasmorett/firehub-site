// Tutorial 3 de 5 da tela de Cardápio (/store/cardapio): combos e adicionais.
//
// Desde 02/10/2026, pergunta é uma coisa e combo é outra (lib/combo-e-pergunta.ts):
// combo é feito de itens que JÁ estão no cardápio ("O que o combo leva"), e
// pausar um desses itens oferece pausar os combos que dependem dele. Adicional
// é pergunta, e qualquer item pode ter pergunta — não precisa ser combo. Pizza
// tem passo a passo e vídeo próprios (cardapio-pizza).
import { dormir } from "../motor/palco.mjs";
import {
  ROTA, PRONTA, linha, cabecalho, janela, campo, pausar,
  abrirEdicao, esperarFechar, rolarPaginaAte, cenaFinal, semearCombos,
  assentar,
} from "./_cardapio-comum.mjs";

const NOVO = "Combo Casal";

/** A caixa "O que o combo leva" do formulário. */
const leva = (p) => janela(p).getByText("📦 O que o combo leva").locator("xpath=..");
/** O seletor aberto por "Adicionar item do cardápio". */
const seletorDoCombo = (p) => janela(p).getByPlaceholder("Buscar no cardápio…", { exact: true }).locator("xpath=..");
/** A caixa das perguntas ("Escolhas do cliente no combo" / "Perguntas do produto"). */
const perguntas = (p) => janela(p).getByText(/Escolhas do cliente no combo|Perguntas do produto/).first().locator("xpath=../..");
/** O cartão de uma pergunta no formulário ("Pergunta 1", "Pergunta 2"…). */
const pergunta = (p, n) => janela(p).getByText(`Pergunta ${n}`, { exact: true }).locator("xpath=../..");
/** O aviso "Pausar os combos também?" que aparece ao pausar um item que um combo leva. */
const avisoDosCombos = (p) => p.getByText(/Pausar os combos também\?|Reativar os combos também\?/).locator("xpath=ancestor::div[contains(@style,'border-radius')][1]");

export default {
  id: "cardapio-combos",
  titulo: "Cardápio: combos e adicionais",
  rota: ROTA,
  prontaQuando: PRONTA,
  antesDeGravar: assentar,

  // Um combo pronto (X-Bacon + batata + bebida): pausar a batata mostra que
  // a pausa alcança os dois combos, o do vídeo e este.
  async preparar(prisma, base) {
    await semearCombos(prisma, base);
  },

  cenas: [
    {
      capitulo: "O que este vídeo mostra",
      fala: "Neste vídeo do Cardápio: como montar um combo, e como pôr adicionais num lanche. A pizza tem um vídeo só dela.",
      acao: async (palco) => {
        await dormir(500);
        await palco.mover({ x: 780, y: 470 }, { ms: 700 });
      },
    },
    {
      capitulo: "Novo Combo",
      fala: "O combo junta itens que já estão no cardápio, como lanche, batata e refrigerante. Clique em Novo Combo: a tela explica como funciona.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /Novo Combo/ });
        await ctx.ate(0.4);
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 600 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.clicar(botao);
        await janela(p).waitFor({ state: "visible", timeout: 8000 });
        const explica = janela(p).getByText("📦 Como funciona o combo").locator("xpath=..");
        await palco.camera(explica, { zoomMax: 1.5, margem: 30 });
        await palco.destacar(explica, { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      fala: "Escreva o nome do combo, o preço e a descrição, que o cliente lê embaixo do nome.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([campo.nome(p), campo.preco(p)], { zoomMax: 1.45, margem: 44 });
        await palco.digitar(campo.nome(p), NOVO);
        await palco.digitar(campo.preco(p), "59");
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(campo.descricao(p), { bloco: "center" });
        await palco.digitar(campo.descricao(p), "2 X-Burger, batata e refrigerante");
        await ctx.ate(1);
      },
    },
    {
      capitulo: "O que o combo leva",
      fala: "Em O que o combo leva, clique em Adicionar item do cardápio, busque e escolha os itens. Aqui, dois X-Burger e uma Batata Frita.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const adicionar = leva(p).getByRole("button", { name: /Adicionar item do cardápio/ });
        await palco.rolarAte(leva(p), { bloco: "start" });
        await ctx.ate(0.3);
        await palco.clicar(adicionar);
        await seletorDoCombo(p).waitFor({ state: "visible", timeout: 5000 });
        await palco.camera(leva(p), { zoomMax: 1.35, margem: 16 });
        const busca = janela(p).getByPlaceholder("Buscar no cardápio…", { exact: true });
        await palco.digitar(busca, "burger");
        await palco.clicar(seletorDoCombo(p).getByRole("button", { name: "X-Burger", exact: true }));
        const xBurger = leva(p).getByText("X-Burger", { exact: true }).first().locator("xpath=..");
        await xBurger.waitFor({ state: "visible", timeout: 5000 });
        await palco.clicar(xBurger.getByRole("button", { name: "Mais" }));
        await palco.digitar(busca, "batata");
        await palco.clicar(seletorDoCombo(p).getByRole("button", { name: "Batata Frita", exact: true }));
        await ctx.ate(1);
      },
    },
    {
      fala: "Esses itens sempre vêm no combo. Cada um sai na impressora da categoria dele.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(leva(p).getByRole("button", { name: /Adicionar item do cardápio/ }));
        await seletorDoCombo(p).waitFor({ state: "hidden", timeout: 5000 });
        const itens = leva(p).getByRole("button", { name: "Mais" });
        await palco.destacar([itens.nth(0).locator("xpath=../.."), itens.nth(1).locator("xpath=../..")], { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "Escolha do cliente",
      fala: "Se o cliente escolhe a bebida, clique em Adicionar pergunta, escreva o que ele escolhe, e pegue as bebidas em Item que já existe.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const nova = janela(p).getByRole("button", { name: /Adicionar pergunta/ });
        await palco.rolarAte(nova, { bloco: "center" });
        await palco.clicar(nova);
        const q = pergunta(p, 1);
        await q.waitFor({ state: "visible", timeout: 5000 });
        await palco.rolarAte(q, { bloco: "start" });
        await palco.camera(q, { zoomMax: 1.3, margem: 16 });
        await palco.digitar(q.getByPlaceholder("Ex: Escolha seus sabores"), "Escolha o refrigerante");
        await ctx.ate(0.62);
        await palco.clicar(q.getByRole("button", { name: /Item que já existe/ }));
        const busca = q.getByPlaceholder("Buscar no cardápio...", { exact: true });
        await busca.waitFor({ state: "visible", timeout: 5000 });
        const lista = busca.locator("xpath=..");
        await palco.clicar(lista.getByRole("button", { name: /^Coca-Cola lata/ }));
        await palco.clicar(lista.getByRole("button", { name: /^Guaraná 2 L/ }));
        await ctx.ate(1);
      },
    },
    {
      fala: "Pronto. Clique em Cadastrar Produto, e o combo entra na lista com o selo Combo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
        await palco.clicar(campo.salvar(p));
        await esperarFechar(palco);
        const l = linha(p, NOVO);
        await l.waitFor({ state: "visible", timeout: 15_000 });
        await rolarPaginaAte(palco, l, 260);
        await palco.destacar(l, { folga: 5 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Pausar um item do combo",
      fala: "Acabou a batata? Clique em pausar na Batata Frita. O sistema mostra os combos que levam ela, e pausa tudo de uma vez.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const batata = linha(p, "Batata Frita");
        await rolarPaginaAte(palco, cabecalho(p, "Porções"), 220);
        await palco.destacar(pausar(p, "Batata Frita"), { folga: 5 });
        await palco.mover(pausar(p, "Batata Frita"), { ms: 600 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(pausar(p, "Batata Frita"));
        const aviso = avisoDosCombos(p);
        await aviso.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(aviso, { zoomMax: 1.3, margem: 20 });
        await palco.destacar(aviso, { folga: 4 });
        await ctx.ate(0.85);
        await palco.apagarDestaque();
        await palco.clicar(p.getByRole("button", { name: /Pausar este item \+ os 2 combos/ }));
        await batata.getByText("PAUSADO").waitFor({ state: "visible", timeout: 10_000 });
        await palco.cameraAberta({ ms: 300 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Quando a batata voltar, o mesmo botão reativa, e oferece reativar os combos juntos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaAte(palco, cabecalho(p, "Porções"), 220);
        await palco.clicar(pausar(p, "Batata Frita"));
        const aviso = avisoDosCombos(p);
        await aviso.waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.6);
        await palco.clicar(p.getByRole("button", { name: /Reativar este item \+ os 2 combos/ }));
        await linha(p, "Batata Frita").getByText("PAUSADO").waitFor({ state: "hidden", timeout: 10_000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Adicionais num lanche",
      fala: "Adicional não precisa de combo: qualquer item pode ter perguntas. No lápis do X-Tudo, em Perguntas do produto, clique em Adicionar pergunta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaAte(palco, cabecalho(p, "Lanches"), 120);
        await ctx.ate(0.3);
        await abrirEdicao(palco, "X-Tudo");
        await palco.rolarAte(perguntas(p), { bloco: "start" });
        await palco.destacar(janela(p).getByText("❓ Perguntas do produto"), { folga: 6 });
        await ctx.ate(0.8);
        await palco.apagarDestaque();
        await palco.clicar(janela(p).getByRole("button", { name: /Adicionar pergunta/ }));
        await pergunta(p, 1).waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Escreva a pergunta, marque Opcional, e em Cadastrar item novo, o adicional e quanto ele soma. Ele entra só aqui: não vira produto avulso.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const q = pergunta(p, 1);
        await palco.rolarAte(q, { bloco: "start" });
        await palco.camera(q, { zoomMax: 1.3, margem: 16 });
        await palco.digitar(q.getByPlaceholder("Ex: Escolha seus sabores"), "Deseja adicionais?");
        await palco.clicar(q.getByRole("button", { name: "Opcional", exact: true }));
        await ctx.ate(0.45);
        await palco.clicar(q.getByRole("button", { name: /Cadastrar item novo/ }));
        const nome = q.getByPlaceholder("Ex: Adicional de Catupiry");
        await nome.waitFor({ state: "visible", timeout: 5000 });
        await palco.rolarAte(nome, { bloco: "center" });
        await palco.digitar(nome, "Cheddar");
        await palco.digitar(q.getByPlaceholder("0,00", { exact: true }), "3");
        await palco.clicar(q.getByRole("button", { name: "Cadastrar e adicionar" }));
        await q.getByText("Cheddar", { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Clique em Salvar Alterações. No cardápio, o cliente vê a pergunta ao tocar no X-Tudo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
        await palco.clicar(campo.salvar(p));
        await esperarFechar(palco);
        const complementos = linha(p, "X-Tudo").getByRole("button", { name: /Complementos/ });
        await complementos.waitFor({ state: "visible", timeout: 15_000 });
        await rolarPaginaAte(palco, cabecalho(p, "Lanches"), 120);
        await palco.destacar(linha(p, "X-Tudo"), { folga: 5 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Pausar um adicional",
      fala: "Acabou o cheddar? Abra Complementos e clique no pausar dele. Ele some para o cliente, e o lanche continua vendendo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const l = linha(p, "X-Tudo");
        await palco.clicar(l.getByRole("button", { name: /Complementos/ }));
        const botao = l.getByRole("button", { name: "Pausar Cheddar" });
        await botao.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(l, { zoomMax: 1.3, margem: 14 });
        await ctx.ate(0.3);
        await palco.clicar(botao);
        const opcao = l.locator('span[title="Cheddar"]').locator("xpath=..");
        await opcao.getByText("Pausada").waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(opcao, { folga: 5 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    cenaFinal("Para rever este vídeo, é só clicar em Tutorial, aqui no topo. Na janela do Tutorial ficam também os outros vídeos do cardápio."),
  ],
};
