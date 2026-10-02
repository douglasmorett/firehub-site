// Tutorial da tela Fiscal (/store/fiscal).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Nada aqui emite, cancela ou consulta nota: o roteiro só abre e
// mostra. A emissão fica DESLIGADA e a loja fictícia não tem certificado, então
// nenhum clique deste roteiro chega à SEFAZ nem a provedor nenhum.
import { dormir } from "../motor/palco.mjs";
import { fusoDaNoite } from "../ambiente/relogio.mjs";

/**
 * A loja fictícia com o cadastro da empresa preenchido e SEM certificado nem
 * CSC: é o retrato de quem está no meio do caminho para ligar a nota, e é o
 * que faz a tela mostrar a lista do que falta.
 *
 * O cadastro vem completo de propósito: com dado da empresa faltando, abrir
 * Configurações dispara sozinho a consulta do CNPJ na Receita (serviço de fora).
 *
 * CNPJ 12.345.678/0001-95 é o número de exemplo de manual (só os dígitos
 * verificadores fecham); a inscrição estadual é inventada.
 */
const CADASTRO = {
  enabled: false,
  provedor: "sefaz",
  ambiente: 2,
  cnpj: "12.345.678/0001-95",
  inscricaoEstadual: "12345678",
  razaoSocial: "SABOR DA PRACA LANCHONETE LTDA",
  nomeFantasia: "Sabor da Praça",
  regimeTributario: 1,
  logradouro: "Praça Central",
  numero: "100",
  bairro: "Centro",
  municipio: "Cidade Exemplo",
  codigoMunicipio: "3300000",
  uf: "RJ",
  cep: "20000-000",
  serie: 1,
  autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"],
  momentoDaEmissao: "saida",
  sefaz: { serie: 1, numeroInicial: 1, qrVersao: 2, contingenciaOffline: true },
};

const NCM = {
  "X-Burger": "2106.90.90", "X-Bacon": "2106.90.90", "X-Tudo": "2106.90.90",
  "Pizza Calabresa": "1905.90.90", "Pizza Marguerita": "1905.90.90",
  "Batata Frita": "2004.10.00", "Coca-Cola lata": "2202.10.00", "Guaraná 2 L": "2202.10.00",
};

/** A frase que a emissão automática grava na entrega sem documento (lib/fiscal-modo). */
const FALTA_CPF =
  "Falta o CPF/CNPJ do cliente: a SEFAZ só aceita a nota de entrega com o documento e o endereço de quem recebe. " +
  "Quando o cliente informar, digite o documento e emita.";

async function preparar(prisma, { loja, produtos }) {
  await prisma.user.update({ where: { id: loja.id }, data: { fiscalConfig: CADASTRO } });
  for (const [nome, ncm] of Object.entries(NCM)) {
    await prisma.menuProduct.update({ where: { id: produtos[nome].id }, data: { ncm } });
  }

  // A lista de notas mostra "o dia de hoje" do navegador (que grava no fuso em
  // que agora são 20h), mas o servidor corta esse dia pelo horário de Brasília.
  // De madrugada os dois dias não coincidem e parte dos pedidos sumiria da
  // lista: aí os pedidos da loja recuam, todos juntos, para dentro do dia.
  const dia = new Intl.DateTimeFormat("sv-SE", { timeZone: fusoDaNoite() }).format(new Date());
  const fimDoDia = new Date(`${dia}T23:59:59.999-03:00`).getTime();
  const recuo = Math.max(0, Date.now() - (fimDoDia - 5 * 60_000));
  const pedidos = await prisma.customerOrder.findMany({ where: { franchiseeId: loja.id } });
  if (recuo > 0) {
    const antes = (d) => (d ? new Date(d.getTime() - recuo) : d);
    for (const p of pedidos) {
      await prisma.customerOrder.update({
        where: { id: p.id },
        data: { createdAt: antes(p.createdAt), acceptedAt: antes(p.acceptedAt), dispatchedAt: antes(p.dispatchedAt), deliveredAt: antes(p.deliveredAt) },
      });
    }
  }

  // Situações de nota para a lista ter o que mostrar. São só marcas no banco
  // da loja fictícia: nenhuma nota foi transmitida. A chave é inventada.
  const doNumero = (n) => pedidos.find((p) => p.dailyOrderNumber === n);
  const quando = (p, min) => new Date(p.createdAt.getTime() - recuo + min * 60_000).toISOString();
  const autorizada = (p, numero, min) => ({
    fiscalStatus: "EMITTED",
    fiscalInfo: {
      nfceKey: `3326101234567800019565001${String(numero).padStart(9, "0")}1${String(numero).padStart(8, "0")}0`,
      nfceNumber: String(numero), serie: "1", protocol: `333260000000${numero}`,
      emittedAt: quando(p, min), ambiente: 1, valorDaNota: p.totalAmount,
    },
  });
  // No alto da lista (os mais recentes) ficam uma de cada: não emitida, falhou,
  // autorizada e falta CPF. As linhas de baixo ficam debaixo das bolinhas de
  // atendimento que flutuam no canto da tela.
  const p1 = doNumero(1), p2 = doNumero(2), p4 = doNumero(4), p5 = doNumero(5), p6 = doNumero(6);
  await prisma.customerOrder.update({ where: { id: p1.id }, data: { customerCpfCnpj: "52998224725", ...autorizada(p1, 127, 32) } });
  await prisma.customerOrder.update({ where: { id: p2.id }, data: autorizada(p2, 128, 16) });
  await prisma.customerOrder.update({ where: { id: p5.id }, data: { customerCpfCnpj: "52998224725", ...autorizada(p5, 129, 23) } });
  await prisma.customerOrder.update({
    where: { id: p4.id },
    data: { fiscalStatus: "PENDING", fiscalInfo: { semNotaAutomatica: { falta: "documento", motivo: FALTA_CPF } } },
  });
  await prisma.customerOrder.update({
    where: { id: p6.id },
    data: {
      fiscalStatus: "FAILED",
      fiscalInfo: { ultimoErro: "A SEFAZ não respondeu a tempo. A nota não foi autorizada.", ultimaTentativaEm: quando(p6, 4) },
    },
  });
}

// ── gestos desta tela ───────────────────────────────────────────────────────

/**
 * Rola a JANELA até o alvo ficar a `topo` pontos do alto da tela. O rolarAte do
 * palco rola a caixa de rolagem mais próxima, e nesta tela quem rola é a página.
 * `corte: true` troca de lugar sem deslizar (um corte de cena).
 */
async function rolarJanelaAte(palco, alvo, { topo = 100, corte = false } = {}) {
  const y = await alvo.evaluate((el, t) => Math.max(0, Math.round(window.scrollY + el.getBoundingClientRect().top - t)), topo);
  // Desliza em tempo CERTO (a rolagem suave do navegador demora o que quer, e a
  // cena passava da fala): quadro a quadro, proporcional à distância.
  await palco.pagina.evaluate(([alvoY, semDeslizar]) => new Promise((ok) => {
    const de = window.scrollY;
    const ms = semDeslizar ? 0 : Math.min(1000, Math.max(350, Math.abs(alvoY - de) * 0.9));
    const t0 = performance.now();
    const passo = (t) => {
      const k = ms === 0 ? 1 : Math.min(1, (t - t0) / ms);
      const s = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      window.scrollTo({ top: de + (alvoY - de) * s, behavior: "instant" });
      if (k < 1) requestAnimationFrame(passo); else ok();
    };
    requestAnimationFrame(passo);
  }), [y, corte]);
  await dormir(150);
}

/**
 * O mover do palco dá um passo a cada 16 ms e ESPERA a página responder a cada
 * um. Com a máquina ocupada (várias gravações ao mesmo tempo) um movimento de
 * 0,7 s levava 2 s, e a seta chegava depois da palavra. Este anda pelo relógio:
 * a seta chega na hora marcada, com menos passos se a página demorar. Troca só
 * o mover DESTE palco; clicar, apontar e digitar passam a usá-lo.
 */
function moverPeloRelogio(palco) {
  const suave = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  palco.mover = async function (alvo, { ms } = {}) {
    const destino = await this.centroDe(alvo);
    const distancia = Math.hypot(destino.x - this.x, destino.y - this.y);
    const duracao = ms ?? Math.min(1100, Math.max(380, distancia * 1.5));
    const de = { x: this.x, y: this.y };
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / duracao);
      const s = suave(k);
      await this.pagina.mouse.move(de.x + (destino.x - de.x) * s, de.y + (destino.y - de.y) * s);
      if (k >= 1) break;
      await dormir(12);
    }
    this.x = destino.x;
    this.y = destino.y;
  };
}

const menuFiscal = (p, nome) => p.locator("nav.fiscal-nav").getByRole("button", { name: nome, exact: true });
const linhaDoPedido = (p, n) => p.locator(".fiscal-main table tbody tr").filter({ hasText: `Nº ${n}` }).first();

export default {
  id: "fiscal",
  titulo: "Fiscal: como ligar e usar a nota (NFC-e)",
  rota: "store/fiscal",
  prontaQuando: "text=Status da nota",
  preparar,

  async antesDeGravar(palco) {
    moverPeloRelogio(palco);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela Fiscal. É aqui que a loja liga a nota fiscal do consumidor, a NFC-e, e acompanha a nota de cada pedido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(800);
        await palco.mover({ x: 820, y: 400 }, { ms: 1200 });
        await ctx.ate(0.5);
        await palco.destacar(p.locator("nav.fiscal-nav .fiscal-nav-lista"), { folga: 6 });
        await palco.mover(menuFiscal(p, "Configurações"), { ms: 700 });
        await ctx.ate(0.8);
        await palco.mover(menuFiscal(p, "Notas fiscais"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O que falta para emitir",
      fala: "No topo, a tela avisa o que ainda falta para emitir. Aqui faltam o certificado digital e o CSC.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const aviso = p.getByText("Esta loja ainda não emite nota fiscal").locator("xpath=../..");
        await palco.camera(aviso, { zoomMax: 1.45, margem: 34 });
        await palco.destacar(aviso, { folga: 6 });
        await palco.mover(aviso.locator("strong").first(), { ms: 700 });
        await ctx.ate(0.6);
        await palco.mover(aviso.locator("li strong", { hasText: "Certificado digital" }), { ms: 600 });
        await ctx.ate(0.86);
        await palco.mover(aviso.locator("li strong", { hasText: /^CSC$/ }), { ms: 450 });
        await ctx.ate(1);
        await dormir(250);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 600 });
      },
    },
    {
      capitulo: "Ligar a emissão",
      fala: "Em Configurações, o primeiro quadro liga a emissão, e o botão só libera com o cadastro completo. Homologação é teste, sem valor fiscal. Produção vale de verdade.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(menuFiscal(p, "Configurações"));
        await p.getByRole("heading", { name: "Configurações fiscais" }).waitFor({ state: "visible", timeout: 10_000 });
        // O passo a passo da SEFAZ do estado nasce aberto e é uma parede de texto
        // no meio do caminho (com um aviso que cita outra loja pelo nome). Ele é
        // recolhido aqui, ainda fora da imagem, pelo próprio botão da tela.
        const passos = p.locator('button[aria-controls="emissor-passo-a-passo"]');
        await passos.waitFor({ state: "attached", timeout: 10_000 });
        await passos.evaluate((el) => el.click());
        const quadro = p.locator("span", { hasText: /^Emissão de NFC-e$/ }).locator("xpath=../..");
        await rolarJanelaAte(palco, quadro, { topo: 170 });
        await palco.camera(quadro, { zoomMax: 1.9, margem: 44 });
        await ctx.ate(0.32);
        const ligar = p.getByRole("button", { name: /^Ligar emissão/ });
        await palco.destacar(ligar, { folga: 6 });
        await palco.mover(ligar, { ms: 700 });
        await ctx.ate(0.6);
        const ambientes = p.getByRole("group", { name: "Ambiente da emissão" }).getByRole("button");
        await palco.destacar(ambientes.nth(0), { folga: 5 });
        await palco.mover(ambientes.nth(0), { ms: 500 });
        await ctx.ate(0.84);
        await palco.destacar(ambientes.nth(1), { folga: 5 });
        await palco.mover(ambientes.nth(1), { ms: 500 });
        await ctx.ate(1);
        await dormir(250);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O caminho, passo a passo",
      fala: "O quadro Pronto para emitir mostra o caminho, passo a passo: o que já está feito e o que falta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const lista = p.getByRole("heading", { name: /Pronto para emitir/ }).locator("xpath=..");
        await palco.cameraAberta({ ms: 450 });
        await rolarJanelaAte(palco, lista, { topo: 150 });
        await palco.camera(lista, { zoomMax: 1.75, margem: 30 });
        const itens = lista.locator("li");
        await palco.mover(itens.nth(0).locator("strong"), { ms: 600 });
        await ctx.ate(0.66);
        await palco.mover(itens.nth(3).locator("strong"), { ms: 600 });
        await ctx.ate(0.86);
        await palco.mover(itens.nth(8).locator("strong"), { ms: 700 });
        await ctx.ate(1);
        await dormir(300);
      },
    },
    {
      capitulo: "Certificado digital e CSC",
      fala: "O certificado digital A1 se envia aqui: escolha o arquivo, digite a senha e clique em Enviar certificado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const certificado = p.getByRole("heading", { name: "Certificado digital A1", exact: true }).locator("xpath=..");
        // Sem abrir a câmera: a página desliza por baixo do enquadramento.
        await rolarJanelaAte(palco, certificado, { topo: 50 });
        await palco.camera(certificado, { zoomMax: 1.9, margem: 40, ms: 600 });
        await ctx.ate(0.3);
        await palco.destacar(p.locator("#nfce-certificado"), { folga: 2 });
        await palco.mover(p.locator("#nfce-certificado"), { ms: 550 });
        await ctx.ate(0.56);
        await palco.destacar(p.locator("#nfce-senha-certificado"), { folga: 2 });
        await palco.mover(p.locator("#nfce-senha-certificado"), { ms: 450 });
        await ctx.ate(0.78);
        const enviar = p.getByRole("button", { name: "Enviar certificado" });
        await palco.destacar(enviar, { folga: 5 });
        await palco.mover(enviar, { ms: 450 });
        await ctx.ate(1);
        await dormir(250);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Logo abaixo ficam os campos do CSC, o código gerado no portal da SEFAZ do seu estado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const csc = p.getByRole("heading", { name: /^CSC — Código de Segurança/ }).locator("xpath=..");
        // A página sobe só o bastante para o CSC caber: o que vem depois dele (a
        // numeração, com um texto que cita outra loja pelo nome) fica abaixo da
        // borda da tela. Por isso a régua é o texto da série, não o CSC.
        await rolarJanelaAte(palco, p.locator("#nfce-serie-ajuda"), { topo: 800 });
        await palco.camera(csc, { zoomMax: 1.7, margem: 26, ms: 600 });
        await ctx.ate(0.4);
        await palco.mover(p.locator("#nfce-csc-homologacao"), { ms: 700 });
        await ctx.ate(0.8);
        await palco.mover(p.locator("#nfce-csc-producao"), { ms: 700 });
        await ctx.ate(1);
        await dormir(250);
      },
    },
    {
      capitulo: "Dados da empresa",
      fala: "Em Dados da empresa ficam o CNPJ, a inscrição estadual, a razão social e o regime tributário.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cabecalho = p.locator('button[aria-controls="fiscal-secao-dados"]');
        const dados = p.locator("#fiscal-secao-dados");
        // Corte de cena (não desliza): o que fica entre o CSC e este quadro é a
        // numeração, que não é assunto do vídeo.
        await rolarJanelaAte(palco, cabecalho, { topo: 90, corte: true });
        await palco.camera([cabecalho, dados], { zoomMax: 1.6, margem: 30 });
        await ctx.ate(0.3);
        await palco.mover(p.locator("#fiscal-cnpj"), { ms: 550 });
        await ctx.ate(0.5);
        await palco.mover(p.locator("#fiscal-ie"), { ms: 450 });
        await ctx.ate(0.68);
        await palco.mover(p.locator("#fiscal-razao-social"), { ms: 450 });
        await ctx.ate(0.85);
        await palco.mover(p.locator("#fiscal-regime"), { ms: 450 });
        await ctx.ate(1);
        await dormir(250);
      },
    },
    {
      capitulo: "Automática ou manual",
      fala: "Em Como a nota é emitida, você escolhe. Automática: o FireHub emite sozinho. Manual: nenhuma nota sai sozinha, você emite pelo pedido.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const cabecalho = p.locator('button[aria-controls="fiscal-secao-gerais"]');
        await palco.cameraAberta({ ms: 450 });
        await palco.clicar(cabecalho);
        const escolha = p.getByRole("radiogroup", { name: "Como a nota é emitida" });
        await escolha.waitFor({ state: "visible", timeout: 8000 });
        await rolarJanelaAte(palco, cabecalho, { topo: 70 });
        await palco.camera([cabecalho, escolha], { zoomMax: 1.5, margem: 26 });
        const automatica = escolha.getByRole("radio", { name: /Automática/ });
        const manual = escolha.getByRole("radio", { name: /Manual/ });
        await ctx.ate(0.36);
        await palco.destacar(automatica, { folga: 4 });
        await palco.mover(automatica, { ms: 550 });
        await ctx.ate(0.64);
        await palco.destacar(manual, { folga: 4 });
        await palco.mover(manual, { ms: 550 });
        await ctx.ate(1);
        await dormir(250);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Na automática, marque na tabela em quais formas de pagamento a nota sai.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const secao = p.locator("#fiscal-secao-gerais");
        const titulo = secao.getByText("1. Em quais vendas a nota sai sozinha?");
        const tabela = secao.locator("table");
        await rolarJanelaAte(palco, titulo, { topo: 70 });
        await palco.camera([titulo, tabela], { zoomMax: 1.5, margem: 24, ms: 600 });
        await ctx.ate(0.4);
        await palco.destacar(tabela, { folga: 4 });
        await palco.mover(tabela.getByRole("columnheader", { name: /Vendas da loja/ }), { ms: 600 });
        await ctx.ate(1);
        await dormir(350);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O momento e o CPF",
      fala: "Escolha também o momento em que ela sai: na saída, no aceite ou na conclusão.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const secao = p.locator("#fiscal-secao-gerais");
        const titulo = secao.getByText("2. Em que momento a nota sai?");
        const momentos = p.getByRole("radiogroup", { name: "Momento da emissão" });
        await rolarJanelaAte(palco, titulo, { topo: 110 });
        await palco.camera([titulo, momentos], { zoomMax: 1.6, margem: 26, ms: 600 });
        const opcao = (nome) => momentos.getByRole("radio", { name: new RegExp(`^${nome}`) });
        await ctx.ate(0.5);
        await palco.mover(opcao("Na saída"), { ms: 500 });
        await ctx.ate(0.7);
        await palco.mover(opcao("No aceite"), { ms: 450 });
        await ctx.ate(0.86);
        await palco.mover(opcao("Na conclusão"), { ms: 450 });
        await ctx.ate(1);
        await dormir(250);
      },
    },
    {
      fala: "E o CPF do cliente. No balcão, na retirada e na mesa ele é opcional. Na entrega, a nota só sai com o documento: escolha entre pedir sem obrigar ou tornar obrigatório.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const secao = p.locator("#fiscal-secao-gerais");
        const titulo = secao.getByText("3. O CPF/CNPJ do cliente");
        const cpf = p.getByRole("radiogroup", { name: "CPF na entrega" });
        await rolarJanelaAte(palco, titulo, { topo: 110 });
        await palco.camera([titulo, cpf], { zoomMax: 1.6, margem: 26, ms: 600 });
        await palco.mover(titulo, { ms: 600 });
        const opcao = (n) => cpf.locator("label").nth(n);
        await ctx.ate(0.72);
        await palco.destacar(opcao(0), { folga: 4 });
        await palco.mover(opcao(0).locator("input"), { ms: 500 });
        await ctx.ate(0.88);
        await palco.destacar(opcao(1), { folga: 4 });
        await palco.mover(opcao(1).locator("input"), { ms: 450 });
        await ctx.ate(1);
        await dormir(250);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Para valer, clique em Salvar como a nota é emitida.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const resumo = p.locator('#fiscal-secao-gerais [aria-live="polite"]');
        const salvar = p.getByRole("button", { name: "Salvar como a nota é emitida" });
        await rolarJanelaAte(palco, resumo, { topo: 220 });
        await palco.camera([resumo, salvar], { zoomMax: 1.6, margem: 30, ms: 600 });
        await palco.destacar(salvar, { folga: 5 });
        await palco.mover(salvar, { ms: 600 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Acompanhar as notas",
      fala: "Em Notas fiscais aparecem os pedidos e a situação da nota de cada um. Para a tabela caber inteira, recolha o menu nesta seta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        // Corte de cena de volta ao topo: o menu do módulo fiscal mora lá em cima.
        await palco.pagina.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await dormir(200);
        await palco.clicar(menuFiscal(p, "Notas fiscais"));
        await p.getByText("Status da nota").waitFor({ state: "visible", timeout: 10_000 });
        await ctx.ate(0.62);
        await palco.clicar(p.getByTitle("Recolher menu"));
        await dormir(450);
        const tabela = p.locator(".fiscal-main table");
        await rolarJanelaAte(palco, tabela, { topo: 56 });
        await ctx.ate(1);
      },
    },
    {
      fala: "A coluna Status da nota mostra se ela foi autorizada, se falhou ou se falta o CPF. Na última coluna ficam as ações, como ver o DANFE ou emitir.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const tabela = p.locator(".fiscal-main table");
        const status = (n) => linhaDoPedido(p, n).locator("td").nth(8);
        const acao = (n) => linhaDoPedido(p, n).locator("td").nth(9);
        await palco.camera([tabela.locator("thead tr"), linhaDoPedido(p, 3)], { zoomMax: 1.3, margem: 14 });
        await palco.destacar([tabela.locator("thead th").nth(8), status(3)], { folga: 2 });
        await ctx.ate(0.26);
        await palco.mover(status(5).locator("span").first(), { ms: 600 });
        await ctx.ate(0.4);
        await palco.mover(status(6).locator("span").first(), { ms: 450 });
        await ctx.ate(0.5);
        await palco.mover(status(4).locator("span").first(), { ms: 450 });
        await ctx.ate(0.62);
        await palco.destacar([tabela.locator("thead th").nth(9), acao(3)], { folga: 2 });
        await ctx.ate(0.84);
        await palco.mover(acao(5).getByRole("button", { name: /DANFE/ }), { ms: 600 });
        await ctx.ate(0.95);
        await palco.mover(acao(7).getByRole("button", { name: "Emitir", exact: true }), { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Na entrega sem CPF, o botão é Emitir com CPF: a tela pede o documento do cliente antes de emitir.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(linhaDoPedido(p, 4).getByRole("button", { name: "Emitir com CPF" }));
        const campo = p.locator("#fiscal-emitir-documento");
        await campo.waitFor({ state: "visible", timeout: 8000 });
        const janela = p.getByRole("heading", { name: "Emissão fiscal" }).locator("xpath=../..");
        await palco.camera(janela, { zoomMax: 1.5, margem: 24 });
        await palco.destacar([p.locator('label[for="fiscal-emitir-documento"]'), campo, p.locator("#fiscal-emitir-documento-ajuda")], { folga: 6 });
        await palco.mover(campo, { ms: 700 });
        await ctx.ate(1);
        await dormir(500);
        await palco.apagarDestaque();
        // Fecha sem emitir: com o campo vazio os botões de emitir nem ficam ativos.
        await palco.clicar(janela.getByRole("button", { name: "✕" }));
        await palco.cameraAberta({ ms: 450 });
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso você já sabe onde ligar e onde acompanhar a nota. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
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
