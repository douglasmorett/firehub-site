// Tutorial da tela Aplicativo da loja (/store/aplicativo, AplicativoClient).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE.
//
// O que foi conferido no código antes de escrever (18/10/2026, master 23dabfd7):
// - menu lateral: botão amarelo "Tenha o app da sua loja" (StoreSidebar), só
//   para o dono (funcionário não vê);
// - preços em lib/app-da-loja/plano.ts: Só Android R$ 149, Só Apple R$ 149,
//   Android + Apple R$ 197 (cartão "Premium · mais escolhido"); a mensalidade
//   entra no mesmo boleto do FireHub; sem taxa por pedido, sem comissão;
// - Multimarcas de cortesia no Premium: item no cartão e a faixa "Bônus do
//   Premium" (R$ 97/mês, lib/multimarcas/preco.ts); com uma plataforma só, o
//   Multimarcas é cobrado normalmente;
// - "Quero o meu aplicativo" / "Quero esse" / "Quero o Premium" abrem o WhatsApp
//   de vendas do FireHub com a loja e o plano na mensagem e anotam o clique
//   (POST /api/store/aplicativo). Quem ativa é o admin, à mão. NESTE VÍDEO NENHUM
//   DESSES BOTÕES É CLICADO: só apontados. Por garantia, window.open fica
//   desligado e wa.me é barrado no navegador da gravação;
// - o celular de exemplo usa o nome da loja e as fotos do cardápio dela; as abas
//   Cardápio, Pedidos e Loja mudam de verdade; os avisos trocam a cada 3 s;
// - a calculadora usa só os números que o lojista mexe (nada é afirmado);
// - dúvidas: "Como é cobrado?" e "Preciso de CNPJ?" (texto do AplicativoClient).
//
// O botão "Tutoriais em vídeo" do menu só aparece quando há vídeo no disco; na
// gravação desta worktree não há nenhum, então o fim do vídeo aponta o botão
// "Quero o meu aplicativo" em vez dele.
import fs from "node:fs";
import path from "node:path";
import { dormir } from "../motor/palco.mjs";
import { assentar } from "./_cardapio-comum.mjs";

/** Fotos dos produtos fictícios (geradas para o vídeo do Tráfego Pago; nenhuma é de loja real). */
const FOTOS = "C:/Users/Micro/tutoriais-teste/fotos-trafego";

const menu = (p) => p.locator('a.fh-menu-app[href="/store/aplicativo"]');
const premium = (p) => p.locator(".al-premium");
const cartaoDoPlano = (p, nome) => p.locator(".al-plano").filter({ has: p.locator(".al-plano-nome", { hasText: nome }) }).first();

/**
 * Esconde o que não é desta tela: os balões flutuantes (WhatsApp da loja,
 * suporte, Bill) no canto de baixo e o brilho que corre no botão do menu.
 * Roda de novo a cada meio segundo, porque os balões renascem a cada render.
 */
function esconderFlutuantes() {
  const css = document.createElement("style");
  css.textContent = ".fh-menu-app::after{animation:none!important;display:none!important}#contact-widget-fab,[class^=fcw-],[class*=\" fcw-\"]{display:none!important}";
  document.head.appendChild(css);
  const varrer = () => {
    for (const el of document.body.querySelectorAll("body *")) {
      if (el.id?.startsWith("tutorial-") || el.closest(".al")) continue;
      const s = getComputedStyle(el);
      if (s.position !== "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left > innerWidth - 420 && r.top > innerHeight - 320) el.style.setProperty("display", "none", "important");
    }
  };
  varrer();
  setInterval(varrer, 500);
}

export default {
  id: "aplicativo",
  titulo: "Aplicativo da loja: o seu app na Play Store e na App Store",
  rota: "store/aplicativo",
  prontaQuando: "text=Escolha onde a sua loja vai estar",
  pronuncia: {
    "R$ 149": "cento e quarenta e nove reais",
    "R$ 197": "cento e noventa e sete reais",
    "R$ 97": "noventa e sete reais",
  },

  /** Fotos em 4 produtos: o celular de exemplo e a galeria mostram o cardápio da própria loja. */
  async preparar(prisma, { produtos }) {
    const destino = path.join(process.cwd(), "public", "uploads", "tutorial-aplicativo");
    fs.mkdirSync(destino, { recursive: true });
    const fotos = { "X-Bacon": "x-bacon", "X-Tudo": "x-tudo", "Pizza Calabresa": "pizza-calabresa", "Batata Frita": "batata-frita" };
    for (const [nome, arquivo] of Object.entries(fotos)) {
      fs.copyFileSync(path.join(FOTOS, `${arquivo}.jpg`), path.join(destino, `${arquivo}.jpg`));
      await prisma.menuProduct.update({ where: { id: produtos[nome].id }, data: { imageUrl: `/uploads/tutorial-aplicativo/${arquivo}.jpg` } });
    }
  },

  /**
   * - nada sai para o WhatsApp: wa.me barrado e window.open desligado;
   * - o aviso do Assistente de Impressão (o desta máquina é de outra loja) sai
   *   pelo "Não ver mais", antes de gravar;
   * - balões flutuantes escondidos; tela assentada (seta e rolagem firmes).
   */
  async antesDeGravar(palco) {
    const p = palco.pagina;
    await p.route(/wa\.me|api\.whatsapp\.com/, (rota) => rota.abort());
    await p.evaluate(() => { window.open = () => null; });
    const naoVerMais = p.getByRole("button", { name: "Não ver mais" });
    if (await naoVerMais.count()) { await naoVerMais.first().click().catch(() => {}); await dormir(500); }
    await p.evaluate(esconderFlutuantes);
    await p.evaluate(() => window.scrollTo(0, 0));
    await assentar(palco);
  },

  cenas: [
    {
      capitulo: "Onde fica",
      fala: "O aplicativo da sua loja fica no botão amarelo Tenha o app da sua loja, aqui no menu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(300);
        await ctx.ate(0.25);
        await palco.destacar(menu(p), { folga: 5 });
        await palco.mover(menu(p), { ms: 900 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O que é",
      fala: "É o aplicativo próprio da sua loja, na Play Store e na App Store, com a sua marca. O cliente pede direto de você, sem comissão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.mover(p.locator(".al-selo"), { ms: 800 });
        await ctx.ate(0.5);
        await palco.destacar(p.locator(".al-hero h2"), { folga: 8 });
        await palco.mover(p.locator(".al-hero h2 span"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "E a notificação no celular do cliente não custa nada por mensagem: a promoção do dia chega direto na tela dele.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const zero = p.locator(".al-numeros > div").nth(2);
        await palco.rolarAte(p.locator(".al-numeros"), { bloco: "end" });
        await palco.destacar(zero, { folga: 4 });
        await palco.mover(zero, { ms: 700 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        await palco.mover(p.locator(".al-flutua-push"), { ms: 700 });
      },
    },
    {
      capitulo: "O celular de exemplo",
      fala: "Este celular mostra como fica: o nome da sua loja no topo e as fotos do seu próprio cardápio.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cel = p.locator(".al-celular");
        await palco.rolarAte(cel, { bloco: "center" });
        await palco.camera(cel, { zoomMax: 1.45, margem: 30 });
        await palco.mover(p.locator(".al-cel-topo"), { ms: 700 });
        await ctx.ate(0.6);
        await palco.mover(p.locator(".al-cel-item").first(), { ms: 700 });
      },
    },
    {
      fala: "Na aba Pedidos, o cliente acompanha cada etapa e o motoboy no mapa. E cada etapa chega como aviso no celular.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aba = (nome) => p.locator(".al-cel-abas button", { hasText: nome });
        await ctx.ate(0.08);
        await palco.clicar(aba("Pedidos"), { ms: 600 });
        await ctx.ate(0.4);
        await palco.mover(p.locator(".al-cel-mapa"), { ms: 600 });
        await ctx.ate(0.72);
        await palco.mover(p.locator(".al-cel-aviso"), { ms: 600 });
        await ctx.ate(1);
        await palco.clicar(aba("Cardápio"), { ms: 600 });
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Os planos",
      fala: "Clique em Ver os planos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const ver = p.getByRole("button", { name: "Ver os planos" });
        await palco.rolarAte(ver, { bloco: "center" });
        await palco.clicar(ver, { ms: 600 });
        await palco.esperarRolagemParar(p.locator("#al-planos"));
        await dormir(400);
      },
      pausa: 300,
    },
    {
      fala: "Só Android ou só Apple custa R$ 149 por mês. Os dois juntos, no plano Premium, saem por R$ 197.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.mover(cartaoDoPlano(p, "Só Android").locator(".al-plano-preco"), { ms: 700 });
        await ctx.ate(0.22);
        await palco.mover(cartaoDoPlano(p, "Só Apple").locator(".al-plano-preco"), { ms: 900 });
        await ctx.ate(0.5);
        await palco.destacar(premium(p), { folga: 6 });
        await palco.mover(premium(p).locator(".al-plano-preco"), { ms: 800 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Todos têm notificação ilimitada e pedidos, rastreio e motoboy ao vivo. A mensalidade entra no mesmo boleto do FireHub, sem taxa por pedido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const itens = premium(p).locator("li");
        await palco.mover(itens.nth(1), { ms: 600 });
        await ctx.ate(0.25);
        await palco.mover(itens.nth(2), { ms: 500 });
        await ctx.ate(0.5);
        const sub = p.locator("#al-planos .al-sub");
        await palco.destacar(sub, { folga: 6 });
        await palco.mover(sub, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Bônus: Multimarcas de cortesia",
      fala: "E tem um bônus: quem assina Android e Apple, o Premium, ganha o Multimarcas de cortesia. Não paga os R$ 97 por mês dele.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const item = premium(p).locator(".al-bonus-item");
        await palco.camera(premium(p), { zoomMax: 1.35, margem: 30 });
        await ctx.ate(0.2);
        await palco.destacar(item, { folga: 6 });
        await palco.mover(item.locator("b"), { ms: 700 });
        await ctx.ate(0.8);
        await palco.mover(item.locator("span"), { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "A faixa logo abaixo confirma. Já com uma plataforma só, o Multimarcas é cobrado normalmente.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bonus = p.locator(".al-bonus");
        await palco.rolarAte(bonus, { bloco: "center" });
        await palco.destacar(bonus, { folga: 6 });
        await palco.mover(bonus.locator("b").first(), { ms: 700 });
        await ctx.ate(0.5);
        await palco.mover(bonus.locator("span").filter({ hasText: "cobrado normalmente" }).first(), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Faça a conta",
      fala: "Mais abaixo tem uma calculadora. Mexa nos números da sua loja: pedidos por mês, ticket médio e a comissão que você paga.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const calc = p.locator(".al-calc");
        await palco.rolarAte(calc, { bloco: "center" });
        const faixas = calc.locator("input[type=range]");
        await ctx.ate(0.4);
        // Arrasta a bolinha de "Pedidos por mês" de 400 para uns 800.
        const c = await faixas.nth(0).boundingBox();
        const ponto = (f) => ({ x: c.x + 8 + f * (c.width - 16), y: c.y + c.height / 2 });
        await palco.arrastar(ponto((400 - 50) / 2950), ponto((800 - 50) / 2950));
        await faixas.nth(0).evaluate((el) => el.blur());
        await ctx.ate(0.75);
        await palco.mover(faixas.nth(1), { ms: 450 });
        await ctx.ate(0.88);
        await palco.mover(faixas.nth(2), { ms: 400 });
      },
    },
    {
      fala: "A conta mostra quanto vai de comissão hoje, e com quantos pedidos pelo aplicativo o Premium se paga.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const res = p.locator(".al-calc-resultado");
        await palco.destacar(res, { folga: 6 });
        await palco.mover(res.locator(".al-vermelho"), { ms: 700 });
        await ctx.ate(0.55);
        await palco.mover(res.locator(".al-calc-linha b").first(), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Como contratar",
      fala: "Para ter o seu, você chama o nosso time. A gente monta o aplicativo com a sua logo, as suas cores e o seu cardápio, e publica no nome da sua loja.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const passos = p.locator(".al-passos li");
        await palco.rolarAte(p.locator(".al-passos"), { bloco: "center" });
        await palco.destacar(p.locator(".al-passos"), { folga: 6 });
        await palco.mover(passos.nth(0).locator("b"), { ms: 600 });
        await ctx.ate(0.3);
        await palco.mover(passos.nth(1).locator("b"), { ms: 600 });
        await ctx.ate(0.72);
        await palco.mover(passos.nth(2).locator("b"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "O botão Quero o meu aplicativo abre o WhatsApp do FireHub com o nome da sua loja e o plano escolhido. O nosso time ativa o plano para você.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const final = p.locator(".al-final");
        const botao = final.getByRole("button", { name: /Quero o meu aplicativo/ });
        await palco.rolarAte(final, { bloco: "center" });
        // Só apontado: o clique abriria o WhatsApp de verdade.
        await palco.destacar(botao, { folga: 8 });
        await palco.mover(botao, { ms: 800 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Dúvidas",
      fala: "No fim da página ficam as dúvidas mais comuns, como a forma de cobrança e o que precisa para publicar nas lojas de aplicativos.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const faq = p.locator(".al-faq");
        const pergunta = (t) => faq.getByRole("button", { name: new RegExp(`^${t}`) });
        await palco.rolarAte(pergunta("Preciso de CNPJ"), { bloco: "center" });
        await ctx.ate(0.3);
        await palco.clicar(pergunta("Como é cobrado"), { ms: 600 });
        await ctx.ate(0.68);
        await palco.clicar(pergunta("Preciso de CNPJ"), { ms: 600 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Seus clientes já têm o celular na mão. Coloque a sua loja nele.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cta = p.locator(".al-hero").getByRole("button", { name: /Quero o meu aplicativo/ });
        await palco.rolarPagina(0);
        await palco.destacar(cta, { folga: 8 });
        await palco.mover(cta, { ms: 900 });
        await ctx.ate(1);
        await dormir(600);
        await palco.apagarDestaque();
      },
      pausa: 700,
    },
  ],
};
