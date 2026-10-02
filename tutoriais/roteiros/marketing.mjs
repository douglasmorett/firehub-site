// Tutorial da tela Marketing & cupons (/store/marketing) — e de onde o cupom
// se cria de verdade (/store/minha-loja#cupons).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que foi conferido no código antes de escrever:
// - o menu chama a tela de "Marketing & cupons", mas ela NÃO tem cupom: são
//   três abas (MarketingHubClient) — disparo em massa, automação de 7/15/30
//   dias e base de clientes. O cupom se cadastra em Minha loja › Cupons
//   (StoreSettingsForm, aba "coupons"; a régua é lib/cupons.ts);
// - o disparo em massa está desligado para todas as lojas por uma constante
//   (lib/disparo-em-massa.ts) e a própria tela escreve o motivo;
// - a automação só envia o que foi SALVO como ativado (o cron
//   api/cron/recuperacao-clientes exige `=== true` gravado, e a tela mostra
//   "ATIVADO" mesmo antes de salvar), pelo WhatsApp da própria loja;
// - cupom: tipo porcentagem, valor fixo ou frete grátis; pedido mínimo,
//   validade e usos por cliente são opcionais (0/vazio = sem limite); cupom
//   desmarcado em "Ativo" não vale (acharCupom); o de 1º pedido é aplicado
//   sozinho pelo site para quem nunca pediu por ele;
// - "Salvar Cupons" não mostra aviso: o botão fica cinza quando gravou.
//
// Nada é enviado nesta gravação: o botão de disparo está desligado e só é
// apontado; salvar as regras da automação grava a configuração e não manda
// mensagem (quem manda é um agendamento do servidor, que o ambiente não tem).
import { dormir } from "../motor/palco.mjs";

const menu = (p, rota) => p.locator(`nav.fh-menu-lista a.fh-menu-item[href="/store/${rota}"]`);
const menuCupons = (p) => p.locator('nav.fh-menu-lista a.fh-menu-filho[href="/store/minha-loja#cupons"]');
const aba = (p, nome) => p.getByRole("button", { name: nome });
/** O bloco de um dos três incentivos da automação (título, botão e mensagem). */
const incentivo = (p, dias) => p.getByText(new RegExp(`Cliente ${dias} Dias Sem Pedir`)).locator("xpath=../..");
/** A linha de um cupom, pela posição na lista (a caixa inteira, com as regras). */
const cupom = (p, i) => p.getByPlaceholder("CÓDIGO").nth(i).locator("xpath=../..");
const regra = (linha, rotulo) => linha.getByText(rotulo).locator("xpath=..");
const salvarCupons = (p) => p.getByRole("button", { name: /Salvar Cupons/ });
const PULSO = "#contact-widget-fab{animation:none !important}";

/** Troca o que está escrito num campo: clica, seleciona tudo e digita por cima. */
async function digitarPorCima(palco, alvo, texto) {
  await palco.clicar(alvo, { ms: 450 });
  await palco.pagina.keyboard.press("Control+A");
  await palco.pagina.keyboard.type(texto, { delay: 110 });
  await dormir(250);
}

/** Daqui a um mês, como a pessoa digita no campo de data: dia, mês e ano. */
function daquiAUmMes() {
  const d = new Date(Date.now() + 30 * 86_400_000);
  return `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;
}

export default {
  id: "marketing",
  titulo: "Marketing e cupons",
  rota: "store/marketing",
  prontaQuando: "text=Paula Ribeiro",

  /** Um cupom que a loja já tinha, para mostrar como pausar sem apagar. */
  async preparar(prisma, { loja }) {
    await prisma.user.update({
      where: { id: loja.id },
      data: { storeCoupons: [{ code: "VOLTEI10", discount: 10, type: "percent", active: true, minOrderValue: 0 }] },
    });
  },

  /**
   * Duas coisas, fora da câmera:
   * - o botão flutuante de ajuda pulsa sem parar e cada pulso é um quadro novo
   *   na captura; só o pulso para (a regra é reposta a cada troca de página);
   * - salvar os cupons recarrega os dados da tela e o painel aproveita para
   *   adiantar (prefetch) as telas do menu; no banco da gravação, que atende
   *   uma consulta por vez, isso trava a tela por segundos. Só o adiantamento
   *   é dispensado; o que aparece na imagem é igual.
   */
  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
    await p.addStyleTag({ content: PULSO });
    await p.evaluate(() => window.scrollTo({ top: 0 }));
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Marketing e cupons. Ela cuida das mensagens de WhatsApp para os clientes e mostra a base de quem já pediu. O cupom de desconto fica em outra tela, que este vídeo também mostra.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(400);
        await palco.destacar(menu(p, "marketing"), { folga: 4 });
        await palco.mover(menu(p, "marketing"), { ms: 800 });
        await ctx.ate(0.26);
        await palco.apagarDestaque();
        const abas = aba(p, /Disparo em Massa/).locator("xpath=..");
        await palco.destacar(abas, { folga: 4 });
        await palco.mover(aba(p, /Automação Recorrente/), { ms: 800 });
        await ctx.ate(0.6);
        await palco.mover(aba(p, /Base de Clientes/), { ms: 600 });
        await ctx.ate(0.68);
        await palco.apagarDestaque();
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Disparo em massa",
      fala: "A primeira aba é o Disparo em Massa. Hoje ele está desligado para todas as lojas, e a tela explica o motivo: o WhatsApp bane o número que manda mensagem para quem não pediu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.mover(aba(p, /Disparo em Massa/), { ms: 600 });
        await ctx.ate(0.2);
        await palco.rolarPagina(230);
        const aviso = p.getByText("Disparo de campanha desligado").locator("xpath=..");
        const botao = p.getByRole("button", { name: /Disparo desligado/ });
        await palco.camera([aviso, botao], { zoomMax: 1.35, margem: 30, ms: 600 });
        await palco.destacar(aviso, { folga: 4 });
        await palco.mover(aviso, { ms: 600 });
        await ctx.ate(0.8);
        await palco.destacar(botao, { folga: 5 });
        await palco.mover(botao, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Automação recorrente",
      fala: "Na Automação Recorrente fica a mensagem para o cliente que está há 7, 15 ou 30 dias sem pedir. Cada uma pode ser reescrita, e ativada ou desativada neste botão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await palco.clicar(aba(p, /Automação Recorrente/), { ms: 500 });
        await incentivo(p, 7).waitFor({ state: "visible", timeout: 8000 });
        await palco.rolarPagina(400);
        await ctx.ate(0.3);
        for (const [i, dias] of [7, 15, 30].entries()) {
          await ctx.ate(0.3 + i * 0.1);
          await palco.destacar(incentivo(p, dias), { folga: 2 });
          await palco.mover(incentivo(p, dias).locator("textarea"), { ms: 350 });
        }
        await ctx.ate(0.72);
        await palco.apagarDestaque();
        const botao = incentivo(p, 30).getByRole("button");
        await palco.clicar(botao, { ms: 500 });
        await palco.destacar(botao, { folga: 6 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "As regras só passam a valer depois de salvar. Clique em Salvar Regras de Automação Automáticas. O envio sai pelo WhatsApp conectado da loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const salvar = p.getByRole("button", { name: /Salvar Regras de Automação/ });
        await palco.destacar(salvar, { folga: 5 });
        await palco.mover(salvar, { ms: 600 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.clicar(salvar, { ms: 200 });
        const aviso = p.getByText("Automações de Marketing salvas com sucesso");
        await aviso.waitFor({ state: "visible", timeout: 15_000 });
        await palco.destacar(aviso, { folga: 4 });
        await palco.mover(aviso, { ms: 700 });
        // o aviso some sozinho em cinco segundos: o destaque sai antes, para não contornar um lugar vazio
        await ctx.ate(0.74);
        await palco.apagarDestaque();
        await palco.mover(p.getByRole("heading", { name: /Automação Inteligente/ }), { ms: 700 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Base de clientes",
      fala: "A Base de Clientes mostra quem já pediu na loja ou falou com o robô, com o WhatsApp e o total de pedidos, e tem uma busca por nome ou número.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await palco.clicar(aba(p, /Base de Clientes/), { ms: 500 });
        const tabela = p.locator("table");
        await tabela.waitFor({ state: "visible", timeout: 8000 });
        await palco.rolarPagina(170);
        await palco.mover(tabela.getByText("Carlos Mendes"), { ms: 500 });
        await ctx.ate(0.45);
        await palco.mover(tabela.getByText("Total de Pedidos"), { ms: 500 });
        await ctx.ate(0.68);
        await palco.digitar(p.getByPlaceholder("Buscar por nome ou número..."), "Lucas");
        await ctx.ate(1);
        await dormir(500);
      },
    },
    {
      capitulo: "Onde se cria o cupom",
      fala: "Já o cupom de desconto não se cria aqui. Ele fica em Minha loja, Cupons.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const minhaLoja = menu(p, "minha-loja");
        await palco.rolarAte(minhaLoja, { bloco: "center" });
        await ctx.ate(0.3);
        await palco.clicar(minhaLoja.locator("xpath=..").locator("button.fh-menu-abrir"), { ms: 500 });
        await menuCupons(p).waitFor({ state: "visible", timeout: 8000 });
        await palco.rolarAte(menuCupons(p), { bloco: "center" });
        await palco.destacar([minhaLoja, menuCupons(p)], { folga: 6 });
        await ctx.ate(0.8);
        await palco.apagarDestaque();
        await palco.clicar(menuCupons(p), { ms: 400 });
        await p.getByRole("heading", { name: /Cupons de Desconto/ }).waitFor({ state: "visible", timeout: 60_000 });
        await cupom(p, 0).waitFor({ state: "visible", timeout: 30_000 });
        await p.addStyleTag({ content: PULSO }).catch(() => {});
        await dormir(400);
      },
    },
    {
      capitulo: "Criar um cupom",
      fala: "Clique em Novo Cupom e digite o código que o cliente vai usar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const novo = p.getByRole("button", { name: /Novo Cupom/ });
        await palco.clicar(novo, { ms: 600 });
        await cupom(p, 1).waitFor({ state: "visible", timeout: 8000 });
        await palco.camera([p.getByRole("heading", { name: /Cupons de Desconto/ }), novo, cupom(p, 1)], { zoomMax: 1.5, margem: 30, ms: 500 });
        await palco.digitar(p.getByPlaceholder("CÓDIGO").nth(1), "SEXTA15");
        await ctx.ate(1);
      },
    },
    {
      fala: "Escolha o tipo: porcentagem, valor fixo em reais ou frete grátis. E preencha o valor do desconto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const linha = cupom(p, 1);
        const lista = linha.locator("select");
        await palco.destacar(lista, { folga: 5 });
        await palco.apontar(lista, { ms: 500 });
        await ctx.ate(0.35);
        await lista.selectOption("fixed");
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await digitarPorCima(palco, linha.locator("input[type=number]").first(), "15");
        await ctx.ate(1);
      },
    },
    {
      capitulo: "As regras do cupom",
      fala: "Embaixo ficam as regras: o pedido mínimo, até que dia o cupom vale e quantas vezes o mesmo cliente pode usar. Deixando em branco ou zero, não tem limite.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const linha = cupom(p, 1);
        await ctx.ate(0.12);
        await digitarPorCima(palco, regra(linha, "Pedido mín. R$").locator("input"), "50");
        await ctx.ate(0.3);
        // Campo de data: clica na parte do DIA (a esquerda do campo) e digita dia, mês e ano.
        const data = linha.locator("input[type=date]");
        const c = await data.boundingBox();
        await palco.clicar({ x: c.x + 14, y: c.y + c.height / 2 }, { ms: 450 });
        await p.keyboard.type(daquiAUmMes(), { delay: 90 });
        await ctx.ate(0.55);
        await digitarPorCima(palco, regra(linha, "Usos por cliente").locator("input"), "1");
        await ctx.ate(0.75);
        // a linha de regras do cupom de cima, que está sem limite nenhum: "(sem prazo)" e "(sem limite)"
        await palco.destacar(cupom(p, 0).locator("xpath=./div[2]"), { folga: 4 });
        await palco.mover(regra(cupom(p, 0), "Usos por cliente"), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Cupom de primeiro pedido",
      fala: "O botão Cupom de primeiro pedido cria um desconto que o site aplica sozinho para quem nunca pediu pelo site da loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /Cupom de 1º pedido/ });
        await palco.destacar(botao, { folga: 5 });
        await palco.mover(botao, { ms: 500 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(botao, { ms: 200 });
        await cupom(p, 2).waitFor({ state: "visible", timeout: 8000 });
        await palco.camera([p.getByRole("heading", { name: /Cupons de Desconto/ }), botao, cupom(p, 2)], { zoomMax: 1.5, margem: 30, ms: 500 });
        await palco.destacar(cupom(p, 2), { folga: 4 });
        await palco.mover(cupom(p, 2).getByText(/Vale só para quem nunca pediu/), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Pausar e salvar",
      fala: "Para pausar um cupom sem apagar, é só desmarcar Ativo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const ativo = cupom(p, 0).locator("label", { hasText: "Ativo" });
        await palco.destacar(cupom(p, 0), { folga: 4 });
        await ctx.ate(0.45);
        await palco.apagarDestaque();
        await palco.clicar(ativo.locator("input"), { ms: 500 });
        await palco.destacar(ativo, { folga: 6 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "No fim, clique em Salvar Cupons.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([cupom(p, 1), salvarCupons(p)], { zoomMax: 1.5, margem: 30, ms: 500 });
        await palco.destacar(salvarCupons(p), { folga: 5 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.clicar(salvarCupons(p), { ms: 400 });
        await p.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Salvar Cupons/.test(b.textContent) && b.disabled), null, { timeout: 20_000 });
      },
    },
    {
      fala: "O botão fica cinza quando está gravado, e o cliente já pode digitar o código ao fechar o pedido no site.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(salvarCupons(p), { folga: 5 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.destacar(p.getByPlaceholder("CÓDIGO").nth(1), { folga: 5 });
        await palco.mover(p.getByPlaceholder("CÓDIGO").nth(1), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "De volta em Marketing e cupons: para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(menu(p, "marketing"), { ms: 500 });
        await p.getByRole("heading", { name: /Marketing & Disparos/ }).waitFor({ state: "visible", timeout: 60_000 });
        await p.addStyleTag({ content: PULSO }).catch(() => {});
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        await ctx.ate(0.5);
        if (await botao.count()) {
          await palco.destacar(botao, { folga: 6 });
          await palco.mover(botao, { ms: 700 });
        }
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
