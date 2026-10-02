// Tutorial da tela do Balcão (/store/venda-presencial).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// A venda do vídeo é uma só: a Juliana, no balcão, leva dois X-Bacon e uma
// Coca-Cola e paga metade em dinheiro, metade no Pix. No meio, a tela passa
// por Delivery só para mostrar o endereço e a taxa — e volta para Balcão.
import { dormir } from "../motor/palco.mjs";

const produto = (p, nome) => p.locator(".pdv-produtos > div").filter({ hasText: nome }).first();
const categoria = (p, nome) => p.getByRole("button", { name: nome, exact: true });
/** A linha do item dentro do pedido (lado direito). */
const linha = (p, nome) => p.locator(".pdv-itens > div").filter({ hasText: nome }).first();
const tipo = (p, rotulo) => p.locator(".pdv-tipo button").filter({ hasText: rotulo });
const forma = (p, nome) => p.locator(".pdv-rodape").getByRole("button", { name: nome, exact: true });
const menu = (p, rota) => p.locator(`nav.fh-menu-lista a[href="/store/${rota}"]`);
const cabecalho = (p) => p.locator(".pdv-cabecalho");
const rodape = (p) => p.locator(".pdv-rodape");
/** O total e o botão de finalizar, que ficam grudados no pé do painel. */
const acao = (p) => p.locator(".pdv-acao");

/**
 * Rola o rodapé do pedido (forma de pagamento, troco, divisão) até o alvo ficar
 * à vista ACIMA do total, que é grudado embaixo e tamparia o fim do bloco.
 * O `rolarAte` do palco alinha pela borda da caixa de rolagem, que aqui fica
 * atrás do total.
 */
async function rolarRodape(alvo, folga = 10) {
  await alvo.evaluate((el, f) => {
    const rolo = el.closest(".pdv-rodape");
    const grudado = rolo.querySelector(".pdv-acao").getBoundingClientRect();
    const r = el.getBoundingClientRect(), c = rolo.getBoundingClientRect();
    let passo = 0;
    if (r.bottom > grudado.top - f) passo = r.bottom - (grudado.top - f);
    else if (r.top < c.top + f) passo = r.top - (c.top + f);
    rolo.scrollTo({ top: rolo.scrollTop + passo, behavior: "smooth" });
  }, folga);
  await dormir(700);
}

/** Espera o elemento parar de mudar de lugar (tela que acabou de abrir ainda se arruma). */
async function assentar(alvo) {
  let antes = null;
  for (let i = 0; i < 20; i++) {
    const c = await alvo.boundingBox();
    const agora = c ? [c.x, c.y, c.width, c.height].map(Math.round).join() : "";
    if (agora && agora === antes) return;
    antes = agora;
    await dormir(250);
  }
}

/** Troca o que está escrito num campo: clica, seleciona tudo e digita por cima. */
async function digitarPorCima(palco, alvo, texto) {
  await palco.clicar(alvo);
  await palco.pagina.keyboard.press("Control+A");
  await palco.pagina.keyboard.type(texto, { delay: 110 });
  await dormir(300);
}

export default {
  id: "balcao",
  titulo: "Como vender no balcão",
  rota: "store/venda-presencial",
  prontaQuando: ".pdv-produtos > div",
  // A barra de "Voucher/Vale" é só escrita: a voz diz as duas palavras.
  pronuncia: { "Voucher/Vale": "Voucher Vale" },

  async preparar(prisma, { loja, haMin }) {
    await prisma.user.update({
      where: { id: loja.id },
      data: {
        // Loja que entrega POR BAIRRO: a taxa sai do bairro escolhido, sem
        // consultar mapa nenhum (o ambiente de gravação não depende de internet).
        deliveryZoneType: "NEIGHBORHOOD",
        deliveryZones: [
          { name: "Centro", fee: 5, time: 30 },
          { name: "Jardim América", fee: 7, time: 40 },
          { name: "Vila Nova", fee: 9, time: 50 },
        ],
        // O vídeo digita um telefone (fictício): com isto a loja não tenta
        // mandar mensagem de pedido para ninguém.
        chatbotConfig: { sendOrderNotifications: false },
      },
    });
    // A coluna Em Produção começa vazia: a venda do vídeo é o cartão do topo dela.
    await prisma.customerOrder.updateMany({
      where: { franchiseeId: loja.id, status: { in: ["ACEITO", "PREPARANDO"] } },
      data: { status: "ENTREGUE", deliveredAt: haMin(3) },
    });
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Este é o Balcão. É aqui que você lança a venda de quem está na loja e o pedido de quem liga pedindo. Para vender, o caixa precisa estar aberto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(900);
        await palco.mover({ x: 620, y: 330 }, { ms: 1200 });
        await ctx.ate(0.72);
        const caixa = p.getByRole("button", { name: /Caixa aberto/ });
        await palco.destacar(caixa, { folga: 6 });
        await palco.mover(caixa, { ms: 800 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Escolher os produtos",
      fala: "Do lado esquerdo fica o cardápio. Clique numa categoria para ver só os produtos dela, e clique no produto para colocar no pedido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([categoria(p, "Todos"), p.locator(".pdv-produtos")], { zoomMax: 1.5, margem: 40 });
        await ctx.ate(0.22);
        await palco.clicar(categoria(p, "Lanches"));
        await ctx.ate(0.62);
        await palco.clicar(produto(p, "X-Bacon"));
        await linha(p, "X-Bacon").waitFor({ state: "visible", timeout: 8000 });
        await palco.camera([produto(p, "X-Bacon"), p.locator(".pdv-itens")], { zoomMax: 1.5, margem: 50, ms: 650 });
        await palco.destacar(linha(p, "X-Bacon"), { folga: 4 });
        await palco.mover(linha(p, "X-Bacon").getByText("X-Bacon", { exact: true }), { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Para procurar no cardápio inteiro, volte em Todos e digite o nome na busca. Achou, é só clicar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const busca = p.getByPlaceholder("Buscar produto...");
        await palco.camera([busca, p.locator(".pdv-produtos")], { zoomMax: 1.5, margem: 40, ms: 500 });
        await ctx.ate(0.22);
        await palco.clicar(categoria(p, "Todos"));
        await palco.digitar(busca, "coca");
        await ctx.ate(0.82);
        await palco.clicar(produto(p, "Coca-Cola lata"));
        await linha(p, "Coca-Cola lata").waitFor({ state: "visible", timeout: 8000 });
        await dormir(500);
        await busca.fill("");
        await dormir(300);
      },
    },
    {
      capitulo: "Quantidade e observação",
      fala: "No pedido, o botão de mais aumenta a quantidade, e o de menos diminui.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const item = linha(p, "X-Bacon");
        await palco.camera(p.locator(".pdv-itens"), { zoomMax: 1.8, margem: 60 });
        await ctx.ate(0.2);
        await palco.clicar(item.locator("button").last());
        await palco.clicar(item.locator("button").last());
        await ctx.ate(0.75);
        await palco.clicar(item.locator("button").first());
        await ctx.ate(1);
      },
    },
    {
      fala: "Embaixo do nome do item você escreve a observação, como: sem cebola. Ela vai junto para a cozinha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const obs = linha(p, "X-Bacon").getByPlaceholder(/obs\. do item/);
        await palco.destacar(obs, { folga: 5 });
        await ctx.ate(0.25);
        await palco.apagarDestaque();
        await palco.digitar(obs, "sem cebola");
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Balcão, Mesa ou Delivery",
      fala: "Aqui em cima você escolhe o tipo da venda: Balcão, Mesa ou Delivery. No Balcão, o nome e o telefone do cliente são opcionais.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera(cabecalho(p), { zoomMax: 1.8, margem: 50 });
        await palco.destacar(p.locator(".pdv-tipo"), { folga: 5 });
        await ctx.ate(0.3);
        await palco.mover(tipo(p, "Balcão"), { ms: 400 });
        await ctx.ate(0.38);
        await palco.mover(tipo(p, "Mesa"), { ms: 400 });
        await ctx.ate(0.46);
        await palco.mover(tipo(p, "Delivery"), { ms: 400 });
        await ctx.ate(0.56);
        await palco.apagarDestaque();
        await palco.digitar(p.getByPlaceholder("Nome (opcional)"), "Juliana");
        await palco.digitar(p.getByPlaceholder("Telefone"), "11977770009");
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Venda para entrega",
      fala: "Se for para entregar, clique em Delivery e digite o endereço. Nesta loja, que entrega por bairro, o bairro se escolhe na lista.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.18);
        await palco.clicar(tipo(p, "Delivery"));
        const rua = p.getByPlaceholder("Rua e número *");
        await rua.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(cabecalho(p), { zoomMax: 1.8, margem: 50, ms: 500 });
        await palco.digitar(rua, "Rua das Acácias, 120");
        await ctx.ate(0.72);
        const lista = cabecalho(p).locator("select");
        await palco.destacar(lista, { folga: 5 });
        await palco.apontar(lista);
        await lista.selectOption({ label: "Centro — R$ 5,00" });
        await p.getByText(/Bairro atendido: Centro/).waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "A taxa de entrega aparece sozinha e entra no total. Se combinou outro valor com o cliente, é só digitar por cima.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const taxa = cabecalho(p).locator('input[type="number"]');
        const linhaDaTaxa = taxa.locator("xpath=../..");
        await palco.destacar(linhaDaTaxa, { folga: 5 });
        await palco.mover(taxa, { ms: 600 });
        await ctx.ate(0.3);
        // a taxa (em cima) e o total (embaixo) na mesma imagem
        await palco.camera([linhaDaTaxa, acao(p)], { zoomMax: 1.6, margem: 18, ms: 650 });
        await palco.destacar(acao(p).locator("div").filter({ hasText: /^TOTAL/ }).first().locator("xpath=.."), { folga: 4 });
        await palco.mover(acao(p).getByText("Entrega"), { ms: 600 });
        await ctx.ate(0.58);
        await palco.apagarDestaque();
        await palco.camera(cabecalho(p), { zoomMax: 1.8, margem: 50, ms: 600 });
        await digitarPorCima(palco, taxa, "8");
        await ctx.ate(1);
        await dormir(500);
      },
    },
    {
      fala: "Esta cliente vai retirar aqui, então volto para Balcão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.45);
        await palco.clicar(tipo(p, "Balcão"));
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Pagamento e troco",
      fala: "Agora o pagamento: pode ser em Dinheiro, no PIX, no Cartão Débito, no Cartão Crédito ou em Voucher/Vale.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera(rodape(p), { zoomMax: 1.8, margem: 40 });
        const formas = ["Dinheiro", "PIX", "Cartão Débito", "Cartão Crédito", "Voucher/Vale"];
        await palco.destacar(formas.map((f) => forma(p, f)), { folga: 6 });
        for (const [i, f] of formas.entries()) {
          await ctx.ate(0.3 + i * 0.14);
          await palco.mover(forma(p, f), { ms: 380 });
        }
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em Dinheiro, digite quanto o cliente vai entregar, e a tela já mostra o troco.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(forma(p, "Dinheiro"));
        await ctx.ate(0.3);
        await palco.digitar(p.getByPlaceholder("Troco para... (opcional)"), "100");
        const troco = p.getByText(/Troco: R\$/);
        await troco.waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(troco, { folga: 4 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Dividir o pagamento",
      fala: "Se o cliente quer pagar em duas formas, clique em Dividir. Digite o valor da primeira e, na segunda, clique em resto: a tela completa o que falta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.2);
        await palco.clicar(rodape(p).getByRole("button", { name: /Dividir/ }));
        const caixa = p.getByText(/^Pagamento dividido/).locator("xpath=..");
        await caixa.waitFor({ state: "visible", timeout: 8000 });
        await rolarRodape(caixa);
        await ctx.ate(0.42);
        await palco.digitar(caixa.locator('input[type="number"]').first(), "30");
        await ctx.ate(0.68);
        await palco.clicar(caixa.getByRole("button", { name: "resto" }).nth(1));
        const fecha = caixa.getByText(/fecha R\$/);
        await fecha.waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(fecha, { folga: 5 });
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Finalizar a venda",
      fala: "Confira o total e clique em Finalizar Pedido. A tela avisa que o pedido foi registrado e fica limpa para a próxima venda.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const finalizar = p.locator('button[data-btn="finalizar"]');
        await palco.destacar(acao(p), { folga: 4 });
        await palco.mover(acao(p).getByText("TOTAL"), { ms: 600 });
        await ctx.ate(0.22);
        await palco.apagarDestaque();
        await palco.clicar(finalizar);
        const aviso = p.getByText("Pedido registrado!");
        await aviso.waitFor({ state: "visible", timeout: 15_000 });
        await palco.destacar(aviso, { folga: 6 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await palco.cameraAberta();
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Onde o pedido aparece",
      fala: "Para ver a venda, abra a tela de Pedidos. Ela já entra aceita, na coluna Em Produção.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(menu(p, "pedidos-clientes"));
        const coluna = p.locator('[data-droppable="col-preparo"]');
        const cartao = coluna.locator("[draggable]").filter({ hasText: "Juliana" }).first();
        await cartao.waitFor({ state: "visible", timeout: 30_000 });
        await palco.rolarPagina(160);
        await assentar(cartao);
        await palco.camera([coluna.locator("h3").first(), cartao], { zoomMax: 1.5, margem: 50, ms: 600 });
        await ctx.ate(0.45);
        await palco.destacar([coluna.locator("h3").first(), cartao], { folga: 8 });
        await palco.mover(cartao.getByText(/Juliana/).first(), { ms: 700 });
        await ctx.ate(1);
        await dormir(900);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
        await palco.rolarPagina(0);
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso você já vende pelo balcão. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(menu(p, "venda-presencial"));
        await p.locator(".pdv-produtos > div").first().waitFor({ state: "visible", timeout: 30_000 });
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
