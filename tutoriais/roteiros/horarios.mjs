// Tutorial de Minha loja › Horários (/store/minha-loja#horarios).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que foi conferido no código antes de escrever:
// - o horário salvo decide "aberta/fechada" no cardápio e no robô
//   (lib/loja-aberta.ts, estadoDaLoja; api/customer-order recusa fora dele);
// - turnos do mesmo dia que se cruzam não são salvos (validateShifts, no
//   StoreSettingsForm: o aviso aparece na tela, não em alert);
// - "Site aberto" desligado: o cardápio continua à vista, com o aviso de loja
//   fechada e o botão de finalizar travado (CustomerStorePage, lojaFechadaAgora);
// - a abertura automática age na virada do turno e grava no clique
//   (lib/abertura-da-loja.ts; alternarAbertura);
// - a pausa agendada fecha a loja no período (isStoreOpen/estadoDaLoja).
//
// Fora da fala, de propósito: o "por quanto tempo" da janela de pausa do topo.
// O servidor só grava "site fechado" (api/store/status ignora o prazo), então
// dizer que a loja reabre sozinha depois de uma hora seria afirmar o que o
// código não cumpre.
import { dormir } from "../motor/palco.mjs";

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

const menuMinhaLoja = (p) => p.locator('nav.fh-menu-lista a.fh-menu-item[href="/store/minha-loja"]');
const menuHorarios = (p) => p.locator('nav.fh-menu-lista a.fh-menu-filho[href="/store/minha-loja#horarios"]');
/** O cartão de um dia da semana (a caixa inteira, com os turnos). */
const dia = (p, nome) => p.locator("label").filter({ hasText: new RegExp(`^${nome}$`) }).locator("xpath=../..");
const horas = (p, nome) => dia(p, nome).locator('input[type="time"]');
const salvarHorarios = (p) => p.getByRole("button", { name: "Salvar Horários" });
const opcaoIfood = (p) => p.getByText("Refletir horários do site no iFood").locator("xpath=ancestor::label");
const abrirSozinha = (p) => p.getByText("Abrir e fechar a loja sozinha no horário").locator("xpath=ancestor::label");
const pausa = (p) => p.getByRole("heading", { name: /Agendar Pausa/ }).locator("xpath=ancestor::div[contains(@class,'card')][1]");
const chaveDoSite = (p) => p.getByRole("button", { name: /^Site (aberto|fechado)$/ });

/** Rola a PÁGINA até o alvo ficar a `topo` pixels do alto da tela (o rolarAte do palco só rola caixas internas). */
async function rolarPaginaPara(palco, alvo, topo = 120) {
  const c = await alvo.boundingBox();
  const y = await palco.pagina.evaluate(() => window.scrollY);
  await palco.rolarPagina(Math.max(0, Math.round(y + c.y - topo)));
}

/**
 * Campo de hora: clica na parte das HORAS (a esquerda do campo) e digita os
 * quatro números, como a pessoa faz. Clicar no meio cairia nos minutos.
 */
async function digitarHora(palco, campo, hhmm) {
  const c = await campo.boundingBox();
  await palco.clicar({ x: c.x + 16, y: c.y + c.height / 2 });
  await palco.pagina.keyboard.type(hhmm.replace(":", ""), { delay: 110 });
  await dormir(250);
}

/** A janela que abre por cima da tela (a caixa branca, sem o fundo escuro), para a câmera. */
async function janela(p, titulo) {
  const cabeca = p.getByRole("heading", { name: titulo });
  await cabeca.waitFor({ state: "visible", timeout: 8000 });
  await dormir(250);
  return cabeca.evaluate((el) => {
    let no = el;
    while (no.parentElement && getComputedStyle(no.parentElement).position !== "fixed") no = no.parentElement;
    const r = no.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

const dataDaqui = (dias) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

export default {
  id: "horarios",
  titulo: "Horários da loja e abertura automática",
  rota: "store/minha-loja#horarios",
  prontaQuando: "text=Horário de Funcionamento",
  pronuncia: { "+ Turno": "mais Turno" },

  /** Uma loja de jantar: todo dia das 18h às 23h. É o ponto de partida mais comum. */
  async preparar(prisma, { loja }) {
    await prisma.user.update({
      where: { id: loja.id },
      data: {
        storeHours: DIAS.map((day) => ({ day, open: "18:00", close: "23:00", active: true, shifts: [{ open: "18:00", close: "23:00" }] })),
      },
    });
  },

  /**
   * Duas coisas, fora da câmera:
   * - o botão flutuante de ajuda pulsa sem parar e cada pulso é um quadro novo
   *   na captura; só o pulso para, o botão continua na tela;
   * - "Refletir horários do site no iFood" vem marcada, e a loja fictícia não
   *   tem iFood: salvar com ela marcada mostra um aviso vermelho de "iFood não
   *   sincronizou". Ela é desmarcada aqui e a cena do iFood a marca de novo,
   *   na frente da câmera.
   */
  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.addStyleTag({ content: "#contact-widget-fab{animation:none !important}" });
    const caixa = opcaoIfood(p).locator("input");
    if (await caixa.isChecked()) await caixa.click();
    await p.evaluate(() => window.scrollTo({ top: 0 }));
    await dormir(400);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Em Minha loja, Horários, você diz os dias e as horas em que a loja funciona. É por este horário que o cardápio do site e o robô do WhatsApp sabem se a loja está aberta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(500);
        await palco.rolarAte(menuHorarios(p), { bloco: "center" });
        await palco.destacar([menuMinhaLoja(p), menuHorarios(p)], { folga: 6 });
        await palco.mover(menuHorarios(p), { ms: 900 });
        await ctx.ate(0.42);
        await palco.apagarDestaque();
        await palco.mover(p.getByRole("heading", { name: /Horário de Funcionamento/ }), { ms: 900 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "Dias e horários",
      fala: "Cada dia da semana tem a sua linha. Desmarque o dia em que a loja não abre, e ele fica como Fechado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.camera([dia(p, "Segunda"), dia(p, "Quarta")], { zoomMax: 1.5, margem: 40 });
        await palco.mover(dia(p, "Terça").locator("label"), { ms: 700 });
        await ctx.ate(0.36);
        await palco.clicar(dia(p, "Segunda").locator('input[type="checkbox"]'));
        await dia(p, "Segunda").getByText("Fechado").waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(dia(p, "Segunda"), { folga: 5 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Nos outros dias, acerte a hora de abrir e a hora de fechar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar([horas(p, "Terça").nth(0), horas(p, "Terça").nth(1)], { folga: 6 });
        await ctx.ate(0.25);
        await palco.apagarDestaque();
        await digitarHora(palco, horas(p, "Terça").nth(0), "17:30");
        await ctx.ate(0.75);
        await palco.mover(horas(p, "Terça").nth(1), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      capitulo: "Mais de um turno",
      fala: "Abre no almoço e no jantar? Clique em + Turno, e o dia ganha um segundo horário. Só não deixe um turno cruzar com o outro: a tela recusa na hora de salvar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 500 });
        await rolarPaginaPara(palco, dia(p, "Sábado"), 250);
        await palco.camera(dia(p, "Sábado"), { zoomMax: 1.5, margem: 70, ms: 600 });
        await ctx.ate(0.22);
        await palco.clicar(dia(p, "Sábado").getByRole("button", { name: "+ Turno" }));
        await dia(p, "Sábado").getByText("Turno 2").waitFor({ state: "visible", timeout: 8000 });
        await digitarHora(palco, horas(p, "Sábado").nth(0), "11:00");
        await digitarHora(palco, horas(p, "Sábado").nth(1), "15:00");
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      capitulo: "Salvar",
      fala: "Mexeu no horário, o botão Salvar Horários fica vermelho. Clique nele. Sem salvar, nada muda para o cliente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 500 });
        await rolarPaginaPara(palco, salvarHorarios(p), 330);
        await palco.camera([dia(p, "Domingo"), opcaoIfood(p)], { zoomMax: 1.5, margem: 40, ms: 600 });
        await palco.destacar(salvarHorarios(p), { folga: 6 });
        await palco.mover(salvarHorarios(p), { ms: 600 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.clicar(salvarHorarios(p));
        // gravou: o botão volta a ficar cinza (desabilitado)
        await p.waitForFunction(() => {
          const b = [...document.querySelectorAll("button")].find((x) => /Salvar Horários/.test(x.textContent || ""));
          return b && b.disabled && !/Salvando/.test(b.textContent || "");
        }, null, { timeout: 15_000 });
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      capitulo: "Horário no iFood",
      fala: "Tem o iFood conectado? Marque esta opção antes de salvar, e o mesmo horário vai para o iFood.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(opcaoIfood(p), { folga: 6 });
        await palco.mover(opcaoIfood(p).locator("input"), { ms: 600 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(opcaoIfood(p).locator("input"));
        await palco.destacar(opcaoIfood(p), { folga: 6 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Pausa e férias",
      fala: "Vai fechar por uns dias? Em Agendar Pausa, ligue a chave, escolha a data de início e a de retorno, e clique em Salvar Pausa. Nesse período a loja fica fechada, mesmo dentro do horário.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cartao = pausa(p);
        await palco.cameraAberta({ ms: 500 });
        const datas = cartao.locator('input[type="date"]');
        const salvar = cartao.getByRole("button", { name: "Salvar Pausa" });
        await rolarPaginaPara(palco, cartao, 120);
        await palco.camera(cartao, { zoomMax: 1.4, margem: 44, ms: 600 });
        await ctx.ate(0.2);
        await palco.clicar(cartao.locator("button").first());
        await dormir(250);
        // ligada, a caixa cresce (aparece o resumo da pausa): a página sobe para o Salvar caber
        await rolarPaginaPara(palco, cartao, 200);
        await palco.camera(cartao, { zoomMax: 1.4, margem: 44, ms: 400 });
        for (const [i, quando] of [dataDaqui(14), dataDaqui(21)].entries()) {
          const c = await datas.nth(i).boundingBox();
          await palco.clicar({ x: c.x + 30, y: c.y + c.height / 2 }, { ms: 450 });
          await datas.nth(i).fill(quando);
          await dormir(250);
        }
        await ctx.ate(0.62);
        await palco.clicar(salvar);
        const selo = cartao.getByText("ATIVO", { exact: true });
        await selo.waitFor({ state: "visible", timeout: 15_000 });
        await palco.destacar(selo, { folga: 6 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Abrir e fechar o site",
      fala: "No topo fica a chave Site aberto. Clicando nela, o painel pergunta o que pausar e o motivo. Confirmou a pausa, o site fecha na hora.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 500 });
        await palco.rolarPagina(0);
        await palco.destacar(chaveDoSite(p), { folga: 6 });
        await palco.mover(chaveDoSite(p), { ms: 700 });
        await ctx.ate(0.22);
        await palco.apagarDestaque();
        await palco.clicar(chaveDoSite(p));
        await palco.camera(await janela(p, "Agendar uma nova pausa"), { zoomMax: 1.3, margem: 30, ms: 600 });
        await palco.clicar(p.getByRole("button", { name: "Pausar só o site" }));
        await ctx.ate(0.56);
        await palco.mover(p.getByRole("button", { name: "Intervalo", exact: true }), { ms: 600 });
        await ctx.ate(0.7);
        await palco.clicar(p.getByRole("button", { name: /Confirmar pausa/ }));
        await p.getByRole("button", { name: "Site fechado" }).waitFor({ state: "visible", timeout: 15_000 });
        await palco.cameraAberta({ ms: 500 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Com o site fechado, o cliente vê o aviso de loja fechada e não consegue fazer o pedido. Para reabrir, clique na chave de novo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const faixa = p.getByText(/LOJA FECHADA/);
        await palco.destacar(faixa, { folga: 0 });
        await palco.mover(faixa, { ms: 700 });
        await ctx.ate(0.62);
        await palco.apagarDestaque();
        await palco.clicar(chaveDoSite(p));
        await p.getByRole("button", { name: "Site aberto" }).waitFor({ state: "visible", timeout: 15_000 });
        await dormir(400);
        await palco.destacar(chaveDoSite(p), { folga: 6 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Abertura automática",
      fala: "Para não depender de ninguém lembrar, marque Abrir e fechar a loja sozinha no horário. O site abre quando cada turno começa e fecha quando termina.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const opcao = abrirSozinha(p);
        await palco.camera(opcao, { zoomMax: 1.5, margem: 50 });
        await palco.destacar(opcao, { folga: 4 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(opcao.locator("input"));
        await opcao.getByText("· ligado").waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Esta opção grava na hora, sem botão de salvar. E se alguém fechar no meio do turno, a loja só reabre no turno seguinte.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const opcao = abrirSozinha(p);
        await palco.destacar(opcao.getByText("· ligado"), { folga: 5 });
        await palco.mover(opcao.getByText("· ligado"), { ms: 600 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.mover(opcao.getByText(/Se alguém fechar no meio do turno/), { ms: 800 });
        await ctx.ate(1);
        await dormir(300);
        await palco.cameraAberta();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso o horário da loja fica em dia. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
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
