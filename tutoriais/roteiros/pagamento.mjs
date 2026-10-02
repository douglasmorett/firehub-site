// Tutorial de Minha loja › Pagamento (/store/minha-loja#pagamento).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que foi conferido no código (e no cardápio, clicando) antes de escrever:
// - Pix e cartão pelo site moram em Integrações → Asaas; esta seção só tem o
//   atalho. A janela de lá pede a chave de API e o aceite das regras
//   (PagamentoOnlineAsaas). O vídeo mostra onde fica e o que pede: NÃO digita
//   chave, NÃO marca o aceite, NÃO conecta;
// - sem o Asaas, o cardápio oferece "Pix (na entrega)" (CustomerStorePage,
//   paymentOptions);
// - as bandeiras de VALE marcadas viram opção de pagamento no cardápio do
//   cliente (mesmo lugar) e no Balcão ("Qual vale?").
//
// Fora da fala, de propósito — porque o código não cumpre o que a tela sugere:
// - as chaves de Dinheiro, Crédito e Débito e as bandeiras de cartão são
//   gravadas, mas o cardápio mostra "Dinheiro", "Débito (Entrega)", "Crédito
//   (Entrega)" e "Pix (na entrega)" sempre, ligadas ou não. A fala só diz que
//   cada forma tem a sua chave; não promete que desligar tira do cardápio;
// - o campo "% de acréscimo" do voucher não é lido por ninguém (o Balcão cobra
//   a taxa escondida de cada bandeira). O vídeo não fala dele;
// - "a taxa % será usada para calcular seu lucro": a tela não tem campo de taxa.
//
// A ordem das cenas evita voltar a esta tela no meio do vídeo: abrir Minha loja
// por um link mostra primeiro o menu de cartões e só depois a seção (a página
// escolhe a seção depois de carregar), o que na gravação vira segundos parados.
import { dormir } from "../motor/palco.mjs";

const menuMinhaLoja = (p) => p.locator('nav.fh-menu-lista a.fh-menu-item[href="/store/minha-loja"]');
const menuPagamento = (p) => p.locator('nav.fh-menu-lista a.fh-menu-filho[href="/store/minha-loja#pagamento"]');
const atalhoDoAsaas = (p) => p.locator('a[href="/store/integracoes?abrir=asaas"]');
/** A linha do Dinheiro (ícone, nome e chave). */
const dinheiro = (p) => p.getByText("Dinheiro", { exact: true }).locator("xpath=../..");
/** O cartão de uma forma com bandeiras: "Cartão de crédito", "Cartão de débito", "Voucher / Vale". */
const forma = (p, nome) => p.getByText(nome, { exact: true }).locator("xpath=../../..");
// (sem "exact": a etiqueta da bandeira traz o "✓" junto do nome)
const bandeira = (p, nomeDaForma, nome) => forma(p, nomeDaForma).getByText(nome).first();
const salvar = (p) => p.getByRole("button", { name: "Salvar Formas de Pagamento" });

/** O botão flutuante de ajuda pulsa sem parar e enche a captura de quadros; a cada página nova, só o pulso para. */
const calarPulso = (p) => p.addStyleTag({ content: "#contact-widget-fab{animation:none !important}" }).catch(() => {});

/** Rola a PÁGINA até o alvo ficar a `topo` pixels do alto da tela (o rolarAte do palco só rola caixas internas). */
async function rolarPaginaPara(palco, alvo, topo = 120) {
  const c = await alvo.boundingBox();
  const y = await palco.pagina.evaluate(() => window.scrollY);
  await palco.rolarPagina(Math.max(0, Math.round(y + c.y - topo)));
}

// O cadastro com que a loja-base começa: tudo ligado, como a tela mostra para quem nunca mexeu.
const cartoes = (taxas) => ["Mastercard", "Elo", "Visa", "Hipercard", "American Express"].map((name, i) => ({ name, rate: taxas[i], active: true }));
const FORMAS_DA_LOJA = {
  PIX: { rate: 0, active: true },
  DINHEIRO: { rate: 0, active: true },
  DEBITO: { rate: 0, active: true, brands: cartoes([1.5, 2, 1.5, 2, 2.5]) },
  CREDITO: { rate: 0, active: true, brands: cartoes([3, 3.5, 3, 3.5, 4]) },
  VOUCHER: {
    rate: 0, active: true, surcharge: 0,
    brands: [["Ticket", 5], ["VR", 5], ["Sodexo", 5], ["Pluxee", 4.5]].map(([name, rate]) => ({ name, rate, active: true })),
  },
};

export default {
  id: "pagamento",
  titulo: "Formas de pagamento da loja",
  rota: "store/minha-loja#pagamento",
  prontaQuando: "text=Pagamento na entrega",

  /** Formas já gravadas uma vez: o botão de salvar começa cinza e só acende quando a loja mexe. */
  async preparar(prisma, { loja }) {
    await prisma.user.update({ where: { id: loja.id }, data: { paymentFees: FORMAS_DA_LOJA } });
  },

  async antesDeGravar(palco) {
    await calarPulso(palco.pagina);
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Em Minha loja, Pagamento, ficam as formas de pagamento da loja: as que o cliente paga na entrega e o caminho para receber pelo site.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(500);
        await palco.rolarAte(menuPagamento(p), { bloco: "center" });
        await palco.destacar([menuMinhaLoja(p), menuPagamento(p)], { folga: 6 });
        await palco.mover(menuPagamento(p), { ms: 900 });
        await ctx.ate(0.45);
        await palco.apagarDestaque();
        await palco.mover(p.getByRole("heading", { name: /Formas de Pagamento/ }), { ms: 900 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Pagamento na entrega",
      fala: "Aqui ficam as formas pagas na entrega: em dinheiro, no cartão de crédito, no cartão de débito e em voucher. Cada uma tem a sua chave de ligar e desligar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaPara(palco, p.getByRole("heading", { name: /Pagamento na entrega/ }), 100);
        const titulos = [dinheiro(p), forma(p, "Cartão de crédito"), forma(p, "Cartão de débito")];
        for (const [i, alvo] of titulos.entries()) {
          await ctx.ate([0.22, 0.34, 0.46][i]);
          await palco.destacar(alvo, { folga: 4 });
          await palco.mover(alvo.locator("button").first(), { ms: 450 });
        }
        await ctx.ate(0.58);
        await palco.apagarDestaque();
        await rolarPaginaPara(palco, forma(p, "Voucher / Vale"), 330);
        await palco.destacar(forma(p, "Voucher / Vale"), { folga: 4 });
        await ctx.ate(0.78);
        await palco.destacar(forma(p, "Voucher / Vale").locator("button").first(), { folga: 6 });
        await palco.mover(forma(p, "Voucher / Vale").locator("button").first(), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Bandeiras",
      fala: "Nos cartões e no voucher, as bandeiras aceitas aparecem marcadas. Clique numa bandeira para desmarcar a que a loja não aceita.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([forma(p, "Cartão de débito"), forma(p, "Voucher / Vale")], { zoomMax: 1.3, margem: 30 });
        await palco.destacar([bandeira(p, "Cartão de débito", "Mastercard"), bandeira(p, "Cartão de débito", "American Express")], { folga: 8 });
        await ctx.ate(0.25);
        await palco.destacar([bandeira(p, "Voucher / Vale", "Ticket"), bandeira(p, "Voucher / Vale", "Pluxee")], { folga: 8 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.clicar(bandeira(p, "Voucher / Vale", "Sodexo"));
        await ctx.ate(1);
        await dormir(400);
      },
    },
    {
      fala: "Faltou alguma? Clique em Nova bandeira, escreva o nome e clique em Adicionar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const vale = forma(p, "Voucher / Vale");
        await palco.clicar(vale.getByRole("button", { name: "+ Nova bandeira" }));
        const nome = vale.getByPlaceholder("Nome do voucher...");
        await nome.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(vale, { zoomMax: 1.4, margem: 40, ms: 500 });
        await palco.digitar(nome, "Alelo");
        await palco.clicar(vale.getByRole("button", { name: "Adicionar" }));
        await bandeira(p, "Voucher / Vale", "Alelo").waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(bandeira(p, "Voucher / Vale", "Alelo"), { folga: 8 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Salvar",
      fala: "Depois de mexer, clique em Salvar Formas de Pagamento. Sem salvar, nada muda.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await rolarPaginaPara(palco, salvar(p), 560);
        await palco.destacar(salvar(p), { folga: 6 });
        await palco.mover(salvar(p), { ms: 600 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.clicar(salvar(p));
        await p.waitForFunction(() => {
          const b = [...document.querySelectorAll("button")].find((x) => /Salvar Formas de Pagamento/.test(x.textContent || ""));
          return b && b.disabled && !/Salvando/.test(b.textContent || "");
        }, null, { timeout: 15_000 });
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      capitulo: "Pix e cartão pelo site",
      fala: "Já o pagamento pelo site, em Pix ou no cartão, cai na sua conta Asaas. A conexão fica em outra tela: clique em Abrir Integrações.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await palco.camera(atalhoDoAsaas(p), { zoomMax: 1.4, margem: 50 });
        await palco.destacar(atalhoDoAsaas(p), { folga: 4 });
        await palco.mover(atalhoDoAsaas(p).getByText("Abrir Integrações →"), { ms: 800 });
        await ctx.ate(0.6);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
        await palco.clicar(atalhoDoAsaas(p).getByText("Abrir Integrações →"));
        await p.waitForURL(/integracoes/, { timeout: 30_000 });
        await calarPulso(p);
        await p.getByText("Cole a chave aqui e conecte").waitFor({ state: "visible", timeout: 60_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "A janela do Asaas mostra o custo por venda e o passo a passo para gerar a chave na sua conta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const custo = p.getByText(/^Custo por venda:/);
        await palco.camera([p.getByRole("heading", { name: "Pix e cartão pelo site (Asaas)" }), custo, p.getByText(/No Asaas, clique em/)], { zoomMax: 1.4, margem: 60 });
        await palco.destacar(custo, { folga: 5 });
        await palco.mover(custo, { ms: 700 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        await palco.mover(p.getByText(/No Asaas, clique em/), { ms: 600 });
        await ctx.ate(1);
        await dormir(200);
      },
    },
    {
      fala: "No fim, ela pede a chave de API da sua conta Asaas e o aceite das regras. Com a conta conectada e tudo certo nela, o Pix e o cartão pelo site entram no cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByText("Cole a chave aqui e conecte");
        const chave = p.getByLabel("Chave de API do Asaas");
        const aceite = p.getByText(/Aceito as regras e o custo por venda/).locator("xpath=ancestor::label");
        const cadeado = p.getByText(/A chave fica guardada criptografada/);
        await palco.rolarAte(chave, { bloco: "center" });
        await palco.camera([titulo, chave, cadeado], { zoomMax: 1.4, margem: 50, ms: 600 });
        await palco.destacar(chave, { folga: 5 });
        await palco.mover(chave, { ms: 600 });
        await ctx.ate(0.3);
        await palco.destacar(aceite, { folga: 5 });
        await palco.mover(aceite, { ms: 500 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await ctx.ate(0.62);
        await palco.destacar(cadeado, { folga: 5 });
        await palco.mover(cadeado, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "O que o cliente vê",
      fala: "Agora veja como fica para o cliente. Feche a janela e abra o cardápio. Lá, ele monta o pedido e, na hora de pagar, escolhe a forma de pagamento.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // o X da janela: o primeiro botão da caixa branca (ele não tem nome escrito)
        const fechar = p.locator('div[style*="modalIn"] > button').first();
        await palco.rolarAte(fechar, { bloco: "start" });
        await palco.clicar(fechar, { ms: 500 });
        await p.getByText("Cole a chave aqui e conecte").waitFor({ state: "hidden", timeout: 8000 });
        // "Ver meu cardápio" abre o cardápio em outra aba; a gravação mostra onde se clica e abre o mesmo endereço nesta.
        await palco.apontar(p.locator("a.fh-menu-cardapio"), { ms: 600 });
        await p.goto(`${ctx.BASE}/loja/sabor-da-praca`, { waitUntil: "load", timeout: 60_000 });
        await calarPulso(p);
        const produto = p.getByText("X-Burger", { exact: true }).first();
        await produto.waitFor({ state: "visible", timeout: 30_000 });
        await dormir(400);
        await palco.clicar(produto, { ms: 500 });
        await palco.clicar(p.getByRole("button", { name: /Adicionar à sacola/ }), { ms: 500 });
        await palco.clicar(p.getByRole("button", { name: /Continuar pedido/ }), { ms: 500 });
        const titulo = p.getByText("Forma de Pagamento", { exact: true });
        await titulo.waitFor({ state: "visible", timeout: 15_000 });
        await rolarPaginaPara(palco, titulo, 260);
        await ctx.ate(1);
      },
    },
    {
      fala: "Sem o Asaas, o Pix do cardápio é o Pix na entrega. E as bandeiras de vale que ficaram marcadas aparecem como opção; a que foi desmarcada não aparece. No Balcão é igual, ao escolher Voucher.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bloco = p.getByText("Forma de Pagamento", { exact: true }).locator("xpath=..");
        const opcao = (nome) => bloco.getByRole("button", { name: new RegExp(nome) });
        await palco.camera(bloco, { zoomMax: 1.6, margem: 70 });
        await palco.destacar(opcao("Pix"), { folga: 5 });
        await palco.mover(opcao("Pix"), { ms: 500 });
        await ctx.ate(0.3);
        await palco.destacar([opcao("Ticket"), opcao("VR")], { folga: 5 });
        await palco.mover(opcao("Ticket"), { ms: 400 });
        await ctx.ate(0.5);
        await palco.destacar([opcao("Pluxee"), opcao("Alelo")], { folga: 5 });
        await palco.mover(opcao("Alelo"), { ms: 400 });
        await ctx.ate(0.78);
        await palco.apagarDestaque();
        await ctx.ate(1);
        await dormir(300);
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso as formas de pagamento da loja ficam em dia. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.goto(`${ctx.BASE}/store/minha-loja#pagamento`, { waitUntil: "load", timeout: 60_000 });
        await p.getByText("Pagamento na entrega").first().waitFor({ state: "visible", timeout: 30_000 });
        await calarPulso(p);
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        await ctx.ate(0.5);
        if (await botao.count()) {
          await palco.destacar(botao, { folga: 6 });
          await palco.mover(botao, { ms: 900 });
        }
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
