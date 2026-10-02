// Tutorial da tela do Chatbot (/store/chatbot).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE.
//
// Esta é uma tela de CONEXÃO com serviço de fora (o WhatsApp da loja), e o
// ambiente de gravação não tem a chave do servidor de WhatsApp nem da IA, de
// propósito. Por isso a loja aparece DESCONECTADA o vídeo inteiro (é o que vê
// quem ainda não conectou) e o roteiro PARA antes de todo clique que chamaria
// o WhatsApp ou a IA: "Gerar QR Code na Hora", "Gerar código", a faixa
// "Clique aqui para reconectar", o chat de teste ao lado e o campo de escrever
// para o cliente são apontados, nunca clicados.
//
// O que é clicado só grava no banco da loja fictícia: o tom de voz, o número a
// mais que recebe os alertas e a pausa do robô numa conversa.
import { randomUUID } from "node:crypto";
import { dormir } from "../motor/palco.mjs";

/** Leva o elemento para uma altura da tela (y do topo dele), rolando a página à vista. */
async function rolarPara(palco, alvo, topo = 40) {
  const y = await alvo.evaluate((el, t) => Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - t)), topo);
  await palco.rolarPagina(y);
}

/**
 * Clica no campo e escreve o texto aos pedaços. Tecla por tecla, com a captura
 * ligada e a máquina ocupada, quinze letras de telefone deixavam três segundos
 * de silêncio no fim da cena.
 */
async function digitar(palco, alvo, texto) {
  await palco.clicar(alvo, { ms: 300 });
  for (let i = 0; i < texto.length; i += 3) {
    await palco.pagina.keyboard.insertText(texto.slice(i, i + 3));
    await dormir(110);
  }
  await dormir(200);
}

/** O quadro "Status do WhatsApp", no alto da tela. */
const quadroDoStatus = (p) => p.getByText("Desconectado / Pendente").locator("xpath=../..");
/** Um bloco de SIM/NÃO das regras do robô, achado pelo começo do título. */
const regra = (p, titulo) => p.getByText(titulo).first().locator("xpath=../../..");
/** A janelinha "WhatsApp da loja" aberta (cabeçalho, abas e conversas). */
const janelaDoWhatsApp = (p) => p.getByRole("button", { name: /Robô atendendo/ }).locator("xpath=../..");

export default {
  id: "chatbot",
  titulo: "Chatbot IA: o robô do WhatsApp",
  rota: "store/chatbot",
  prontaQuando: "text=Chatbot IA & WhatsApp do Restaurante",

  /**
   * O número do dono (o que recebe os alertas) e duas conversas do robô com
   * clientes fictícios, guardadas do jeito que o robô guarda
   * (lib/memoria-da-conversa-no-banco.ts): é o que a janelinha "WhatsApp da
   * loja" mostra na aba "Robô atendendo".
   */
  async preparar(prisma, { loja }) {
    await prisma.user.update({ where: { id: loja.id }, data: { notificationPhone: "(11) 95555-0001" } });
    // A coluna da memória nasce por SQL no primeiro uso do painel; garante-se aqui para o banco recém-criado.
    await prisma.$executeRawUnsafe(`ALTER TABLE "ChatbotConversationState" ADD COLUMN IF NOT EXISTS "history" JSONB`);
    const agora = Date.now();
    const haMin = (m) => agora - m * 60_000;
    const conversa = (jid, mensagens) => prisma.$executeRaw`
      INSERT INTO "ChatbotConversationState" ("id", "userId", "remoteJid", "turnCount", "turnsWithoutProgress", "history", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${loja.id}, ${jid}, 0, 0, ${JSON.stringify(mensagens)}::jsonb, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`;
    await conversa("5511977770021@s.whatsapp.net", [
      { sender: "user", text: "Oi, boa noite! Vocês têm cardápio?", timestamp: haMin(19) },
      { sender: "bot", text: "Boa noite! 😊 Temos sim. Nosso cardápio completo está aqui: https://firehubfood.com.br/loja/sabor-da-praca", timestamp: haMin(18.5), autor: "robo" },
    ]);
    await conversa("5511977770012@s.whatsapp.net", [
      { sender: "user", text: "Boa noite! Quanto está a pizza de calabresa?", timestamp: haMin(4) },
      { sender: "bot", text: "Boa noite! 😊 A Pizza Calabresa grande, de 8 fatias, sai por R$ 54,00. Quer que eu anote o seu pedido?", timestamp: haMin(3.6), autor: "robo" },
      { sender: "user", text: "Quero sim, e um guaraná de 2 litros", timestamp: haMin(1.4) },
      { sender: "bot", text: "Anotado: 1 Pizza Calabresa e 1 Guaraná 2 L. Me passa seu nome, o endereço com bairro e a forma de pagamento?", timestamp: haMin(1), autor: "robo" },
    ]);
  },

  /**
   * O botão redondo do chat de suporte pulsa sem parar e faz a captura pintar
   * quadros à toa: só a pulsação é parada. Nada da tela muda.
   */
  async antesDeGravar(palco) {
    await palco.pagina.addStyleTag({ content: ".fcw-fab-pulse{animation:none !important}" });
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela do Chatbot. É aqui que você conecta o WhatsApp da loja ao robô, que responde os clientes, manda o link do cardápio e anota pedidos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(800);
        await palco.mover(p.locator("h1", { hasText: "Chatbot IA" }), { ms: 900 });
        await ctx.ate(0.5);
        await palco.destacar(quadroDoStatus(p), { folga: 6 });
        await palco.mover(quadroDoStatus(p), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Conectar o WhatsApp",
      fala: "Para conectar, clique em Gerar QR Code na Hora. No celular da loja, abra o WhatsApp, entre em Aparelhos conectados, toque em Conectar um aparelho e aponte a câmera para o código, que vale por um minuto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.locator("h3", { hasText: "Vincular Aparelho por QR Code" });
        // Só apontado: o clique pediria o QR Code ao servidor de WhatsApp.
        const gerar = p.getByRole("button", { name: /Gerar QR Code na Hora/ });
        const passos = p.getByText("Passos no Celular:").locator("xpath=..");
        await rolarPara(palco, titulo, 30);
        await palco.camera([titulo, passos], { zoomMax: 1.5, margem: 34 });
        await palco.destacar(gerar, { folga: 8 });
        await palco.mover(gerar, { ms: 500 });
        await ctx.ate(0.3);
        await palco.destacar(passos, { folga: 4 });
        await palco.mover(p.getByText(/Aparelhos conectados/).first(), { ms: 500 });
        await ctx.ate(0.62);
        await palco.mover(p.getByText(/Conectar um aparelho/).first(), { ms: 400 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Se o celular da loja não estiver por perto, use Conectar digitando um código: clique em Gerar código e digite esse código no WhatsApp do celular.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const caixa = p.getByText(/Conectar digitando um código/).locator("xpath=..");
        const numero = p.getByPlaceholder(/WhatsApp da loja com DDD/);
        // Só apontado: o clique pediria o código ao servidor de WhatsApp.
        const gerarCodigo = p.getByRole("button", { name: "Gerar código" });
        await palco.camera(caixa, { zoomMax: 1.7, margem: 40 });
        await palco.destacar(caixa, { folga: 4 });
        await ctx.ate(0.3);
        await palco.mover(numero, { ms: 500 });
        await ctx.ate(0.58);
        await palco.mover(gerarCodigo, { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "Depois de conectar, o status aqui em cima passa para Conectado e Operacional, e o robô começa a responder.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await palco.camera([p.locator("h1", { hasText: "Chatbot IA" }), quadroDoStatus(p)], { zoomMax: 1.4, margem: 40 });
        await palco.destacar(quadroDoStatus(p), { folga: 6 });
        await palco.mover(p.getByText("Desconectado / Pendente"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Nome e tom de voz",
      fala: "Mais abaixo ficam as regras do robô. Aqui você dá um nome ao atendente e escolhe o tom de voz. Cada escolha é salva na hora.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.locator("h3", { hasText: "Estilo & Regras" });
        const nome = p.getByPlaceholder(/Sophia, Lucas/);
        const agil = p.getByText("Ágil & Direto").locator("xpath=..");
        const divertido = p.getByText("Divertido & Descontraído").locator("xpath=..");
        await rolarPara(palco, titulo, 60);
        await palco.camera([titulo, divertido], { zoomMax: 1.5, margem: 40 });
        await ctx.ate(0.35);
        await palco.mover(nome, { ms: 500 });
        await ctx.ate(0.6);
        await palco.clicar(agil, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Confirmação do pedido",
      fala: "Em Enviar Confirmação de Pedidos, deixe o SIM marcado: a cada pedido feito, o cliente recebe no WhatsApp uma mensagem com o resumo e os itens.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bloco = regra(p, /Enviar Confirmação de Pedidos Automática/);
        await rolarPara(palco, bloco, 250);
        await palco.camera(bloco, { zoomMax: 1.55, margem: 40 });
        await palco.destacar(bloco, { folga: 4 });
        await ctx.ate(0.3);
        await palco.mover(bloco.getByRole("button", { name: "SIM", exact: true }), { ms: 500 });
        await ctx.ate(0.65);
        await palco.mover(bloco.getByText(/Sempre que o cliente realizar um pedido/), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Anotar pedido pelo WhatsApp",
      fala: "Em Permitir que a IA anote e crie pedidos, o SIM já vem marcado: o robô anota os produtos, o endereço e a forma de pagamento, e o pedido aparece na sua tela. Para ele não anotar, marque NÃO.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bloco = regra(p, /Permitir que a IA anote e crie pedidos/);
        await rolarPara(palco, bloco, 110);
        await palco.camera(bloco, { zoomMax: 1.55, margem: 40 });
        await palco.destacar(bloco, { folga: 4 });
        await ctx.ate(0.22);
        await palco.mover(bloco.getByRole("button", { name: "SIM", exact: true }), { ms: 500 });
        await ctx.ate(0.5);
        await palco.mover(bloco.getByText(/Quando ativo, a IA apresenta/), { ms: 600 });
        await ctx.ate(0.86);
        // Só apontado: o robô anota pedido por padrão, e o vídeo deixa assim.
        await palco.mover(bloco.getByRole("button", { name: "NÃO", exact: true }), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Quando o cliente pede atendente",
      fala: "Em Pausar Atendimento do Robô, com o SIM marcado, quando o cliente pede um atendente o robô avisa que chamou a equipe e para de responder aquela conversa.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bloco = regra(p, /Pausar Atendimento do Robô/);
        await palco.camera(bloco, { zoomMax: 1.55, margem: 40 });
        await palco.destacar(bloco, { folga: 4 });
        await ctx.ate(0.2);
        await palco.mover(bloco.getByRole("button", { name: "SIM", exact: true }), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Notificações e alertas",
      fala: "Na aba Notificações, você escolhe os alertas que chegam no seu WhatsApp, como cliente com problema no pedido ou robô desconectado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        await palco.clicar(p.getByRole("button", { name: /Notificações/ }), { ms: 500 });
        const titulo = p.locator("h3", { hasText: "Alertas no seu WhatsApp" });
        await titulo.waitFor({ state: "visible", timeout: 8000 });
        await rolarPara(palco, titulo, 40);
        const alerta = (texto) => p.locator("label", { hasText: texto }).first();
        await palco.camera([titulo, alerta("Robô desconectou do WhatsApp")], { zoomMax: 1.3, margem: 24 });
        await ctx.ate(0.5);
        await palco.destacar([alerta("Cliente com problema no pedido"), alerta("Robô desconectou do WhatsApp")], { folga: 6 });
        await palco.mover(alerta("Cliente com problema no pedido").locator("input"), { ms: 500 });
        await ctx.ate(0.85);
        await palco.mover(alerta("Robô desconectou do WhatsApp").locator("input"), { ms: 450 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Os alertas vão para o número do dono, cadastrado em Minha Loja. Aqui você inclui até quatro números a mais, de sócio ou de gerente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const principal = p.getByText(/Os alertas vão para/).first();
        const outros = p.getByText("Outras pessoas que recebem os alertas").locator("xpath=..");
        const campo = p.getByPlaceholder("(22) 99999-8888");
        await palco.camera([p.locator("h3", { hasText: "Alertas no seu WhatsApp" }), outros], { zoomMax: 1.3, margem: 24, ms: 400 });
        await palco.destacar(principal, { folga: 4 });
        await palco.mover(principal, { ms: 350 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        // Grava só no banco da loja fictícia: nenhum aviso é enviado.
        await digitar(palco, campo, "(11) 95555-0002");
        await palco.clicar(p.getByRole("button", { name: "+ Adicionar" }), { ms: 300 });
        const novo = p.getByText("(11) 95555-0002").first();
        await novo.waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(novo, { folga: 8 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      fala: "E em Números que o robô não responde, cadastre motoboys e fornecedores: para eles o robô fica calado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.locator("h3", { hasText: "Números que o robô não responde" });
        const cartao = titulo.locator("xpath=../../..");
        await rolarPara(palco, cartao, 230);
        await palco.camera(cartao, { zoomMax: 1.3, margem: 30 });
        await palco.destacar(cartao, { folga: 4 });
        await palco.mover(p.getByPlaceholder(/Motoboy João/), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Assumir uma conversa",
      fala: "Para assumir uma conversa no lugar do robô, clique em WhatsApp da loja, aqui no canto, e abra a aba Robô atendendo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const rotulo = p.getByText("WhatsApp da loja", { exact: true }).first();
        await palco.destacar(rotulo, { folga: 6 });
        await palco.mover(rotulo, { ms: 600 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.clicar(rotulo, { ms: 200 });
        const aba = p.getByRole("button", { name: /Robô atendendo/ });
        await aba.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(janelaDoWhatsApp(p), { zoomMax: 1.4, margem: 24 });
        await ctx.ate(0.75);
        await palco.clicar(aba, { ms: 450 });
        await p.getByText("(11) 97777-0012").first().waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Abra a conversa e clique em Pausar robô. Quem responde aquele cliente passa a ser você. Para devolver a conversa, clique em Voltar o robô.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByText("(11) 97777-0012").first(), { ms: 450 });
        const pausar = p.getByRole("button", { name: /Pausar robô/ });
        await pausar.waitFor({ state: "visible", timeout: 10_000 });
        await p.getByText(/Anotado: 1 Pizza Calabresa/).first().waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.22);
        // A pausa grava só no banco da loja fictícia: nada é enviado ao cliente.
        await palco.clicar(pausar, { ms: 450 });
        const aviso = p.getByText(/O robô não está respondendo este cliente/);
        await aviso.waitFor({ state: "visible", timeout: 10_000 });
        await palco.destacar(aviso, { folga: 2 });
        await ctx.ate(0.7);
        const voltar = p.getByRole("button", { name: /Voltar o robô/ });
        await palco.destacar(voltar, { folga: 5 });
        await palco.mover(voltar, { ms: 400 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso o robô atende os clientes, e você entra na conversa quando precisar. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(janelaDoWhatsApp(p).locator("button").first(), { ms: 400 });
        await palco.cameraAberta({ ms: 450 });
        await palco.rolarPagina(0);
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        await ctx.ate(0.55);
        if (await botao.count()) {
          await palco.destacar(botao, { folga: 6 });
          await palco.mover(botao, { ms: 800 });
        }
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
      pausa: 600,
    },
  ],
};
