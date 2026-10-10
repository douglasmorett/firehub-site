// Tutorial da tela de Pedidos (/store/pedidos-clientes).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
import { dormir } from "../motor/palco.mjs";
import { chegarPedidoNovo, encherOQuadro } from "../ambiente/semente.mjs";

const cartao = (p, n) => p.locator("[draggable]").filter({ hasText: `#${n} — ` }).first();
const coluna = (p, id) => p.locator(`[data-droppable="${id}"]`);
const cabecalho = (p, id) => coluna(p, id).locator("h3").first();
// O contador é o último selo do cabeçalho da coluna (o data-column-count saiu
// do painel: a extensão de prazo lê um span escondido no topo).
const contador = (p, id) => coluna(p, id).locator(":scope > div").first().locator("span").last();
/** Nome + contador da coluna, para o destaque pegar os dois. */
const topoDaColuna = (p, id) => [cabecalho(p, id), contador(p, id)];
/** O cartão já dentro de uma coluna específica (o mesmo pedido muda de coluna durante o vídeo). */
const cartaoEm = (p, id, n) => coluna(p, id).locator("[draggable]").filter({ hasText: `#${n} — ` }).first();

export default {
  id: "pedidos",
  titulo: "Como usar a tela de Pedidos",
  rota: "store/pedidos-clientes",
  /** A tela está pronta para gravar quando isto aparece. */
  prontaQuando: '[data-droppable="col-finalizado"] [draggable]',

  /**
   * A tela consulta os pedidos a cada ~8 s. Para o pedido novo aparecer logo no
   * começo da cena dele (e não 7 s depois), a gravação começa numa hora
   * calculada: mede-se o compasso das consultas e espera-se o ponto em que a
   * cena "Pedido novo chegando" cai ~2 s antes de uma consulta.
   */
  async antesDeGravar(palco, { vozes }) {
    const consultas = [];
    palco.pagina.on("response", (r) => { if (r.url().includes("/api/customer-order/poll")) consultas.push(Date.now()); });
    while (consultas.length < 2) await dormir(200);
    const compasso = consultas[1] - consultas[0];
    const ateACena = [0, 1].reduce((t, i) => t + (vozes[i]?.ms ?? 0) + 450, 250);
    let comeco = consultas[1] - ateACena - 2000;
    while (comeco < Date.now() + 300) comeco += compasso;
    await dormir(comeco - Date.now());
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Pedidos. É aqui que a loja trabalha o dia inteiro: todo pedido, do site, do WhatsApp, do iFood ou do balcão, aparece aqui.",
      acao: async (palco) => {
        await dormir(900);
        await palco.mover({ x: 760, y: 430 }, { ms: 1300 });
      },
    },
    {
      capitulo: "As colunas",
      fala: "Os pedidos andam em colunas, da esquerda para a direita: Novos, Em Produção, Saiu para Entrega e Finalizado. O número ao lado mostra quantos pedidos estão em cada etapa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(160);
        const etapas = ["col-novos", "col-preparo", "col-transporte", "col-finalizado"];
        await palco.destacar(etapas.flatMap((id) => topoDaColuna(p, id)), { folga: 8 });
        for (const [i, id] of etapas.entries()) {
          await ctx.ate(0.3 + i * 0.09);
          await palco.mover(cabecalho(p, id), { ms: 500 });
        }
        await ctx.ate(0.72);
        await palco.mover(contador(p, "col-finalizado"), { ms: 600 });
        await ctx.ate(0.98);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Pedido novo chegando",
      fala: "Quando entra um pedido, ele aparece na primeira coluna e a tela toca um aviso sonoro, que se repete até alguém aceitar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await chegarPedidoNovo(ctx.prisma);
        await palco.mover(cabecalho(p, "col-novos"), { ms: 700 });
        await cartao(p, 8).waitFor({ state: "visible", timeout: 20_000 });
        palco.som("pedido-novo");
        await dormir(500);
        await palco.destacar(cartao(p, 8), { folga: 6 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O cartão do pedido",
      fala: "Cada cartão é um pedido. Ele mostra o número e o nome do cliente, de onde o pedido veio, a hora em que chegou e o prazo de entrega, o endereço, o valor e a forma de pagamento.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 8);
        await palco.camera(c, { zoomMax: 1.75, margem: 44 });
        await ctx.ate(0.16);
        await palco.mover(c.getByText("#8 — Mariana Costa"), { ms: 600 });
        await ctx.ate(0.36);
        await palco.mover(c.getByText("Online", { exact: true }), { ms: 500 });
        await ctx.ate(0.5);
        await palco.mover(c.getByText(/^Chegou/), { ms: 500 });
        await ctx.ate(0.62);
        await palco.mover(c.getByText(/^Entregar até/), { ms: 450 });
        await ctx.ate(0.76);
        await palco.mover(c.getByText(/Rua das Flores/), { ms: 550 });
        await ctx.ate(0.88);
        await palco.mover(c.getByText("R$ 72,00"), { ms: 500 });
      },
    },
    {
      fala: "Clique no cartão para abrir os itens do pedido e a observação que o cliente escreveu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 8);
        await palco.clicar(c.getByText("#8 — Mariana Costa"));
        const obs = c.getByText(/Sem cebola/).first();
        await obs.waitFor({ state: "visible", timeout: 8000 });
        const aberto = obs.locator("xpath=.."); // a parte que abriu: observação + itens
        await palco.rolarAte(aberto, { bloco: "end" });
        await palco.camera(aberto, { zoomMax: 1.75, margem: 60, ms: 600 });
        await palco.mover(obs, { ms: 700 });
        await ctx.ate(0.75);
        await palco.mover(c.getByText(/1× Pizza Calabresa/), { ms: 600 });
        await ctx.ate(1);
        await dormir(900);
        // fecha o cartão e devolve a coluna ao topo, para o botão Aceitar voltar a aparecer
        await c.getByText("#8 — Mariana Costa").evaluate((el) => el.click());
        await dormir(300);
        await palco.rolarAte(c, { bloco: "start" });
        await palco.camera(c, { zoomMax: 1.75, margem: 44, ms: 600 });
      },
    },
    {
      capitulo: "Aceitar o pedido",
      fala: "Para aceitar, clique em Aceitar. O pedido passa para Em Produção e, se a impressão automática estiver ligada, a comanda sai na impressora.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.12);
        await palco.clicar(cartao(p, 8).getByRole("button", { name: "Aceitar", exact: true }));
        await palco.cameraAberta();
        await palco.destacar(topoDaColuna(p, "col-preparo"), { folga: 8 });
        await palco.mover(contador(p, "col-preparo"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Se preferir não clicar pedido por pedido, ligue o Aceitar automático: todo pedido novo já entra direto em produção.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /Aceitar aut/ });
        await palco.camera([cabecalho(p, "col-novos"), botao], { zoomMax: 1.8, margem: 90 });
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
    },
    {
      capitulo: "Motoboy e saída para entrega",
      fala: "Em pedido de entrega, escolha aqui o motoboy que vai levar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 6);
        const lista = c.locator(".pedido-acoes-motoboy select");
        await palco.rolarAte(lista, { bloco: "end" });
        await palco.camera(c, { zoomMax: 1.6, margem: 40 });
        await palco.destacar(lista, { folga: 6 });
        await palco.apontar(lista);
        await lista.selectOption({ label: "Rafael" });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Quando a cozinha terminar, clique em Marcar como Pronto Cozinha: o cartão ganha o selo de pronto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 6);
        const pronto = c.getByRole("button", { name: "Marcar como Pronto Cozinha" });
        await palco.rolarAte(pronto, { bloco: "center" });
        await palco.camera(c, { zoomMax: 1.6, margem: 40, ms: 500 });
        await palco.destacar(pronto, { folga: 6 });
        await ctx.ate(0.35);
        await palco.apagarDestaque();
        await palco.clicar(pronto);
        await c.getByText(/✓ Pronto Cozinha/).waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(c.getByText(/✓ Pronto Cozinha/), { folga: 6 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
        await palco.rolarAte(c.getByRole("button", { name: "Saiu", exact: true }), { bloco: "center" });
      },
    },
    {
      fala: "Quando o motoboy sair com o pedido, clique em Saiu. O cartão passa para a coluna Saiu para Entrega.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.3);
        await palco.clicar(cartao(p, 6).getByRole("button", { name: "Saiu", exact: true }));
        await palco.cameraAberta();
        await palco.destacar(topoDaColuna(p, "col-transporte"), { folga: 8 });
        await palco.mover(contador(p, "col-transporte"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em pedido de retirada ou de balcão não tem motoboy: o botão é Pronto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 7);
        const pronto = c.getByRole("button", { name: "Pronto", exact: true });
        await palco.rolarAte(pronto, { bloco: "center" });
        await palco.camera(c, { zoomMax: 1.6, margem: 40 });
        await palco.destacar(pronto, { folga: 6 });
        await palco.mover(pronto, { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
    },
    {
      capitulo: "Concluir a entrega",
      fala: "Quando a entrega for feita, clique em Entregue. O pedido vai para a coluna Finalizado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 5);
        const entregue = c.getByRole("button", { name: "Entregue", exact: true });
        await palco.rolarAte(entregue, { bloco: "center" });
        await ctx.ate(0.3);
        await palco.clicar(entregue);
        await coluna(p, "col-finalizado").getByText("#5 — Lucas Ferreira").waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(cartaoEm(p, "col-finalizado", 5), { folga: 6 });
        await palco.mover(cabecalho(p, "col-finalizado"), { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Os botões menores do cartão",
      fala: "Os botões menores servem para chamar o cliente no WhatsApp, imprimir a comanda de novo, ver o pedido completo e editar os itens.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartaoEm(p, "col-finalizado", 5);
        const icones = c.locator(".pedido-acoes-icones");
        await palco.rolarAte(icones, { bloco: "center" });
        await palco.camera(c, { zoomMax: 1.7, margem: 40 });
        await palco.destacar(icones, { folga: 6 });
        await ctx.ate(0.3);
        await palco.mover(c.getByTitle("WhatsApp do Cliente"), { ms: 450 });
        await ctx.ate(0.52);
        await palco.mover(c.getByTitle("Imprimir"), { ms: 400 });
        await ctx.ate(0.7);
        await palco.mover(c.getByTitle("Ver pedido"), { ms: 400 });
        await ctx.ate(0.86);
        await palco.mover(c.getByTitle(/^Editar itens/), { ms: 400 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em Ver pedido você confere a comanda do jeito que ela sai na impressora, e pode trocar a forma de pagamento.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartaoEm(p, "col-finalizado", 5);
        await palco.cameraAberta({ ms: 500 });
        await palco.clicar(c.getByTitle("Ver pedido"));
        await p.getByText("Bobina:").waitFor({ state: "visible", timeout: 8000 });
        const trocar = p.getByRole("button", { name: "Trocar" });
        const comanda = p.getByText("RESUMO DO PEDIDO");
        await palco.camera([p.getByRole("button", { name: /Comanda/ }), comanda], { zoomMax: 1.5, margem: 40 });
        await ctx.ate(0.4);
        await palco.mover(comanda, { ms: 800 });
        await ctx.ate(0.7);
        await palco.destacar(trocar.locator("xpath=.."), { folga: 4 });
        await palco.mover(trocar, { ms: 700 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
        const fechar = p.getByRole("button", { name: "Fechar" }).last();
        await palco.rolarAte(fechar, { bloco: "end" });
        await palco.clicar(fechar);
      },
    },
    {
      capitulo: "Cancelar um pedido",
      fala: "Para cancelar, segure o cartão e arraste até a coluna Cancelado. Escolha o motivo e confirme.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 7);
        await palco.rolarAte(c.getByText("#7 — Fernanda Lima"), { bloco: "center" });
        await ctx.ate(0.15);
        await palco.arrastar(c.getByText("#7 — Fernanda Lima"), coluna(p, "col-cancelados"));
        // Desde 09/10/2026 cancelar pede o motivo (vai para o fechamento do caixa).
        const motivo = p.getByRole("button", { name: "Cliente desistiu" });
        await motivo.waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.55);
        await palco.clicar(motivo);
        await ctx.ate(0.72);
        await palco.clicar(p.getByRole("button", { name: "Sim, cancelar" }));
        await coluna(p, "col-cancelados").getByText("#7 — Fernanda Lima").waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(cartaoEm(p, "col-cancelados", 7), { folga: 6 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Busca, filtros e resumo",
      fala: "No topo, a busca encontra um pedido pelo nome, pelo telefone ou pelo número.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const busca = p.getByPlaceholder("Nome, número, telefone, endereço...");
        await palco.digitar(busca, "Paula");
        await ctx.ate(1);
        await dormir(900);
        await busca.fill("");
        await dormir(400);
      },
    },
    {
      fala: "Os filtros escondem um tipo de pedido ou um aplicativo: clicou, ele some do quadro. Clicou de novo, ele volta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const delivery = p.locator('button[title^="Delivery:"]');
        const grupo = [delivery, p.locator('button[title^="Mesa:"]'), p.locator('button[title^="iFood:"]'), p.locator('button[title^="Loja"]')];
        await palco.destacar(grupo, { folga: 8 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(delivery);
        await ctx.ate(0.75);
        await palco.clicar(delivery);
        await ctx.ate(1);
      },
    },
    {
      fala: "E o Resumo das vendas mostra quanto a loja vendeu até agora, etapa por etapa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // A noite enche agora: os pedidos chegam na próxima consulta da tela,
        // a tempo do capítulo do Painel clean.
        await encherOQuadro(ctx.prisma);
        await palco.clicar(p.getByRole("button", { name: "Resumo das vendas" }));
        const total = p.getByText("TOTAL ATE O MOMENTO");
        await total.waitFor({ state: "visible", timeout: 8000 });
        const fechar = p.getByRole("button", { name: "Fechar" }).last();
        await palco.camera([p.getByText("PAGAMENTOS PENDENTES"), fechar], { zoomMax: 1.5, margem: 70 });
        await palco.mover(total, { ms: 800 });
        await ctx.ate(1);
        await dormir(900);
        await palco.clicar(fechar);
        await palco.cameraAberta();
      },
    },
    {
      capitulo: "Painel clean",
      fala: "Em noite de movimento, ligue o Painel clean, aqui na barra: cada pedido vira um cartão pequeno, com o cliente, o valor e o tempo, e cabem muito mais pedidos na tela.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const interruptor = p.getByRole("switch", { name: /Painel clean/ });
        await coluna(p, "col-preparo").getByText("Leonardo Prado").first().waitFor({ state: "visible", timeout: 20_000 });
        await palco.destacar(interruptor, { folga: 6 });
        await palco.mover(interruptor, { ms: 700 });
        await ctx.ate(0.2);
        await palco.apagarDestaque();
        await palco.clicar(interruptor);
        await p.locator('button[role="switch"][aria-checked="true"]').waitFor({ timeout: 8000 });
        const pequeno = coluna(p, "col-preparo").locator("[draggable]").first();
        await ctx.ate(0.4);
        await palco.camera(pequeno, { zoomMax: 1.9, margem: 30 });
        await palco.mover(pequeno, { ms: 600 });
        await ctx.ate(0.72);
        await palco.cameraAberta();
        await palco.destacar(coluna(p, "col-preparo"), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Clique num pedido e ele abre completo, com todos os botões. Para voltar aos cartões grandes, desligue no mesmo botão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = coluna(p, "col-preparo").locator("[draggable]").filter({ hasText: "Leonardo Prado" }).first();
        await palco.rolarAte(c, { bloco: "center" });
        await ctx.ate(0.08);
        await palco.clicar(c);
        await c.getByRole("button", { name: "Marcar como Pronto Cozinha" }).waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(c, { zoomMax: 1.5, margem: 40 });
        await ctx.ate(0.45);
        await palco.cameraAberta();
        await palco.clicar(c.getByText("Leonardo Prado").first());
        await palco.rolarPagina(0);
        const interruptor = p.getByRole("switch", { name: /Painel clean/ });
        await ctx.ate(0.75);
        await palco.clicar(interruptor);
        await p.locator('button[role="switch"][aria-checked="false"]').waitFor({ timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso você já toca o dia a dia da loja por aqui. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
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
