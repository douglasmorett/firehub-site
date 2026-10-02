// Tutorial 3 de 4 da tela de Cardápio (/store/cardapio): combos, adicionais e
// pizza meio a meio.
//
// As regras de preço ditas aqui estão em src/lib/preco-combo.ts: o combo custa
// o preço de venda mais o que cada opção escolhida soma; na pergunta marcada
// "O mais caro" ou "A média", as escolhas valem UMA pizza (a mais cara, ou a
// média), nunca a soma.
import { dormir } from "../motor/palco.mjs";
import {
  ROTA, PRONTA, linha, cabecalho, janela, campo, caixa,
  abrirEdicao, esperarFechar, fecharSemClicar, rolarPaginaAte, cenaFinal,
  abrirCardapioDoCliente, voltarAoPainel, semearCombos,
  assentar,
} from "./_cardapio-comum.mjs";

const COMBO = "Combo X-Bacon";
const PIZZA = "Pizza Grande 2 Sabores";

/** O cartão de uma pergunta no formulário ("Pergunta 1", "Pergunta 2"…). */
const pergunta = (p, n) => janela(p).getByText(`Pergunta ${n}`, { exact: true }).locator("xpath=../..");
/** A linha de uma opção dentro do formulário. */
const opcaoNoFormulario = (p, nome) => janela(p).getByText(nome, { exact: true }).first().locator("xpath=..");
/** A opção na lista aberta em "Complementos" (nome, acréscimo, pausar). */
const opcaoNaLista = (p, nome) => linha(p, COMBO).locator(`span[title="${nome}"]`).locator("xpath=..");

export default {
  id: "cardapio-combos",
  titulo: "Cardápio: combos, adicionais e meio a meio",
  rota: ROTA,
  prontaQuando: PRONTA,
  antesDeGravar: assentar,

  async preparar(prisma, base) {
    await semearCombos(prisma, base);
  },

  cenas: [
    {
      capitulo: "O que este vídeo mostra",
      fala: "Neste vídeo do Cardápio: combos, adicionais e pizza meio a meio. No FireHub, os três se fazem com perguntas que o cliente responde ao escolher o produto.",
      acao: async (palco) => {
        await dormir(500);
        await palco.mover({ x: 780, y: 470 }, { ms: 700 });
      },
    },
    {
      capitulo: "As perguntas de um combo",
      fala: "Na aba Apenas Combos ficam os produtos que têm perguntas. Clique em Complementos para ver as perguntas e as opções de cada uma.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aba = p.getByRole("button", { name: /Apenas Combos/ });
        await palco.destacar(aba, { folga: 6 });
        await palco.mover(aba, { ms: 600 });
        await ctx.ate(0.2);
        await palco.apagarDestaque();
        await palco.clicar(aba);
        await linha(p, COMBO).waitFor({ state: "visible", timeout: 8000 });
        await rolarPaginaAte(palco, cabecalho(p, "Lanches"), 80);
        const complementos = linha(p, COMBO).getByRole("button", { name: /Complementos/ });
        await ctx.ate(0.5);
        await palco.destacar(complementos, { folga: 6 });
        await palco.mover(complementos, { ms: 600 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await palco.clicar(complementos);
        await linha(p, COMBO).getByText("Pergunta 2").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "A primeira pergunta é obrigatória: a bebida. A segunda é opcional: os adicionais. Ao lado de cada opção, quanto ela soma no preço, ou Grátis.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const l = linha(p, COMBO);
        await palco.camera(l, { zoomMax: 1.3, margem: 14 });
        await palco.destacar(l.getByText("Pergunta 1").locator("xpath=../.."), { folga: 4 });
        await palco.mover(l.getByText(/Obrigatória · 1 escolha/), { ms: 600 });
        await ctx.ate(0.36);
        await palco.destacar(l.getByText("Pergunta 2").locator("xpath=../.."), { folga: 4 });
        await palco.mover(l.getByText(/Opcional · até 3/), { ms: 600 });
        await ctx.ate(0.66);
        await palco.apagarDestaque();
        await palco.mover(l.getByText("+R$ 4,00"), { ms: 600 });
        await ctx.ate(0.9);
        await palco.mover(l.getByText("Grátis"), { ms: 600 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Pausar uma opção",
      fala: "Acabou o ovo? Clique no pausar da opção. Ela some para o cliente, e o combo continua vendendo com as outras.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: "Pausar Ovo" });
        await palco.destacar(opcaoNaLista(p, "Ovo"), { folga: 5 });
        await palco.mover(botao, { ms: 700 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(botao);
        await opcaoNaLista(p, "Ovo").getByText("Pausada").waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(opcaoNaLista(p, "Ovo"), { folga: 5 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Editar perguntas e opções",
      fala: "Para mexer, clique em Editar perguntas e opções. É o formulário do produto, com as Perguntas do combo no fim.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const editar = p.getByRole("button", { name: /Editar perguntas e opções/ });
        await palco.destacar(editar, { folga: 6 });
        await palco.mover(editar, { ms: 700 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
        await palco.clicar(editar);
        await janela(p).waitFor({ state: "visible", timeout: 8000 });
        await dormir(400);
        const titulo = janela(p).getByText("Perguntas do combo");
        await palco.rolarAte(titulo, { bloco: "start" });
        await palco.destacar(titulo.locator("xpath=.."), { folga: 8 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em cada pergunta você escreve o que o cliente escolhe, marca se é Obrigatória ou Opcional, e diz o mínimo e o máximo de escolhas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const q = pergunta(p, 1);
        const titulo = q.getByPlaceholder("Ex: Escolha seus sabores");
        const resposta = q.getByRole("button", { name: "Obrigatória" }).locator("xpath=..");
        const minimo = q.getByText("Escolhe mín.").locator("xpath=..");
        const maximo = q.getByText("No máx.").locator("xpath=..");
        await palco.rolarAte(q, { bloco: "start" });
        await palco.camera([titulo, resposta, maximo, q.getByText(/exige exatamente/)], { zoomMax: 1.6, margem: 44 });
        await palco.destacar(titulo, { folga: 6 });
        await palco.mover(titulo, { ms: 500 });
        await ctx.ate(0.38);
        await palco.destacar(resposta, { folga: 6 });
        await palco.mover(resposta, { ms: 500 });
        await ctx.ate(0.7);
        await palco.destacar([minimo, maximo], { folga: 6 });
        await palco.mover(maximo, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Adicionais e preço da opção",
      fala: "Para pôr uma opção nova, clique em Cadastrar item novo, escreva o nome e o acréscimo, e clique em Cadastrar e adicionar. O item entra só nesta pergunta: não vira produto avulso no cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const q = pergunta(p, 2);
        const novo = q.getByRole("button", { name: /Cadastrar item novo/ });
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(novo, { bloco: "center" });
        await palco.clicar(novo);
        const nome = q.getByPlaceholder("Ex: Adicional de Catupiry");
        await nome.waitFor({ state: "visible", timeout: 5000 });
        const cadastrar = q.getByRole("button", { name: "Cadastrar e adicionar" });
        await palco.rolarAte(cadastrar, { bloco: "center" });
        await palco.camera([novo, cadastrar, q.getByPlaceholder("Ex: 40g de catupiry cremoso")], { zoomMax: 1.5, margem: 30 });
        await palco.digitar(nome, "Catupiry");
        await palco.digitar(q.getByPlaceholder("0,00"), "5");
        await palco.clicar(cadastrar);
        await opcaoNoFormulario(p, "Catupiry").waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "O valor ao lado é quanto a opção soma ao preço do combo: com zero, sai grátis. Em Item que já existe, você aproveita um produto do cardápio, como a bebida. No fim, Salvar Alterações.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const q = pergunta(p, 2);
        const nova = opcaoNoFormulario(p, "Catupiry");
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(nova, { bloco: "center" });
        await palco.camera([opcaoNoFormulario(p, "Cheddar"), nova, q.getByRole("button", { name: /Item que já existe/ })], { zoomMax: 1.5, margem: 30 });
        const acrescimo = nova.locator('input[type="number"]').first();
        await palco.destacar(nova, { folga: 4 });
        await palco.mover(acrescimo, { ms: 600 });
        await ctx.ate(0.36);
        const existe = q.getByRole("button", { name: /Item que já existe/ });
        await palco.destacar(existe, { folga: 6 });
        await palco.mover(existe, { ms: 600 });
        await ctx.ate(0.66);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
        await palco.clicar(campo.salvar(p));
        await esperarFechar(palco);
        // A lista só recarregou quando a opção nova aparece nos Complementos.
        await opcaoNaLista(p, "Catupiry").waitFor({ state: "visible", timeout: 15_000 });
      },
    },
    {
      capitulo: "Lanche com adicionais",
      fala: "Um detalhe: só produto criado como combo tem perguntas. Lanche que aceita adicionais se cadastra em Novo Combo, ou em Criar combo, na categoria.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaAte(palco, cabecalho(p, "Lanches"), 190);
        const novoCombo = p.getByRole("button", { name: /Novo Combo/ });
        const criarCombo = cabecalho(p, "Lanches").getByRole("button", { name: "+ Criar combo" });
        await palco.camera([p.getByRole("button", { name: /Adicionar Categoria/ }), criarCombo, cabecalho(p, "Lanches")], { zoomMax: 1.3, margem: 30 });
        await ctx.ate(0.45);
        await palco.destacar(novoCombo, { folga: 6 });
        await palco.mover(novoCombo, { ms: 700 });
        await ctx.ate(0.72);
        await palco.destacar(criarCombo, { folga: 6 });
        await palco.mover(criarCombo, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "Pizza meio a meio",
      fala: "Na pizza meio a meio, o preço de venda do produto fica zero: quem cobra é o sabor. A pergunta aceita mais de uma escolha, e aí a tela pergunta como cobrar: somar, o mais caro ou a média.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaAte(palco, linha(p, PIZZA), 260);
        await abrirEdicao(palco, PIZZA);
        const regra = janela(p).getByText("Escolhendo mais de um, como cobrar?").locator("xpath=..");
        await palco.camera([campo.nome(p), campo.preco(p)], { zoomMax: 1.5, margem: 50 });
        await palco.destacar(campo.preco(p), { folga: 8 });
        await palco.mover(campo.preco(p), { ms: 500 });
        await ctx.ate(0.42);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
        await palco.rolarAte(pergunta(p, 1), { bloco: "start" });
        await palco.camera([pergunta(p, 1).getByPlaceholder("Ex: Escolha seus sabores"), regra], { zoomMax: 1.5, margem: 30 });
        await palco.destacar(pergunta(p, 1).getByText("No máx.").locator("xpath=.."), { folga: 6 });
        await ctx.ate(0.66);
        await palco.destacar(regra, { folga: 4 });
        for (const [i, nome] of ["Somar", "O mais caro", "A média"].entries()) {
          await ctx.ate(0.8 + i * 0.07);
          await palco.mover(regra.getByRole("button", { name: nome }), { ms: 450 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Cadastre em cada sabor o preço da pizza inteira. Com O mais caro, a meio a meio sai pelo preço do sabor mais caro. Com A média, pela média dos dois.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const regra = janela(p).getByText("Escolhendo mais de um, como cobrar?").locator("xpath=..");
        await palco.rolarAte(regra, { bloco: "start" });
        await palco.camera([regra, opcaoNoFormulario(p, "Portuguesa")], { zoomMax: 1.4, margem: 24 });
        await palco.destacar([opcaoNoFormulario(p, "Calabresa"), opcaoNoFormulario(p, "Portuguesa")], { folga: 4 });
        await palco.mover(opcaoNoFormulario(p, "Calabresa").locator('input[type="number"]').first(), { ms: 600 });
        await ctx.ate(0.3);
        await palco.destacar(regra, { folga: 4 });
        await palco.mover(regra.getByRole("button", { name: "O mais caro" }), { ms: 600 });
        await ctx.ate(0.68);
        await palco.apagarDestaque();
        await palco.clicar(regra.getByRole("button", { name: "A média" }));
        await palco.destacar(regra, { folga: 4 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
        await fecharSemClicar(palco);
      },
    },
    {
      capitulo: "Como o cliente vê",
      fala: "Veja no cardápio do cliente, em Ver cardápio, Abrir o cardápio.",
      acao: async (palco) => {
        const p = palco.pagina;
        await abrirCardapioDoCliente(palco, (pg) => pg.getByText(PIZZA, { exact: true }).first(), { destaque: false });
        await rolarPaginaAte(palco, p.getByText(PIZZA, { exact: true }).first(), 330);
      },
      pausa: 200,
    },
    {
      fala: "A regra aparece escrita na pergunta, e o total já sai certo: meia calabresa e meia portuguesa, pelo preço da portuguesa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = p.getByText(PIZZA, { exact: true }).first();
        await palco.clicar(cartao);
        const modal = p.locator(`[aria-label="${PIZZA}"]`);
        const regra = modal.getByText(/vale o preço do sabor mais caro/);
        await regra.waitFor({ state: "visible", timeout: 10_000 });
        await palco.camera(modal, { zoomMax: 1.25, margem: 10 });
        await palco.destacar(regra, { folga: 6 });
        await ctx.ate(0.34);
        await palco.apagarDestaque();
        await palco.clicar(modal.getByText("Calabresa", { exact: true }), { ms: 500 });
        await palco.clicar(modal.getByText("Portuguesa", { exact: true }), { ms: 500 });
        const total = modal.getByText("Confirmar item").locator("xpath=ancestor::button[1]");
        await total.waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(total, { folga: 6 });
        await palco.mover(total, { ms: 600 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
        await voltarAoPainel(palco);
      },
    },
    cenaFinal("Para rever este vídeo, é só clicar em Tutorial, aqui no topo. A janela do Tutorial tem também os outros vídeos do cardápio."),
  ],
};
