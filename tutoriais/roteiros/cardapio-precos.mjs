// Tutorial 2 de 4 da tela de Cardápio (/store/cardapio): preço promocional e
// preço por canal.
//
// A regra que este vídeo conta está em src/lib/preco-por-canal.ts: a promoção
// é um desconto sobre o preço DE CADA canal, e só vale onde for menor que ele.
// O formulário e o servidor ainda exigem que ela seja menor que o Preço de Venda.
import { dormir } from "../motor/palco.mjs";
import {
  ROTA, PRONTA, linha, janela, lapis, campo, caixa,
  abrirEdicao, esperarFechar, fecharSemClicar, redigitar, rolarSePreciso, cenaFinal,
  abrirCardapioDoCliente, voltarAoPainel, semearCombos,
  assentar,
} from "./_cardapio-comum.mjs";

const PRODUTO = "X-Bacon";
const COMBO = "Combo X-Bacon";
const ALTURA_DA_LISTA = 300;

const canais = (p) => janela(p).locator('input[placeholder^="usa R$"]');
const abaDeCanais = (p) => janela(p).getByRole("button", { name: /^💰\s*Preço diferente por canal\s*Cobrar/ });

export default {
  id: "cardapio-precos",
  titulo: "Cardápio: preço promocional e preço por canal",
  rota: ROTA,
  prontaQuando: PRONTA,
  antesDeGravar: assentar,

  async preparar(prisma, base) {
    await semearCombos(prisma, base);
  },

  cenas: [
    {
      capitulo: "O que este vídeo mostra",
      fala: "Neste vídeo do Cardápio: como colocar um produto em promoção, como tirar, e como cobrar um preço diferente no balcão, no delivery e no totem.",
      acao: async (palco) => {
        await dormir(500);
        await palco.mover({ x: 780, y: 470 }, { ms: 700 });
        await palco.rolarPagina(ALTURA_DA_LISTA);
      },
    },
    {
      capitulo: "Colocar em promoção",
      fala: "Clique no lápis do produto. O Preço de Venda é o preço normal. Logo abaixo fica o Preço promocional.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(lapis(p, PRODUTO), { folga: 5 });
        await palco.mover(lapis(p, PRODUTO), { ms: 700 });
        await ctx.ate(0.22);
        await palco.apagarDestaque();
        await abrirEdicao(palco, PRODUTO);
        await palco.camera([campo.nome(p), campo.preco(p), campo.faixaDaPromo(p)], { zoomMax: 1.6, margem: 36 });
        await ctx.ate(0.4);
        await palco.destacar(campo.preco(p), { folga: 8 });
        await palco.mover(campo.preco(p), { ms: 500 });
        await ctx.ate(0.72);
        await palco.destacar(campo.faixaDaPromo(p), { folga: 4 });
        await palco.mover(campo.promo(p), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Digite o valor da promoção. A tela já mostra como vai ficar no cardápio: o preço normal riscado, o promocional em destaque e o desconto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.digitar(campo.promo(p), "22");
        const previa = janela(p).getByText("No cardápio:").locator("xpath=..");
        await previa.waitFor({ state: "visible", timeout: 5000 });
        await ctx.ate(0.4);
        await palco.destacar(previa, { folga: 8 });
        await palco.mover(previa, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "A promoção tem que ser menor que o preço de venda. Se não for, a tela avisa e não deixa salvar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.25);
        await redigitar(palco, campo.promo(p), "30");
        const aviso = janela(p).getByText(/Tem que ser MENOR/);
        await aviso.waitFor({ state: "visible", timeout: 5000 });
        await palco.destacar(aviso, { folga: 8 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        // De volta ao valor certo, sem redigitar: a digitação já foi mostrada na cena anterior.
        await campo.promo(p).fill("22");
        await dormir(400);
      },
    },
    {
      fala: "Clique em Salvar Alterações. Na lista, o produto aparece com o preço antigo riscado e o selo PROMO.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
        await palco.clicar(campo.salvar(p));
        await esperarFechar(palco);
        const selo = linha(p, PRODUTO).getByText("PROMO", { exact: true });
        await selo.waitFor({ state: "visible", timeout: 10_000 });
        await rolarSePreciso(palco, ALTURA_DA_LISTA);
        await palco.camera(linha(p, PRODUTO), { zoomMax: 1.2, margem: 20 });
        await palco.destacar(selo.locator("xpath=.."), { folga: 8 });
        await palco.mover(selo, { ms: 600 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "Como o cliente vê",
      fala: "Para ver como ficou para o cliente, clique em Ver cardápio e em Abrir o cardápio.",
      acao: async (palco) => {
        await abrirCardapioDoCliente(palco, (pg) => pg.getByText("Ofertas do Dia").first(), { destaque: false });
      },
      pausa: 200,
    },
    {
      fala: "O produto entra nas Ofertas do Dia, com o preço de antes riscado ao lado do novo. No cardápio do cliente, a mudança pode levar até um minuto para aparecer.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aba = p.getByText("Ofertas do Dia").first();
        await palco.destacar(aba, { folga: 8 });
        await palco.mover(aba, { ms: 500 });
        await ctx.ate(0.22);
        await palco.apagarDestaque();
        const nome = p.getByText(PRODUTO, { exact: true }).first();
        const c = await nome.boundingBox();
        await palco.camera(caixa(c.x - 90, c.y - 60, 900, 220), { zoomMax: 1.5, margem: 20 });
        await palco.destacar(caixa(c.x - 82, c.y - 22, 880, 100), { folga: 4 });
        await palco.mover(nome, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 300 });
        await voltarAoPainel(palco);
      },
    },
    {
      capitulo: "Preço por canal",
      fala: "Agora o preço por canal. No lápis do produto, abra Preço diferente por canal.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(ALTURA_DA_LISTA);
        await abrirEdicao(palco, PRODUTO);
        await ctx.ate(0.5);
        await palco.destacar(abaDeCanais(p), { folga: 4 });
        await ctx.ate(0.72);
        await palco.apagarDestaque();
        await palco.clicar(abaDeCanais(p));
        await canais(p).first().waitFor({ state: "visible", timeout: 5000 });
        await palco.rolarAte(canais(p).first(), { bloco: "center" });
        await ctx.ate(1);
      },
    },
    {
      fala: "São três campos: Balcão e mesa, Delivery e Totem. Embaixo de cada um, a tela diz onde aquele preço vale. Preencha só o canal que muda: canal em branco usa o Preço de Venda.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const grade = canais(p).first().locator("xpath=../..");
        await palco.camera([abaDeCanais(p), grade], { zoomMax: 1.6, margem: 30 });
        await palco.destacar(grade, { folga: 8 });
        for (const [i, f] of [0.12, 0.2, 0.28].entries()) {
          await ctx.ate(f);
          await palco.mover(canais(p).nth(i), { ms: 450 });
        }
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.digitar(canais(p).nth(1), "29");
        await palco.digitar(canais(p).nth(0), "20");
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Promoção e canal juntos",
      fala: "E quando o produto tem promoção e preço por canal? A promoção só vale no canal em que ela é mais barata. Aqui o delivery cobra mais que a promoção: lá o cliente paga o preço promocional. O balcão já cobra menos: continua com o preço dele.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const regra = janela(p).getByText(/A promoção de/);
        await palco.destacar(regra, { folga: 6 });
        await palco.mover(regra, { ms: 700 });
        await ctx.ate(0.42);
        await palco.destacar(canais(p).nth(1).locator("xpath=.."), { folga: 8 });
        await palco.mover(canais(p).nth(1), { ms: 600 });
        await ctx.ate(0.76);
        await palco.destacar(canais(p).nth(0).locator("xpath=.."), { folga: 8 });
        await palco.mover(canais(p).nth(0), { ms: 600 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Tirar a promoção",
      fala: "Para encerrar a promoção, apague o campo do Preço promocional e salve. Cada canal volta ao seu preço normal.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(campo.faixaDaPromo(p), { bloco: "center" });
        await palco.camera([campo.preco(p), campo.faixaDaPromo(p)], { zoomMax: 1.5, margem: 36, ms: 500 });
        await redigitar(palco, campo.promo(p), "");
        await ctx.ate(0.4);
        await palco.cameraAberta({ ms: 400 });
        await palco.rolarAte(campo.salvar(p), { bloco: "end" });
        await palco.clicar(campo.salvar(p));
        await esperarFechar(palco);
        // "R$ 27,00" também é o texto do preço riscado: a prova de que a lista
        // recarregou sem a promoção é o selo PROMO sumir. Sem esperar por isso,
        // a linha ainda encolhe e o clique seguinte cai fora do lugar.
        await linha(p, PRODUTO).getByText("PROMO", { exact: true }).waitFor({ state: "hidden", timeout: 15_000 });
        await dormir(300);
        await rolarSePreciso(palco, ALTURA_DA_LISTA);
        const preco = linha(p, PRODUTO).getByText("R$ 27,00");
        await preco.waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(preco, { folga: 8 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Preço por canal nas opções",
      fala: "Em combo e em pizza, quando o preço está nas opções, o preço por canal fica junto delas. No formulário do combo, abra Preço diferente por canal nas opções: cada opção ganha os três campos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await abrirEdicao(palco, COMBO);
        const aba = janela(p).getByRole("button", { name: /Preço diferente por canal nas opções/ });
        await palco.rolarAte(aba, { bloco: "start" });
        await ctx.ate(0.4);
        await palco.destacar(aba, { folga: 4 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.clicar(aba);
        const guarana = janela(p).getByText("Guaraná 2 L").first().locator("xpath=..");
        await palco.rolarAte(guarana, { bloco: "center" });
        await palco.camera(guarana, { zoomMax: 1.5, margem: 40 });
        await palco.destacar(guarana, { folga: 4 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
        await fecharSemClicar(palco);
      },
    },
    cenaFinal("Para rever este vídeo, é só clicar em Tutorial, aqui no topo. Na janela do Tutorial ficam também os outros vídeos do cardápio: produtos, combos e organização."),
  ],
};
