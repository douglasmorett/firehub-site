// Tutorial de Minha loja › Fidelidade & trilha (/store/minha-loja#fidelidade).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que foi conferido no código antes de escrever:
// - Trilha Premiada (lib/trilha-premiada.ts, components/trilha/*): a primeira
//   parada nasce no 3º pedido com frete grátis e cada parada nova vem três
//   pedidos depois; o prêmio é produto do cardápio, frete grátis ou desconto em
//   porcentagem; o prazo conta do primeiro pedido e, vencido, zera a contagem
//   sem tirar o prêmio já ganho (premiosPendentes olha a história inteira);
//   site conta sempre, balcão/mesa/totem/WhatsApp nascem marcados e os
//   aplicativos nascem desmarcados (CANAIS_PADRAO);
// - nada grava sozinho: tudo vai junto no "Salvar Programa de Fidelidade";
// - no cardápio público a faixa "Trilha Premiada" abre o mapa, os prêmios e as
//   regras (TrilhaDoCliente), e o prêmio é aplicado pelo servidor no pedido
//   seguinte feito pelo site (api/customer-order → premioDoCliente).
//
// ── Cashback: o que a fala NÃO diz, de propósito ────────────────────────────
// A aba "Cashback Automático" já abre habilitada (DEFAULT_LOYALTY) e, salva
// assim, faz o cardápio anunciar "Ganhe 5% de volta". Mas nenhuma rota credita
// o saldo: o único código que soma em `cashbackBalance` é POST /api/cashback, e
// ninguém o chama (o checkout não toca em cashback). Por isso a fala só
// descreve os campos da aba, avisa que ela já vem habilitada e mostra como
// desabilitar; não afirma que o cliente acumula ou resgata saldo. Está no
// relatório para o Douglas decidir.
import { dormir } from "../motor/palco.mjs";

const menuMinhaLoja = (p) => p.locator('nav.fh-menu-lista a.fh-menu-item[href="/store/minha-loja"]');
const menuFidelidade = (p) => p.locator('nav.fh-menu-lista a.fh-menu-filho[href="/store/minha-loja#fidelidade"]');
const aba = (p, nome) => p.getByRole("button", { name: nome });
const mapa = (p) => p.locator(".fh-mapa").first();
/** As caixas da trilha, na ordem da tela: paradas, prazo, canais, regras. */
const caixa = (p, i) => p.locator(".fh-caixa").nth(i);
const parada = (p, i) => p.locator(".fh-linha").nth(i);
const folha = (p) => p.locator(".fh-folha");
const tipo = (p, nome) => p.locator(".fh-tipos button", { hasText: nome });
const canal = (p, nome) => p.locator(".fh-canal", { hasText: nome });
const salvar = (p) => p.getByRole("button", { name: /Salvar Programa de Fidelidade|Configurações de Fidelidade Salvas/ });
const PULSO = "#contact-widget-fab{animation:none !important}";

/**
 * Rola a PÁGINA até `y` e espera a rolagem PARAR. Em trecho longo a rolagem suave passa
 * dos 750 ms do palco, e destaque ou câmera medidos no meio do caminho caem fora do lugar.
 */
async function rolarPagina(palco, y) {
  await palco.rolarPagina(y);
  let antes = -1;
  for (let i = 0; i < 20; i++) {
    const agora = await palco.pagina.evaluate(() => window.scrollY);
    if (agora === antes) break;
    antes = agora;
    await dormir(120);
  }
}

/** Rola a PÁGINA até o alvo ficar a `topo` pixels do alto da tela (o rolarAte do palco só rola caixas internas). */
async function rolarPaginaPara(palco, alvo, topo = 120) {
  const c = await alvo.boundingBox();
  const y = await palco.pagina.evaluate(() => window.scrollY);
  await rolarPagina(palco, Math.max(0, Math.round(y + c.y - topo)));
}

export default {
  id: "fidelidade",
  titulo: "Fidelidade: cashback e trilha premiada",
  rota: "store/minha-loja#fidelidade",
  prontaQuando: "text=Nenhuma parada ainda",

  /** O botão flutuante de ajuda pulsa sem parar e cada pulso é um quadro novo na captura: só o pulso para. */
  async antesDeGravar(palco) {
    await palco.pagina.addStyleTag({ content: PULSO });
    await palco.pagina.evaluate(() => window.scrollTo({ top: 0 }));
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Em Minha loja, Fidelidade e trilha, ficam os programas para o cliente voltar a pedir. Cada aba é um programa, e cada um se liga separado. Este vídeo mostra a Trilha Premiada e o Cashback.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(400);
        await palco.rolarAte(menuFidelidade(p), { bloco: "center" });
        await palco.destacar([menuMinhaLoja(p), menuFidelidade(p)], { folga: 6 });
        await palco.mover(menuFidelidade(p), { ms: 800 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        const abas = aba(p, /Trilha Premiada/).locator("xpath=..");
        await palco.destacar(abas, { folga: 2 });
        await palco.mover(aba(p, /Converter iFood/), { ms: 800 });
        await ctx.ate(0.66);
        await ctx.ate(0.74);
        await palco.destacar(aba(p, /Trilha Premiada/), { folga: 3 });
        await palco.mover(aba(p, /Trilha Premiada/), { ms: 500 });
        await ctx.ate(0.9);
        await palco.destacar(aba(p, /Cashback Automático/), { folga: 3 });
        await palco.mover(aba(p, /Cashback Automático/), { ms: 500 });
        await ctx.ate(1);
        await dormir(200);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "A Trilha Premiada",
      fala: "Na Trilha Premiada, cada pedido do cliente é um passo. Você escolhe em quais pedidos ficam os prêmios, e o cliente acompanha pelo mapa no cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPagina(palco, 150);
        const cabeca = p.getByRole("heading", { name: /Trilha Premiada/ }).locator("xpath=..");
        await palco.camera([cabeca, mapa(p)], { zoomMax: 1.35, margem: 30, ms: 600 });
        await palco.mover(cabeca, { ms: 700 });
        await ctx.ate(0.62);
        await palco.destacar(mapa(p), { folga: 4 });
        await palco.mover(mapa(p), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Montar as paradas",
      fala: "Clique em Adicionar parada. A primeira já vem no terceiro pedido, com frete grátis.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPaginaPara(palco, mapa(p), 70);
        const adicionar = p.getByRole("button", { name: "+ Adicionar parada" });
        await palco.camera([mapa(p), caixa(p, 0)], { zoomMax: 1.3, margem: 24, ms: 500 });
        await palco.clicar(adicionar, { ms: 600 });
        await parada(p, 0).waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.45);
        await palco.destacar(parada(p, 0), { folga: 4 });
        await palco.mover(parada(p, 0).locator("input"), { ms: 500 });
        await ctx.ate(0.8);
        await palco.mover(parada(p, 0).getByText("Frete grátis"), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Adicione outra, e ela vem três pedidos depois. Para mudar o pedido que libera o prêmio, é só digitar o número.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "+ Adicionar parada" }), { ms: 500 });
        await parada(p, 1).waitFor({ state: "visible", timeout: 8000 });
        await palco.mover(parada(p, 1).locator("input"), { ms: 500 });
        await ctx.ate(0.5);
        const numero = parada(p, 1).locator("input");
        await palco.clicar(numero, { ms: 200 });
        await p.keyboard.press("Control+A");
        await p.keyboard.type("5", { delay: 120 });
        await dormir(300);
        await palco.destacar(mapa(p), { folga: 4 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Escolher o prêmio",
      fala: "Para trocar o prêmio, clique nele. Pode ser um produto do cardápio, frete grátis ou um desconto em porcentagem.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(parada(p, 1).locator(".fh-escolher"), { ms: 600 });
        await folha(p).waitFor({ state: "visible", timeout: 8000 });
        await dormir(250);
        await palco.camera(folha(p), { zoomMax: 1.5, margem: 30, ms: 600 });
        await ctx.ate(0.42);
        await palco.destacar([tipo(p, "Produto do cardápio"), tipo(p, "Desconto")], { folga: 6 });
        await palco.mover(tipo(p, "Produto do cardápio"), { ms: 450 });
        await ctx.ate(0.65);
        await palco.mover(tipo(p, "Frete grátis"), { ms: 400 });
        await ctx.ate(0.8);
        await palco.mover(tipo(p, "Desconto"), { ms: 400 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em Produto do cardápio, clique no produto que o cliente vai ganhar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(tipo(p, "Produto do cardápio"), { ms: 450 });
        const item = p.locator(".fh-item", { hasText: "Coca-Cola lata" });
        await item.waitFor({ state: "visible", timeout: 8000 });
        await palco.camera(folha(p), { zoomMax: 1.2, margem: 20, ms: 500 });
        await ctx.ate(0.6);
        await palco.clicar(item, { ms: 500 });
        await folha(p).waitFor({ state: "hidden", timeout: 8000 });
        await palco.camera([mapa(p), caixa(p, 0)], { zoomMax: 1.3, margem: 24, ms: 500 });
        await palco.destacar(parada(p, 1), { folga: 4 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Prazo e pedidos que contam",
      fala: "Depois escolha o prazo para percorrer a trilha. Passou o prazo, a contagem volta ao começo, e o prêmio que o cliente já ganhou continua dele.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await rolarPaginaPara(palco, caixa(p, 1), 110);
        await palco.camera(caixa(p, 1), { zoomMax: 1.3, margem: 30, ms: 500 });
        await ctx.ate(0.22);
        await palco.clicar(p.locator(".fh-prazo", { hasText: "60 dias" }), { ms: 500 });
        await ctx.ate(0.5);
        await palco.mover(caixa(p, 1).locator("header span"), { ms: 600 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Marque também quais pedidos contam um passo. O site conta sempre. Balcão, mesa, totem e WhatsApp já vêm marcados, e os aplicativos, como o iFood, vêm desmarcados.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // sobe a caixa: mais abaixo, o aviso flutuante "WhatsApp da loja" fica por cima da linha dos aplicativos
        await rolarPaginaPara(palco, caixa(p, 2), 60);
        await palco.camera(caixa(p, 2), { zoomMax: 1.3, margem: 24, ms: 600 });
        await palco.mover(caixa(p, 2).locator("header b"), { ms: 500 });
        await ctx.ate(0.26);
        await palco.destacar(canal(p, "Site da loja"), { folga: 4 });
        await palco.mover(canal(p, "Site da loja"), { ms: 400 });
        await ctx.ate(0.42);
        await palco.destacar([canal(p, "Balcão / PDV"), canal(p, "WhatsApp")], { folga: 4 });
        await palco.mover(canal(p, "Mesa"), { ms: 400 });
        await ctx.ate(0.74);
        await palco.destacar(canal(p, "iFood, 99Food"), { folga: 4 });
        await palco.mover(canal(p, "iFood, 99Food"), { ms: 400 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Ligar a trilha",
      fala: "Com a trilha montada, clique em Ligar trilha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await rolarPagina(palco, 150);
        const ligar = p.locator(".fh-liga");
        await palco.destacar(ligar, { folga: 6 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        await palco.clicar(ligar, { ms: 500 });
        await p.getByText("Trilha ligada").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
        await dormir(400);
      },
    },
    {
      capitulo: "Cashback",
      fala: "Antes de salvar, veja a aba Cashback Automático. Ela guarda a porcentagem, o pedido mínimo, o limite de resgate e a validade dos créditos, e já vem habilitada.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(aba(p, /Cashback Automático/), { ms: 600 });
        const habilitado = p.getByRole("button", { name: /Cashback Habilitado/ });
        await habilitado.waitFor({ state: "visible", timeout: 8000 });
        const campo = (rotulo) => p.getByText(rotulo, { exact: true }).locator("xpath=..");
        const campos = ["Porcentagem de Cashback (%)", "Pedido Mínimo para Acumular (R$)", "Limite de Resgate por Pedido (%)", "Expiração dos Créditos (dias)"].map(campo);
        await palco.camera([habilitado, ...campos], { zoomMax: 1.3, margem: 30, ms: 600 });
        for (const [i, c] of campos.entries()) {
          await ctx.ate(0.3 + i * 0.13);
          await palco.destacar(c, { folga: 5 });
          await palco.mover(c, { ms: 350 });
        }
        await ctx.ate(0.84);
        await palco.destacar(habilitado, { folga: 6 });
        await palco.mover(habilitado, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Se a loja não vai oferecer cashback, clique no botão para desabilitar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await ctx.ate(0.5);
        await palco.clicar(p.getByRole("button", { name: /Cashback Habilitado/ }), { ms: 300 });
        const desligado = p.getByRole("button", { name: /Desabilitado/ });
        await desligado.waitFor({ state: "visible", timeout: 8000 });
        await palco.destacar(desligado, { folga: 6 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Salvar",
      fala: "Nada aqui grava sozinho. Desça até o fim e clique em Salvar Programa de Fidelidade.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await rolarPagina(palco, 3000);
        await palco.destacar(salvar(p), { folga: 5 });
        await palco.mover(salvar(p), { ms: 600 });
        await ctx.ate(0.75);
        await palco.apagarDestaque();
        await palco.clicar(salvar(p), { ms: 200 });
        await p.getByText("Configurações de Fidelidade Salvas").waitFor({ state: "visible", timeout: 15_000 });
        await palco.destacar(salvar(p), { folga: 5 });
        await ctx.ate(1);
        await dormir(900);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O que o cliente vê",
      fala: "No cardápio da loja, o cliente vê a faixa da Trilha Premiada, com quantos pedidos faltam para o próximo prêmio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const verCardapio = p.locator("a.fh-menu-cardapio");
        // O link abre o cardápio em outra guia; a gravação segue na mesma.
        await verCardapio.evaluate((el) => el.removeAttribute("target"));
        await palco.clicar(verCardapio, { ms: 700 });
        const faixa = p.locator(".fh-faixa");
        await faixa.waitFor({ state: "visible", timeout: 60_000 });
        await p.addStyleTag({ content: PULSO }).catch(() => {});
        await dormir(300);
        await palco.destacar(faixa, { folga: 5 });
        await palco.camera(faixa, { zoomMax: 1.3, margem: 60, ms: 600 });
        await palco.mover(faixa.locator(".fh-faixa-txt"), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Em Ver a trilha, ele abre o mapa, os prêmios e as regras. O prêmio entra sozinho no pedido seguinte, feito pelo site da loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.locator(".fh-faixa-btn"), { ms: 500 });
        const aberta = p.locator(".fh-folha-cli");
        await aberta.waitFor({ state: "visible", timeout: 8000 });
        await dormir(250);
        await palco.camera(aberta, { zoomMax: 1.25, margem: 16, ms: 600 });
        await palco.mover(aberta.locator(".fh-mapa"), { ms: 500 });
        await ctx.ate(0.3);
        await palco.mover(aberta.locator(".fh-premio-linha").first(), { ms: 450 });
        await ctx.ate(0.48);
        const regra = aberta.getByText(/Para usar o prêmio/);
        await palco.rolarAte(regra, { bloco: "center" });
        await palco.destacar(regra, { folga: 5 });
        await palco.mover(regra, { ms: 500 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 400 });
        // de volta ao painel, para a última cena
        await p.goBack({ waitUntil: "load", timeout: 60_000 });
        await p.getByRole("button", { name: /^Tutorial/ }).first().waitFor({ state: "visible", timeout: 60_000 });
        await p.locator(".fh-liga").waitFor({ state: "visible", timeout: 60_000 });
        // o navegador devolve a página rolada até onde estava (o botão de salvar, lá embaixo)
        await p.evaluate(() => window.scrollTo({ top: 0 }));
        await p.addStyleTag({ content: PULSO }).catch(() => {});
        await dormir(300);
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "De volta ao painel, a trilha já está valendo. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        await palco.mover(p.locator(".fh-liga"), { ms: 700 });
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
