// Tutorial 2 de 5 da tela de Cardápio (/store/cardapio): cadastrar pizza com
// tamanhos e meio a meio pelo passo a passo (components/admin/CadastroDePizza).
//
// O que a fala afirma está no código: cada tamanho vira um produto com a
// pergunta de sabores; a regra "mais caro" / "metade de cada" é a de
// lib/preco-combo.ts; o "a partir de" é o sabor mais barato do tamanho; o
// cliente vê a regra escrita no ComboModal. Pedido do Douglas (02/10/2026):
// "qualquer criança de 10 anos tem que conseguir lançar isso aqui".
import { dormir } from "../motor/palco.mjs";
import {
  ROTA, PRONTA, cabecalho, linha, rolarPaginaAte, cenaFinal, abrirCardapioDoCliente, voltarAoPainel,
  assentar, perguntaDoNovoItem, botaoPizza,
} from "./_cardapio-comum.mjs";

const passo = (p) => p.getByRole("dialog", { name: "🍕 Cadastrar pizza" });
const edicao = (p) => p.getByRole("dialog", { name: "🍕 Pizzas: adicionar sabor e mudar preço" });
const continuar = (p) => passo(p).getByRole("button", { name: /Continuar/ });
const sabor = (p, i) => passo(p).locator(".fh-pz-sabor").nth(i);
const nomeDoSabor = (p, i) => sabor(p, i).getByPlaceholder("Ex.: Calabresa", { exact: true });
const precoDoSabor = (p, i, k) => sabor(p, i).locator(".fh-pz-reais input").nth(k);

export default {
  id: "cardapio-pizza",
  titulo: "Cardápio: pizza com tamanhos e meio a meio",
  rota: ROTA,
  prontaQuando: PRONTA,
  antesDeGravar: assentar,

  // As duas pizzas avulsas da loja-base saem: a categoria Pizzas começa vazia,
  // como a de uma pizzaria que vai cadastrar tudo agora.
  async preparar(prisma, { loja }) {
    await prisma.menuProduct.deleteMany({ where: { franchiseeId: loja.id, name: { in: ["Pizza Calabresa", "Pizza Marguerita"] } } });
  },

  cenas: [
    {
      capitulo: "O que este vídeo mostra",
      fala: "Neste vídeo do Cardápio: como cadastrar pizza, com tamanhos e meio a meio. Você responde algumas perguntas e o sistema monta tudo.",
      acao: async (palco) => {
        await dormir(500);
        await palco.mover({ x: 780, y: 470 }, { ms: 700 });
      },
    },
    {
      capitulo: "Começar",
      fala: "Clique em Novo Item. O sistema pergunta o que você vai cadastrar: escolha Pizza.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const novo = p.getByRole("button", { name: "Novo Item" });
        await palco.destacar(novo, { folga: 6 });
        await palco.mover(novo, { ms: 700 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(novo);
        await perguntaDoNovoItem(p).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.62);
        await palco.destacar(botaoPizza(p), { folga: 4 });
        await palco.mover(botaoPizza(p), { ms: 600 });
        await ctx.ate(0.92);
        await palco.apagarDestaque();
        await palco.clicar(botaoPizza(p));
        await passo(p).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Os tamanhos",
      fala: "Primeiro, os tamanhos que você vende. Toque para marcar: aqui, Broto, Média e Grande. Cada tamanho vira uma pizza no cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera(passo(p).locator(".fh-pz-tamanhos"), { zoomMax: 1.4, margem: 40 });
        await ctx.ate(0.3);
        for (const nome of ["Broto", "Média", "Grande"]) {
          await palco.clicar(passo(p).getByRole("button", { name: new RegExp(`^${nome}`) }));
          await dormir(150);
        }
        await ctx.ate(0.9);
        await palco.cameraAberta({ ms: 300 });
        await palco.clicar(continuar(p));
        await passo(p).getByText("Como é cada tamanho?").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Fatias e sabores",
      fala: "Em cada tamanho, as fatias e até quantos sabores o cliente escolhe. A broto vem com um sabor só. A média e a grande, com até dois: é o meio a meio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const broto = passo(p).locator(".fh-pz-cartao").filter({ hasText: "Pizza Broto" });
        const grande = passo(p).locator(".fh-pz-cartao").filter({ hasText: "Pizza Grande" });
        await palco.rolarAte(grande, { bloco: "end" });
        await palco.camera(passo(p).locator(".fh-pz-cartoes"), { zoomMax: 1.3, margem: 20 });
        await ctx.ate(0.25);
        await palco.destacar(broto.getByRole("button", { name: "1 sabor" }), { folga: 5 });
        await palco.mover(broto.getByRole("button", { name: "1 sabor" }), { ms: 600 });
        await ctx.ate(0.6);
        await palco.destacar(grande.getByRole("button", { name: "2 sabores" }), { folga: 5 });
        await palco.mover(grande.getByRole("button", { name: "2 sabores" }), { ms: 600 });
        await ctx.ate(0.95);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
        await palco.clicar(continuar(p));
        await passo(p).getByText("Quando o cliente escolhe 2 sabores, quanto ele paga?").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Como cobra o meio a meio",
      fala: "Depois, quanto o cliente paga com dois sabores. A tela mostra um exemplo em reais: pelo sabor mais caro, ou pela metade de cada sabor. Escolha o seu jeito.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const exemplo = passo(p).locator(".fh-pz-exemplo");
        const caro = passo(p).getByRole("button", { name: /Cobro o sabor mais caro/ });
        const metade = passo(p).getByRole("button", { name: /Cobro a metade de cada sabor/ });
        await palco.camera([exemplo, caro, metade], { zoomMax: 1.35, margem: 24 });
        await ctx.ate(0.2);
        await palco.destacar(exemplo, { folga: 4 });
        await ctx.ate(0.42);
        await palco.destacar(caro, { folga: 4 });
        await palco.mover(caro.locator(".valor"), { ms: 600 });
        await ctx.ate(0.62);
        await palco.destacar(metade, { folga: 4 });
        await palco.mover(metade.locator(".valor"), { ms: 600 });
        await ctx.ate(0.85);
        await palco.apagarDestaque();
        await palco.clicar(caro);
        await ctx.ate(0.97);
        await palco.cameraAberta({ ms: 300 });
        await palco.clicar(continuar(p));
        await passo(p).getByText("Quais sabores você faz, e quanto custa cada pizza?").waitFor({ state: "visible", timeout: 8000 });
      },
    },
    {
      capitulo: "Sabores e preços",
      fala: "Agora os sabores. Em cada linha, escreva o nome, os ingredientes que o cliente vai ler, e o preço da pizza inteira em cada tamanho.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera(passo(p).locator(".fh-pz-tabela"), { zoomMax: 1.35, margem: 20 });
        await palco.digitar(nomeDoSabor(p, 0), "Calabresa");
        await palco.digitar(sabor(p, 0).getByPlaceholder(/Ingredientes/), "calabresa e cebola");
        await palco.digitar(precoDoSabor(p, 0, 0), "35");
        await palco.digitar(precoDoSabor(p, 0, 1), "48");
        await palco.digitar(precoDoSabor(p, 0, 2), "58");
        await ctx.ate(1);
      },
    },
    {
      fala: "Faça o mesmo com os outros sabores. Deixe em branco o tamanho que o sabor não tem: aqui, o camarão não tem broto, então ele só aparece na média e na grande.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.digitar(nomeDoSabor(p, 1), "Camarão");
        await palco.digitar(precoDoSabor(p, 1, 1), "62");
        await palco.digitar(precoDoSabor(p, 1, 2), "79,90");
        await palco.destacar(precoDoSabor(p, 1, 0), { folga: 5 });
        await ctx.ate(0.85);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Para mais um sabor, clique em Adicionar sabor. Quando terminar, Continuar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const mais = passo(p).getByRole("button", { name: /Adicionar sabor/ });
        await palco.rolarAte(mais, { bloco: "end" });
        await palco.destacar(mais, { folga: 5 });
        await palco.mover(mais, { ms: 600 });
        await ctx.ate(0.6);
        await palco.apagarDestaque();
        await palco.clicar(continuar(p));
        await passo(p).getByText("Você tem borda recheada?").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Borda recheada",
      fala: "Tem borda recheada? Marque Tenho borda e diga quanto ela soma em cada tamanho. Se não tem, é só marcar Não tenho borda.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const tenho = passo(p).getByRole("button", { name: /Tenho borda/ });
        const naoTenho = passo(p).getByRole("button", { name: /Não tenho borda/ });
        await palco.clicar(tenho);
        const b = passo(p).locator(".fh-pz-sabor").first();
        await b.waitFor({ state: "visible", timeout: 5000 });
        await palco.camera([tenho, b], { zoomMax: 1.3, margem: 24 });
        await palco.digitar(b.getByPlaceholder("Ex.: Catupiry", { exact: true }), "Catupiry");
        await palco.digitar(b.locator(".fh-pz-reais input").nth(0), "5");
        await palco.digitar(b.locator(".fh-pz-reais input").nth(1), "8");
        await palco.digitar(b.locator(".fh-pz-reais input").nth(2), "10");
        await ctx.ate(0.78);
        await palco.destacar(naoTenho, { folga: 4 });
        await palco.mover(naoTenho, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
      },
    },
    {
      capitulo: "Conferir e salvar",
      fala: "Na última tela, confira a categoria, como cada pizza vai aparecer no cardápio, e o exemplo do meio a meio com os seus sabores. Depois, Cadastrar as pizzas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(continuar(p));
        await passo(p).getByText("Confira e salve").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.2);
        await palco.destacar(passo(p).locator("select"), { folga: 5 });
        await ctx.ate(0.4);
        await palco.destacar(passo(p).locator(".fh-pz-vitrine"), { folga: 5 });
        await ctx.ate(0.62);
        await palco.destacar(passo(p).locator(".fh-pz-resumo span").first(), { folga: 5 });
        await ctx.ate(0.88);
        await palco.apagarDestaque();
        await palco.clicar(passo(p).getByRole("button", { name: /Cadastrar as pizzas/ }));
        await passo(p).getByText("Pronto! Suas pizzas já estão no cardápio.").waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Pronto. Cada tamanho virou uma pizza no cardápio, a partir do preço do sabor mais barato.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(passo(p).getByRole("button", { name: "Fechar" }).last());
        await passo(p).waitFor({ state: "hidden", timeout: 8000 });
        const grande = linha(p, "Pizza Grande");
        await grande.waitFor({ state: "visible", timeout: 15_000 });
        await rolarPaginaAte(palco, cabecalho(p, "Pizzas"), 120);
        await palco.destacar([linha(p, "Pizza Broto"), linha(p, "Pizza Média"), grande], { folga: 4 });
        await ctx.ate(0.6);
        await palco.mover(grande.getByText("a partir de"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Como o cliente vê",
      fala: "No cardápio do cliente, ele toca no tamanho e escolhe os sabores. A regra aparece escrita, e o total sai certo: meia calabresa e meia camarão, pelo preço do camarão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await abrirCardapioDoCliente(palco, (pg) => pg.getByText("Pizza Grande", { exact: true }).first(), { destaque: false });
        const cartao = p.getByText("Pizza Grande", { exact: true }).first();
        await rolarPaginaAte(palco, cartao, 330);
        await palco.clicar(cartao);
        const modal = p.locator('[aria-label="Pizza Grande"]');
        const regra = modal.getByText(/vale o preço do sabor mais caro/);
        await regra.waitFor({ state: "visible", timeout: 10_000 });
        await palco.camera(modal, { zoomMax: 1.25, margem: 10 });
        await ctx.ate(0.32);
        await palco.destacar(regra, { folga: 6 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.clicar(modal.getByText("Calabresa", { exact: true }), { ms: 500 });
        await palco.clicar(modal.getByText("Camarão", { exact: true }), { ms: 500 });
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
    {
      capitulo: "Sabor novo depois",
      fala: "Para pôr um sabor novo ou mudar um preço depois, é só voltar em Novo Item, Pizza, e clicar em Adicionar sabor ou mudar preço. Nada precisa ser cadastrado de novo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Novo Item" }));
        await perguntaDoNovoItem(p).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.22);
        await palco.clicar(botaoPizza(p));
        const inicio = p.getByRole("dialog", { name: "🍕 Pizza" });
        const editar = inicio.getByRole("button", { name: /Adicionar sabor ou mudar preço/ });
        await editar.waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.45);
        await palco.destacar(editar, { folga: 5 });
        await palco.mover(editar, { ms: 600 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.clicar(editar);
        await edicao(p).getByText("Quais sabores você faz, e quanto custa cada pizza?").waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(edicao(p).locator(".fh-pz-tabela"), { zoomMax: 1.3, margem: 20 });
        await ctx.ate(1);
        await dormir(400);
        await palco.cameraAberta({ ms: 300 });
        await edicao(p).getByRole("button", { name: "Fechar" }).first().evaluate((el) => el.click());
        await edicao(p).waitFor({ state: "hidden", timeout: 8000 });
      },
    },
    cenaFinal("Para rever este vídeo, é só clicar em Tutorial, aqui no topo. Na janela do Tutorial ficam também os outros vídeos do cardápio."),
  ],
};
