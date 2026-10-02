// Tutorial do APLICATIVO DO ENTREGADOR (/loja/<slug>/motoboy), gravado em tela
// de celular: é para o motoboy assistir no próprio aparelho.
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. O que o app desta build faz (mapeado em 02/10/2026):
//  · entra com telefone (ou nome) e senha cadastrados pela loja — não há cadastro no app;
//  · a lista mostra os pedidos que a loja passou para o motoboy, na ordem da rota;
//  · o cartão traz nº, cliente, endereço, quanto receber e o troco; não há botão de ligar;
//  · "Confirmar Entrega Realizada" lembra as bebidas e pede o pagamento (forma + troco);
//  · "Digitar nº" puxa um pedido pela comanda; o pedido entra na lista;
//  · "Meu relatório" mostra entregas, quanto receber e o dinheiro a entregar na loja;
//  · GPS negado não bloqueia nada: só avisa, e a loja deixa de ver o motoboy no mapa.
import { dormir } from "../motor/palco.mjs";

const SENHA = "carlos2026";

/**
 * O Carlos com duas entregas na rua (a #14 em dinheiro com troco e bebida, para
 * o cartão mostrar tudo; a #5 da loja-base, no crédito) e uma entrega pronta
 * na loja sem motoboy (#15), para puxar pela comanda.
 */
async function preparar(prisma, { loja, produtos, motoboys, haMin }) {
  const { carlos } = motoboys;
  // Senha em texto: o login regrava como hash na primeira entrada (lib/motoboy-senha.ts).
  await prisma.motoboy.update({ where: { id: carlos.id }, data: { password: SENHA } });
  const pedido = (n, dados, linhas) => prisma.customerOrder.create({
    data: {
      franchiseeId: loja.id, source: "ONLINE", dailyOrderNumber: n, deliveryType: "DELIVERY", deliveryFee: 6, motoboyFee: 6,
      totalAmount: linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, 6),
      items: { create: linhas.map(([nome, q]) => ({ menuProductId: produtos[nome].id, productName: nome, quantity: q, price: produtos[nome].price })) },
      ...dados,
    },
  });
  await pedido(14, {
    status: "SAIU_ENTREGA", motoboyId: carlos.id, paymentMethod: "DINHEIRO", changeAmount: 100,
    customerName: "Fernanda Lima", customerPhone: "11977770014", customerAddress: "Rua das Palmeiras, 77 - Jardim América",
    notes: "Portão azul, ao lado da padaria",
    createdAt: haMin(45), acceptedAt: haMin(44), readyAt: haMin(20), dispatchedAt: haMin(12),
  }, [["X-Bacon", 2], ["Guaraná 2 L", 1]]);
  // A ordem da parada mora numa coluna fora do schema (api/admin/coluna-sequencia-rota). Sem ela, a
  // consulta do app dá erro, e no banco de gravação (PGlite) o erro derruba a conexão: a consulta
  // seguinte (confirmar a entrega, puxar o pedido) falhava com P1017.
  await prisma.$executeRawUnsafe(`ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "routeSequence" INTEGER`);
  await prisma.$executeRawUnsafe(`UPDATE "CustomerOrder" SET "routeSequence" = CASE "dailyOrderNumber" WHEN 14 THEN 1 WHEN 5 THEN 2 END WHERE "franchiseeId" = '${loja.id}' AND "dailyOrderNumber" IN (14, 5)`);
  await pedido(15, {
    status: "PRONTO", paymentMethod: "CREDITO",
    customerName: "Bruno Alves", customerPhone: "11977770015", customerAddress: "Rua do Comércio, 210 - Centro",
    createdAt: haMin(22), acceptedAt: haMin(21), readyAt: haMin(3),
  }, [["Pizza Calabresa", 1]]);
}

const botao = (p, nome) => p.getByRole("button", { name: nome }).first();
/** O cartão de uma entrega na lista, pelo número do pedido. */
const cartao = (p, n) => p.locator("div").filter({ has: p.getByRole("button", { name: /Confirmar Entrega Realizada/ }) }).filter({ hasText: `Pedido #${n}` }).last();

export default {
  id: "app-motoboy",
  titulo: "O aplicativo do entregador",
  tela: { width: 390, height: 844, celular: true },
  rota: "loja/sabor-da-praca/motoboy",
  prontaQuando: 'button:has-text("Entrar no aplicativo")',
  preparar,

  async antesDeGravar(palco) {
    const p = palco.pagina;
    // GPS ligado e na cidade da loja: o cabeçalho mostra "GPS ativo".
    await p.context().grantPermissions(["geolocation", "notifications"]);
    await p.context().setGeolocation({ latitude: -23.5505, longitude: -46.6333 });
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "Como entrar",
      fala: "Este é o aplicativo do entregador. A loja te manda o link dele. Para entrar, digite o seu telefone e a senha que a loja cadastrou para você.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(600);
        await ctx.ate(0.45);
        await palco.digitar(p.getByPlaceholder("Seu telefone ou nome"), "11988880001");
        await ctx.ate(0.75);
        await palco.digitar(p.getByPlaceholder(/Senha/), SENHA);
        await ctx.ate(1);
      },
    },
    {
      fala: "Toque em Entrar no aplicativo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(botao(p, /Entrar no aplicativo/), { ms: 600 });
        await p.getByText(/Minhas Entregas Pendentes/).waitFor({ state: "visible", timeout: 20_000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "As suas entregas",
      fala: "Aqui aparecem as entregas que a loja passou para você, na ordem da rota. No alto, quantas estão pendentes e quantas você já concluiu hoje.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(500);
        // O título da lista e os selos 1º/2º da rota no primeiro cartão.
        await palco.destacar(p.getByRole("heading", { name: /Minhas Entregas Pendentes/ }), { folga: 6 });
        await ctx.ate(0.5);
        await palco.destacar([p.getByText("PENDENTES", { exact: true }).locator("xpath=.."), p.getByText("CONCLUÍDAS HOJE").locator("xpath=..")], { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O cartão da entrega",
      fala: "Cada cartão mostra o número do pedido, o nome do cliente e o endereço. Logo abaixo, quanto receber e em qual forma. Se o cliente pediu troco, o cartão avisa quanto levar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 14);
        await palco.rolarAte(c.getByText(/Pedido #14/), { bloco: "start" });
        await palco.destacar(c.getByText(/Pedido #14/), { folga: 6 });
        await ctx.ate(0.3);
        await palco.destacar(c.getByText(/Rua das Palmeiras/), { folga: 6 });
        await ctx.ate(0.55);
        await palco.destacar(c.getByText(/Receber/).first(), { folga: 6 });
        await ctx.ate(0.8);
        await palco.destacar(c.getByText(/de troco/).first(), { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Ver o pedido",
      fala: "Em Ver pedido você confere os itens antes de sair, para não esquecer nenhuma bebida.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 14);
        await palco.rolarAte(c.getByRole("button", { name: /Ver pedido/ }));
        await palco.clicar(c.getByRole("button", { name: /Ver pedido/ }), { ms: 600 });
        await dormir(600);
        await palco.destacar(c.getByText(/Guaraná 2 L/).first(), { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.clicar(c.getByRole("button", { name: /Ver pedido|Fechar|Esconder/ }).first(), { ms: 500 }).catch(() => {});
      },
    },
    {
      capitulo: "Ir até o cliente",
      fala: "Os botões Google Maps e Waze abrem o caminho até o endereço. E Falar com Cliente abre o WhatsApp dele, com uma mensagem pronta avisando que você está a caminho.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 14);
        const maps = c.getByRole("link", { name: /Google Maps/ }).or(c.getByRole("button", { name: /Google Maps/ })).first();
        const waze = c.getByRole("link", { name: /Waze/ }).or(c.getByRole("button", { name: /Waze/ })).first();
        const zap = c.getByRole("link", { name: /Falar com Cliente/ }).or(c.getByRole("button", { name: /Falar com Cliente/ })).first();
        await palco.rolarAte(zap);
        await palco.destacar([maps, waze], { folga: 6 });
        await palco.mover(maps, { ms: 600 });
        await ctx.ate(0.25);
        await palco.mover(waze, { ms: 500 });
        await ctx.ate(0.5);
        await palco.destacar(zap, { folga: 6 });
        await palco.mover(zap, { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Confirmar a entrega",
      fala: "Na hora de entregar, toque em Confirmar Entrega Realizada. O aplicativo lembra das bebidas do pedido; confira e toque em Sim, entreguei.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, 14);
        const confirmar = c.getByRole("button", { name: /Confirmar Entrega Realizada/ });
        await palco.rolarAte(confirmar);
        await ctx.ate(0.3);
        await palco.clicar(confirmar, { ms: 600 });
        await p.getByText(/Atenção às Bebidas/).waitFor({ state: "visible" });
        await ctx.ate(0.8);
        await palco.clicar(botao(p, /Sim, entreguei/), { ms: 600 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Depois, receba o pagamento. Se o cliente pagou de outro jeito, escolha aqui a forma certa. Em dinheiro, o aplicativo mostra o troco que você devolve.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.getByText(/Receba antes de finalizar/).waitFor({ state: "visible" });
        await dormir(400);
        await palco.destacar(p.getByText(/O cliente pagou com/).locator("xpath=.."), { folga: 6 });
        await ctx.ate(0.6);
        await palco.destacar(p.getByText(/de troco/).last(), { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Toque em Recebi. A entrega sai da sua lista e entra nas concluídas de hoje.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(botao(p, /^Recebi$/), { ms: 600 });
        await p.getByText(/Entrega confirmada/).waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
        await palco.rolarPagina(0);
        await ctx.ate(0.6);
        await palco.destacar(p.getByText("CONCLUÍDAS HOJE").locator("xpath=.."), { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Pegar um pedido pela comanda",
      fala: "Pedido que a loja ainda não passou para você? Toque em Digitar número, coloque o número grande do topo da comanda e confirme. Ele entra na sua lista.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const digitarNumero = botao(p, /Digitar n/);
        await palco.rolarAte(digitarNumero);
        await palco.clicar(digitarNumero, { ms: 600 });
        await ctx.ate(0.4);
        await palco.digitar(p.getByPlaceholder("Ex: 47"), "15");
        await palco.clicar(botao(p, /^Puxar pedido$/), { ms: 500 });
        await ctx.ate(0.7);
        await palco.clicar(botao(p, /Sim, é minha entrega/), { ms: 500 });
        await p.getByText(/Pedido #15/).first().waitFor({ state: "visible", timeout: 20_000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Meu relatório",
      fala: "Em Meu relatório você vê quantas entregas fez, quanto tem a receber e quanto dinheiro precisa entregar na loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const rel = p.getByText(/Meu relatório/).first();
        await palco.rolarAte(rel);
        await palco.clicar(rel, { ms: 600 });
        await palco.clicar(botao(p, /^Ver relatório$/), { ms: 500 });
        await p.getByText("ENTREGAS", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
        await dormir(500);
        await palco.destacar(p.getByText("ENTREGAS", { exact: true }).locator("xpath=../.."), { folga: 6 });
        await ctx.ate(0.55);
        await palco.destacar(p.getByText(/Dinheiro para entregar na loja/), { folga: 6 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Localização e senha",
      fala: "Deixe a localização do celular ligada, com Permitir sempre: é assim que a loja te vê no mapa. No cadeado, lá em cima, você troca a sua senha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.keyboard.press("Escape");
        const fechar = p.getByRole("button", { name: /Fechar|×|✕/ }).first();
        if (await fechar.isVisible().catch(() => false)) await palco.clicar(fechar, { ms: 400 });
        await palco.rolarPagina(0);
        await palco.destacar(p.getByText("GPS ativo"), { folga: 6 });
        await ctx.ate(0.6);
        await palco.destacar(p.getByTitle("Alterar senha"), { folga: 6 });
        await palco.mover(p.getByTitle("Alterar senha"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Ficou alguma dúvida? Este vídeo fica sempre no botão Tutorial, no alto do aplicativo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const tutorial = p.getByRole("button", { name: /Tutorial/ }).first();
        await palco.destacar(tutorial, { folga: 6 });
        await palco.mover(tutorial, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
  ],
};
