// Tutorial da tela Modo Contingência (/store/contingencia, ModoContingenciaClient).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE.
//
// O que foi conferido no código antes de escrever (13/10/2026):
// - menu: botão roxo "Modo Contingência" logo abaixo de "Tutoriais em vídeo"
//   (StoreSidebar, a.fh-menu-contingencia);
// - "Como funciona": o desenho de três cenas (IlustracaoDaContingencia), com a
//   faixa de aviso igual à de components/contingencia/TrocaDeContingencia.tsx;
// - o passo a passo olha o estado: Assistente achado → versão com contingência
//   → ativado → cópia pronta (etapa "pronta" + copiaEm) → teste feito; o passo
//   da vez fica roxo, com "FAÇA AGORA" e o botão dentro; os feitos ficam verdes;
// - "Procurar atualização agora" é o item do menu da bandeja do Assistente
//   (firehub-print-assistant/main.js);
// - o teste dura 2 minutos (POST /contingencia/testar no Assistente); a troca
//   de tela acontece em menos de 1 minuto (45 s fora do caixa, decisão de 14/10);
// - na queda: iFood pausado e reaberto sozinho (lib/loja-sem-conexao.ts); nota
//   fiscal fica para a volta.
//
// ── O ASSISTENTE E A NUVEM, NESTA GRAVAÇÃO ─────────────────────────────────
// O computador da gravação não tem o Assistente nem uma contingência de
// verdade, de propósito. O navegador responde no lugar dos dois (page.route),
// no formato exato das rotas reais:
//   - Assistente (127.0.0.1:7899): /status, /contingencia/estado,
//     /contingencia/parear e /contingencia/testar (contingencia.js →
//     estadoPublico);
//   - nuvem: /api/contingencia/estado e POST /api/contingencia/ativar.
// O Assistente começa numa versão sem contingência (o passo 2 aparece com o
// jeito de atualizar); o clique em "Já atualizei, conferir" passa para a
// versão atual. Ativar faz a "cópia" andar em ~10 s (de verdade leva alguns
// minutos — a fala diz isso). O teste só marca "testando": nenhuma tela troca
// de endereço na gravação. Nada sai do navegador para programa nenhum.
import { dormir } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";

const VERSAO_VELHA = "1.2.30";
const VERSAO_NOVA = "1.2.36";
const VERSAO_DO_PACOTE = "mgq7k2x1-tutorial";
const IP_DA_LOJA = "192.168.0.10";
const BAIXANDO_MS = 8000;
const PRONTA_MS = 10_000;

/** O estado da simulação desta gravação (ver simular). */
let estado = null;

const PULSO = "#contact-widget-fab,.fcw-fab-pulse{animation:none !important}";

function simular(lojaId) {
  const s = { atualizado: false, pareadoEm: 0, testando: false };
  const cabecalhos = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-private-network": "true" };
  const json = (rota, corpo, status = 200) => rota.fulfill({ status, headers: cabecalhos, contentType: "application/json", body: JSON.stringify(corpo) });
  const decorrido = () => (s.pareadoEm ? Date.now() - s.pareadoEm : 0);
  const pronta = () => !!s.pareadoEm && decorrido() >= PRONTA_MS;

  const doAssistente = async (rota) => {
    const req = rota.request();
    if (req.method() === "OPTIONS") return rota.fulfill({ status: 204, headers: cabecalhos });
    const caminho = new URL(req.url()).pathname;
    if (caminho === "/status") {
      return json(rota, {
        ok: true, app: "FireHub-Thermal-Printer-v2", version: s.atualizado ? VERSAO_NOVA : VERSAO_VELHA,
        printers: [{ name: "ELGIN i9", driver: "ELGIN i9", port: "USB002", status: "Normal" }], pendentes: [],
        config: { franchiseeId: lojaId, domain: "localhost" },
      });
    }
    if (caminho.startsWith("/contingencia/")) {
      // O Assistente antigo não conhece estas rotas.
      if (!s.atualizado) return json(rota, { error: "Cannot GET" }, 404);
      if (caminho === "/contingencia/parear") { s.pareadoEm = Date.now(); return json(rota, { ok: true }); }
      if (caminho === "/contingencia/testar") { s.testando = true; return json(rota, { ok: true }); }
      if (caminho === "/contingencia/estado") {
        const t = decorrido();
        const etapa = !s.pareadoEm ? "desligada"
          : t < BAIXANDO_MS ? `baixando o FireHub (versão ${VERSAO_DO_PACOTE})`
          : t < PRONTA_MS ? "montando o FireHub" : "pronta";
        return json(rota, {
          ativa: !!s.pareadoEm, etapa,
          progresso: s.pareadoEm && t < BAIXANDO_MS ? Math.min(99, Math.max(3, (t / BAIXANDO_MS) * 100)) : null,
          erro: null, versao: s.pareadoEm ? VERSAO_DO_PACOTE : null, modo: "normal",
          pronta: pronta(), testando: s.testando, porta: 7890, pendentes: 0, memoriaTotalMb: 8192,
        });
      }
      return json(rota, { ok: true });
    }
    return json(rota, { ok: true });
  };

  const daNuvem = async (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname;
    if (caminho === "/api/contingencia/ativar" && req.method() === "POST") {
      return json(rota, { lojaId, chave: "tutorial", segredoDoBilhete: "tutorial", nuvem: "http://localhost" });
    }
    if (caminho === "/api/contingencia/estado") {
      const ativada = !!s.pareadoEm;
      return json(rota, {
        ativada, dono: true, slug: LOJA.slug,
        ativadaEm: ativada ? new Date(s.pareadoEm).toISOString() : undefined,
        ultimoContato: ativada ? new Date().toISOString() : null,
        relato: ativada ? {
          modo: "normal", copiaEm: pronta() ? new Date(Date.now() - 3000).toISOString() : null, pendentes: 0,
          versao: VERSAO_DO_PACOTE, ips: [IP_DA_LOJA], porta: 7890, ultimoErro: null,
        } : null,
        episodios: [], conflitos: [],
      });
    }
    return rota.continue();
  };

  return { s, doAssistente, daNuvem };
}

const passo = (p, n) => p.locator(`[data-passo="${n}"]`);

export default {
  id: "contingencia",
  titulo: "Modo Contingência: a loja não para quando a internet cai",
  rota: "store/contingencia",
  prontaQuando: "text=Como funciona",

  async antesDeGravar(palco, { prisma }) {
    const p = palco.pagina;
    const loja = await prisma.user.findUnique({ where: { email: LOJA.email }, select: { id: true } });
    const sim = simular(loja.id);
    estado = sim.s;
    await p.route(/^http:\/\/(localhost|127\.0\.0\.1):(7899|7900|7901|7891)\//, sim.doAssistente);
    await p.route((url) => url.pathname === "/api/contingencia/estado" || url.pathname === "/api/contingencia/ativar", sim.daNuvem);
    await p.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
    await p.addInitScript((css) => {
      document.addEventListener("DOMContentLoaded", () => {
        const st = document.createElement("style");
        st.textContent = css;
        document.head.appendChild(st);
      });
    }, PULSO);
    // A tela procura o Assistente quando abre: recarrega para ela achar o da gravação.
    await p.reload({ waitUntil: "load", timeout: 120_000 });
    await passo(p, 2).and(p.locator('[data-situacao="agora"]')).waitFor({ state: "visible", timeout: 60_000 });
    await dormir(2000);
  },

  cenas: [
    {
      capitulo: "O que é o Modo Contingência",
      fala: "O Modo Contingência fica no menu, em roxo, logo abaixo de Tutoriais em vídeo. Ele mantém sua loja funcionando quando a internet cai.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.locator("a.fh-menu-contingencia");
        await dormir(300);
        await palco.destacar(botao, { folga: 5 });
        await palco.mover(botao, { ms: 900 });
        await ctx.ate(0.55);
        await palco.apagarDestaque();
        await palco.mover(p.getByRole("heading", { name: "Modo Contingência" }), { ms: 700 });
      },
    },
    {
      capitulo: "Como funciona",
      fala: "Com internet, tudo funciona como hoje, e o computador do caixa guarda uma cópia da loja, sempre atualizada.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const desenho = p.locator("[data-ilustracao-contingencia]");
        await palco.rolarAte(desenho, { bloco: "center" });
        await palco.clicar(p.locator('[data-cena="normal"]'), { ms: 700 });
        await palco.camera(desenho, { zoomMax: 1.35, margem: 24 });
        await ctx.ate(0.6);
        await palco.mover(desenho.getByText("Computador do caixa", { exact: true }), { ms: 700 });
      },
    },
    {
      fala: "Se a internet cair, em menos de 1 minuto as telas passam para esse computador. A TV da cozinha e o celular do garçom chegam nele pelo Wi-Fi da loja, e a impressão continua igual.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const desenho = p.locator("[data-ilustracao-contingencia]");
        await palco.clicar(p.locator('[data-cena="caiu"]'), { ms: 600 });
        await ctx.ate(0.3);
        await palco.mover(desenho.locator(".fh-ct-faixa"), { ms: 700 });
        await ctx.ate(0.55);
        await palco.mover(desenho.getByText("TV da cozinha", { exact: true }), { ms: 700 });
        await ctx.ate(0.7);
        await palco.mover(desenho.getByText("Celular do garçom", { exact: true }), { ms: 700 });
        await ctx.ate(0.9);
        await palco.mover(desenho.getByText("Impressora", { exact: true }), { ms: 600 });
      },
    },
    {
      fala: "Quando a internet volta, tudo o que foi feito sobe sozinho para o FireHub, sem duplicar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const desenho = p.locator("[data-ilustracao-contingencia]");
        await palco.clicar(p.locator('[data-cena="voltou"]'), { ms: 600 });
        await ctx.ate(0.5);
        await palco.mover(desenho.getByText("FireHub na internet", { exact: true }), { ms: 700 });
        await ctx.ate(1);
        await palco.cameraAberta();
      },
    },
    {
      capitulo: "O que você precisa",
      fala: "Para usar, você precisa de um computador Windows no caixa, ligado no expediente, com o Assistente de Impressão instalado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const secao = p.locator('[data-secao="precisa"]');
        await palco.rolarAte(secao, { bloco: "center" });
        await palco.esperarRolagemParar(secao);
        await palco.destacar(secao.getByText("Computador Windows no caixa", { exact: true }).locator("xpath=../.."), { folga: 4 });
        await palco.mover(secao.getByText("Computador Windows no caixa", { exact: true }), { ms: 700 });
        await ctx.ate(0.6);
        await palco.destacar(secao.getByText("Assistente de Impressão", { exact: true }).locator("xpath=../.."), { folga: 4 });
        await palco.mover(secao.getByText("Assistente de Impressão", { exact: true }), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O passo a passo",
      fala: "Mais acima fica o passo a passo. Ele acompanha o que você já fez: o passo feito fica verde, e o da vez fica em roxo, com o botão dentro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const lista = p.locator('[data-secao="passos"]');
        await palco.rolarAte(passo(p, 1), { bloco: "start" });
        await palco.camera(lista, { zoomMax: 1.3, margem: 20 });
        await ctx.ate(0.4);
        await palco.destacar(passo(p, 1), { folga: 4 });
        await palco.mover(passo(p, 1).getByText("Feito", { exact: true }), { ms: 700 });
        await ctx.ate(0.7);
        await palco.destacar(passo(p, 2), { folga: 4 });
        await palco.mover(passo(p, 2).getByText("FAÇA AGORA", { exact: true }), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Atualizar o Assistente",
      fala: "Aqui, o Assistente está desatualizado. Clique com o botão direito no ícone do FireHub, perto do relógio, e escolha Procurar atualização agora. Depois, clique em Já atualizei, conferir.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const instrucoes = passo(p, 2).locator("ol");
        await palco.destacar(instrucoes, { folga: 6 });
        await palco.mover(instrucoes.getByText("botão direito", { exact: true }), { ms: 700 });
        await ctx.ate(0.6);
        await palco.mover(instrucoes.getByText("Procurar atualização agora", { exact: true }), { ms: 600 });
        await ctx.ate(0.82);
        await palco.apagarDestaque();
        // O que a atualização do Assistente faz de verdade no computador da loja.
        estado.atualizado = true;
        await palco.clicar(p.getByRole("button", { name: /Já atualizei, conferir/ }), { ms: 600 });
        await passo(p, 3).and(p.locator('[data-situacao="agora"]')).waitFor({ state: "visible", timeout: 15_000 });
      },
    },
    {
      capitulo: "Ativar neste computador",
      fala: "Pronto: o passo dois ficou verde. Agora, clique em Ativar neste computador.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.mover(passo(p, 2).getByText("Feito", { exact: true }), { ms: 600 });
        await ctx.ate(0.55);
        await palco.clicar(p.locator('[data-acao="ativar"]'), { ms: 700 });
        await passo(p, 4).and(p.locator('[data-situacao="agora"]')).waitFor({ state: "visible", timeout: 15_000 });
      },
    },
    {
      fala: "O Assistente baixa o FireHub e faz a cópia da loja. Leva alguns minutos, e você pode continuar trabalhando enquanto isso. A barra mostra o andamento. Quando termina, o passo quatro fica verde e o teste é liberado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const barra = p.locator("[data-barra-da-copia]");
        await palco.destacar(passo(p, 4), { folga: 4 });
        await palco.mover(barra, { ms: 800 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await passo(p, 5).and(p.locator('[data-situacao="agora"]')).waitFor({ state: "visible", timeout: 20_000 });
        await palco.mover(passo(p, 4).getByText("Feito", { exact: true }), { ms: 600 });
      },
    },
    {
      capitulo: "O teste de 2 minutos",
      fala: "Com a cópia pronta, faça o teste. Clique em Testar agora.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const testar = p.locator('[data-acao="testar"]');
        await palco.rolarAte(testar, { bloco: "center" });
        await ctx.ate(0.5);
        await palco.clicar(testar, { ms: 700 });
      },
    },
    {
      fala: "Por 2 minutos, o computador age como se a internet tivesse caído. A tela troca sozinha, com um aviso embaixo. Lance um pedido de teste no Balcão: no fim, ele sobe sozinho.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aviso = p.getByText(/Teste começou/);
        await palco.rolarAte(aviso, { bloco: "center" });
        await palco.esperarRolagemParar(aviso);
        await palco.destacar(aviso, { folga: 6 });
        await palco.mover(aviso, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Com o teste feito, a tela avisa que sua loja está protegida.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const titulo = p.getByRole("heading", { name: "Sua loja está protegida" });
        await palco.rolarAte(titulo, { bloco: "center" });
        await palco.esperarRolagemParar(titulo);
        await palco.destacar(titulo.locator("xpath=.."), { folga: 4 });
        await palco.mover(titulo, { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "TV da cozinha e garçom",
      fala: "Se você tem TV na cozinha ou garçom, deixe os dois no Wi-Fi da loja. O garçom aponta a câmera do celular para este QR.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bloco = passo(p, "tv");
        await palco.rolarAte(bloco, { bloco: "center" });
        await palco.esperarRolagemParar(bloco);
        await palco.destacar(bloco, { folga: 4 });
        await palco.mover(bloco.getByText("Wi-Fi da loja", { exact: true }), { ms: 700 });
        await ctx.ate(0.6);
        await palco.mover(p.getByAltText("QR do garçom"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Durante a queda",
      fala: "Durante a queda, pedidos, mesas, cozinha, caixa e impressão continuam. O iFood fica pausado e reabre sozinho, e a nota fiscal fica para quando a internet voltar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const secao = p.locator('[data-secao="queda"]');
        await palco.rolarAte(secao, { bloco: "center" });
        await palco.esperarRolagemParar(secao);
        const continua = secao.getByText("Continua funcionando", { exact: true }).locator("xpath=../..");
        await palco.destacar(continua, { folga: 4 });
        await palco.mover(continua, { ms: 700 });
        await ctx.ate(0.5);
        const espera = secao.getByText("Espera a internet voltar", { exact: true }).locator("xpath=../..");
        await palco.destacar(espera, { folga: 4 });
        await palco.mover(espera.getByText("iFood:", { exact: true }), { ms: 600 });
        await ctx.ate(0.8);
        await palco.mover(espera.getByText("Nota fiscal:", { exact: true }), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "No fim da tela ficam as dúvidas mais comuns.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const secao = p.locator('[data-secao="duvidas"]');
        await palco.rolarAte(secao, { bloco: "center" });
        await palco.esperarRolagemParar(secao);
        await palco.destacar(secao, { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Para rever este vídeo, é só clicar em Tutoriais em vídeo, aqui no menu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const botao = p.getByRole("button", { name: "Tutoriais em vídeo" });
        await ctx.ate(0.15);
        await palco.camera(botao, { zoomMax: 1.7, margem: 80 });
        await palco.destacar(botao, { folga: 6 });
        await palco.mover(botao, { ms: 900 });
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
        await palco.cameraAberta();
      },
      pausa: 600,
    },
  ],
};
