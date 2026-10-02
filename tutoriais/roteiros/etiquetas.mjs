// Tutorial da tela de Validade & etiquetas (/store/etiquetas).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que a tela faz: cadastra o "item de cozinha" (o que a loja prepara e
// guarda), monta a etiqueta de validade dele com prévia fiel e manda imprimir
// pela janela de impressão do navegador. Cada impressão grava um LOTE com um
// QR; o estoque só se mexe quando alguém escaneia o QR (rota /e/<código>).
// O acompanhamento dos vencimentos NÃO mora aqui: é a aba "Lotes & Validade"
// da tela de Estoque, e por isso o vídeo vai até lá e volta.
//
// O que o vídeo NÃO faz, de propósito: clicar em "Imprimir". O botão grava o
// lote e chama a impressão do navegador — a janela de impressão não aparece na
// captura e nada pode ser impresso de verdade. A seta só aponta o botão.
import { dormir } from "../motor/palco.mjs";

/** Dia de calendário (meia-noite UTC, como a etiqueta grava) a `d` dias de hoje em São Paulo — é o "hoje" do servidor. */
function dia(d = 0) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const data = new Date(`${hoje}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + d);
  return data;
}

const abas = (p) => p.getByRole("tablist");
const aba = (p, nome) => p.getByRole("tab", { name: nome });
const aviso = (p) => p.locator(".fh-aviso--ok").first();
const papel = (p) => p.locator(".print-area .label-page").first();
const menu = (p, rota) => p.locator(`nav.fh-menu-lista a[href="/store/${rota}"]`);
/** A linha de um interruptor da aba "O que sai no papel". */
/** A bolinha "WhatsApp da loja", que o lojista pode arrastar para tirar da frente (lib/useArrastavel.ts). */
const botaoDoWhatsApp = (p) => p.getByText("WhatsApp da loja", { exact: true }).locator("xpath=..").locator("button").last();
const bloco = (p, titulo) => p.locator("label.fh-linha-bloco").filter({ hasText: titulo });

/** Rola a página até o alvo ficar a `topo` pontos do alto da tela. */
async function rolarPara(palco, alvo, topo = 60) {
  const y = await alvo.evaluate((el, t) => Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY - t)), topo);
  await palco.rolarPagina(y);
}

/**
 * Na aba "Lotes & Validade" do Estoque: rola a página até a tabela. Se o rótulo flutuante
 * "WhatsApp da loja" estiver por cima da coluna Situação (o canto de sempre dele), a página para
 * no ponto em que o selo "Aguardando entrada" cai logo abaixo do rótulo, com o da linha de cima
 * logo acima. Se a bolinha foi arrastada para outro canto, basta mostrar a tabela inteira.
 */
async function enquadrarLotes(palco) {
  const p = palco.pagina;
  const aguardando = p.locator(".items-table tbody .fh-chip").filter({ hasText: "Aguardando entrada" }).first();
  const rotulo = await p.getByText("WhatsApp da loja", { exact: true }).first().boundingBox();
  const selo = await aguardando.boundingBox();
  const porCima = rotulo && selo && rotulo.x < selo.x + selo.width && rotulo.x + rotulo.width > selo.x;
  if (porCima) await rolarPara(palco, aguardando, rotulo.y + rotulo.height + 5);
  else await rolarPara(palco, p.locator(".tabs-container"), 70);
}

/** Troca o que está escrito num campo: clica, seleciona tudo e digita por cima. */
async function digitarPorCima(palco, alvo, texto) {
  await palco.clicar(alvo);
  await palco.pagina.keyboard.press("Control+A");
  await palco.pagina.keyboard.type(texto, { delay: 110 });
  await dormir(300);
}

export default {
  id: "etiquetas",
  titulo: "Validade e etiquetas",
  rota: "store/etiquetas",
  prontaQuando: "text=Etiquetas de validade",

  /**
   * A cozinha já etiquetou coisa antes deste vídeo: três itens cadastrados e
   * cinco lotes (um vencido, dois vencendo, um em dia e um ainda aguardando
   * entrada), que é o que a aba "Lotes & Validade" do Estoque mostra no fim.
   * O item do vídeo (Molho de tomate) nasce durante a gravação.
   *
   * Os dias dos lotes ficam a 2 dias ou mais de hoje, de propósito: o contador
   * da aba compara INSTANTES (validade à meia-noite UTC contra agora) e o texto
   * compara DIAS em São Paulo; "vence hoje" e "vence amanhã" podem cair de um
   * lado no texto e do outro no contador, conforme a hora da gravação.
   */
  async preparar(prisma, { loja, haMin }) {
    const L = loja.id;
    await prisma.user.update({
      where: { id: L },
      data: {
        // O rodapé da etiqueta leva o CNPJ da loja (este é o CNPJ de exemplo dos manuais, não é de ninguém).
        cpfCnpj: "11.222.333/0001-81",
        // A loja já escolheu o que sai no papel: sem logo (não enviou nenhuma), sem modo de preparo,
        // sem alérgicos e sem tabela nutricional. Sem isso a prévia abre com quatro avisos amarelos
        // de "não vai sair", que não são o assunto do vídeo.
        labelFieldsConfig: { versao: 1, campos: { modoPreparo: false, tabelaNutricional: false, alergicos: false, logo: false }, textos: {}, produtos: {} },
      },
    });

    const insumo = (name, unit, quantity, minQuantity) =>
      prisma.stockItem.create({ data: { franchiseeId: L, name, unit, quantity, minQuantity } });
    const massa = await insumo("Massa de pizza", "un", 24, 10);
    const carne = await insumo("Hambúrguer moldado", "un", 34, 20);
    const molho = await insumo("Molho de tomate", "kg", 2, 1);
    const queijo = await insumo("Muçarela fatiada", "kg", 3, 1);

    const item = (name, shelfLifeDays, weightStr, stock) => prisma.kitchenItem.create({
      data: { franchiseeId: L, name, shelfLifeDays, weightStr, labelSize: "cozinha", stockItemId: stock.id },
    });
    const kMassa = await item("Massa de pizza", 3, "12 un", massa);
    const kCarne = await item("Hambúrguer moldado", 2, "10 un", carne);
    const kQueijo = await item("Muçarela fatiada", 5, "1 kg", queijo);

    const lote = (code, kitchen, stock, unit, inicial, restante, fabricado, vence, recebido) => prisma.stockLot.create({
      data: {
        code, franchiseeId: L, kitchenItemId: kitchen?.id || null, stockItemId: stock.id, productName: stock.name,
        fabricadoEm: dia(fabricado), validoAte: dia(vence), weightStr: `${inicial} ${unit}`, unit,
        quantidadeInicial: inicial, quantidadeRestante: restante, origem: "ETIQUETA", criadoPor: L,
        recebidoPorId: recebido ? L : null, recebidoEm: recebido ? haMin(recebido) : null, createdAt: haMin(recebido || 30),
      },
    });
    const lCarne = await lote("K7F2M9QX", kCarne, carne, "un", 10, 4, -4, -2, 4 * 1440);
    const lQueijo = await lote("B3WT8HNC", kQueijo, queijo, "kg", 1, 1, -3, 2, 3 * 1440);
    const lMassa = await lote("R6DZ4PGA", kMassa, massa, "un", 12, 12, 0, 3, 240);
    await lote("M9XK2VJE", kMassa, massa, "un", 12, 12, 1, 4, 0); // impressa e ainda não escaneada
    const lMolho = await lote("H4QS7YTB", null, molho, "kg", 2, 2, -1, 9, 1440);

    const mov = (l, stock, type, quantity, notes, minutos) => prisma.stockTransaction.create({
      data: { stockItemId: stock.id, franchiseeId: L, stockLotId: l.id, type, quantity, notes, createdAt: haMin(minutos) },
    });
    await mov(lCarne, carne, "INPUT", 10, "Entrada por etiqueta K7F2M9QX", 4 * 1440);
    await mov(lCarne, carne, "OUTPUT", -6, "Baixa por etiqueta K7F2M9QX", 3 * 1440);
    await mov(lQueijo, queijo, "INPUT", 1, "Entrada por etiqueta B3WT8HNC", 3 * 1440);
    await mov(lMassa, massa, "INPUT", 12, "Entrada por etiqueta R6DZ4PGA", 240);
    await mov(lMolho, molho, "INPUT", 2, "Entrada por etiqueta H4QS7YTB", 1440);
  },

  /**
   * O botão flutuante de ajuda e o ícone do quadro "Estoque Negativo" pulsam
   * sem parar e fariam a captura pintar quadros à toa: só o pulso para. E o
   * painel adianta (prefetch) as telas do menu quando o menu rola; no banco de
   * brinquedo da gravação essa leva segura o servidor por segundos, então só o
   * adiantamento é dispensado — a navegação de verdade continua igual.
   */
  async antesDeGravar(palco) {
    await palco.pagina.addStyleTag({ content: ".fcw-fab-pulse,.kpi-icon-wrapper.pulse{animation:none !important}" });
    await palco.pagina.route((url) => url.searchParams.has("_rsc"), (rota) => {
      if (rota.request().headers()["next-router-prefetch"]) return rota.abort();
      return rota.continue();
    });
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Esta é a tela de Validade e etiquetas. Aqui você monta e imprime a etiqueta de validade do que a cozinha prepara e guarda, como massas, molhos e carnes.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(700);
        await palco.mover(p.getByRole("heading", { name: "Etiquetas de validade" }), { ms: 900 });
        await ctx.ate(0.4);
        await palco.destacar(p.locator("header.fh-cabecalho"), { folga: 4 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Cadastrar um item",
      fala: "Para cadastrar um item, clique em Novo item, escreva o nome e clique em Salvar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(p.getByRole("button", { name: "Novo item" }), { ms: 600 });
        const titulo = p.getByRole("heading", { name: "Adicionar Novo Item de Cozinha" });
        await titulo.waitFor({ state: "visible", timeout: 8000 });
        const caixa = titulo.locator("xpath=..");
        await palco.camera(caixa, { zoomMax: 1.5, margem: 60, ms: 500 });
        await palco.digitar(p.getByPlaceholder("Ex: Massa de Esfirra"), "Molho de tomate");
        await ctx.ate(0.8);
        await palco.clicar(caixa.getByRole("button", { name: "Salvar", exact: true }), { ms: 450 });
        await palco.cameraAberta({ ms: 400 });
        await p.getByText("Validade em Dias (Shelf Life)").waitFor({ state: "visible", timeout: 15_000 });
        await ctx.ate(1);
      },
    },
    {
      capitulo: "A ficha do produto",
      fala: "O item abre na aba Ficha do produto. Em Validade em Dias, coloque quantos dias ele dura depois de pronto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPara(palco, abas(p), 40);
        const fichaDoProduto = aba(p, /Ficha do produto/);
        await palco.destacar(fichaDoProduto, { folga: 4 });
        await palco.mover(fichaDoProduto, { ms: 600 });
        await ctx.ate(0.35);
        await palco.apagarDestaque();
        const rotulo = p.getByText("Validade em Dias (Shelf Life)");
        const campo = rotulo.locator("xpath=following-sibling::input");
        await palco.camera([rotulo, campo, p.getByLabel("Unidade")], { zoomMax: 1.6, margem: 60, ms: 500 });
        await ctx.ate(0.55);
        await digitarPorCima(palco, campo, "5");
        await ctx.ate(1);
      },
    },
    {
      fala: "No campo Quanto vem na embalagem, informe o número e a unidade. É essa a quantidade que entra no estoque a cada etiqueta.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.digitar(p.getByLabel("Quantidade", { exact: true }), "2");
        const unidade = p.getByLabel("Unidade", { exact: true });
        await palco.apontar(unidade);
        await unidade.selectOption("kg");
        const dica = p.getByText(/Cada etiqueta vai dar entrada de/);
        await dica.waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.55);
        await palco.destacar(dica, { folga: 5 });
        await palco.mover(dica, { ms: 500 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Se quiser os ingredientes na etiqueta, escreva aqui. Depois clique em Salvar ficha do produto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const ingredientes = p.getByText("Ingredientes", { exact: true }).locator("xpath=following-sibling::textarea");
        await palco.cameraAberta({ ms: 400 });
        await palco.digitar(ingredientes, "Tomate, cebola, alho, azeite e sal.");
        const salvar = p.getByRole("button", { name: /Salvar ficha do produto/ });
        await rolarPara(palco, salvar, 600);
        await ctx.ate(0.75);
        await palco.clicar(salvar, { ms: 500 });
        await aviso(p).waitFor({ state: "visible", timeout: 15_000 });
        await rolarPara(palco, abas(p), 40);
        await palco.destacar(aviso(p), { folga: 4 });
        await ctx.ate(1);
        await dormir(700);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O que sai no papel",
      fala: "Na aba O que sai no papel, diga para que serve a etiqueta. Em Uso interno da cozinha, só o nome e as datas são obrigatórios.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(aba(p, /O que sai no papel/), { ms: 600 });
        const interno = p.getByRole("button", { name: /Uso interno da cozinha/ });
        await interno.waitFor({ state: "visible", timeout: 8000 });
        await rolarPara(palco, abas(p), 40);
        await ctx.ate(0.3);
        await palco.destacar([interno, p.getByRole("button", { name: /Fornecimento para outra loja/ })], { folga: 6 });
        await palco.mover(interno, { ms: 600 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.clicar(interno, { ms: 200 });
        await p.getByText(/formato de uso interno/).waitFor({ state: "visible", timeout: 15_000 });
        await palco.destacar(interno, { folga: 4 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "O resto você liga ou desliga, e a prévia ao lado muda na hora.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const conservar = bloco(p, "Como conservar");
        await rolarPara(palco, conservar, 300);
        await palco.destacar(conservar, { folga: 2 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.clicar(conservar.locator(".fh-sw"), { ms: 500 });
        await conservar.getByText("NÃO SAI").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(0.65);
        await palco.mover(papel(p).getByText("Molho de tomate", { exact: false }).first(), { ms: 800 });
        await ctx.ate(1);
        await dormir(600);
      },
    },
    {
      capitulo: "As datas",
      fala: "Na aba Imprimir, informe a data de fabricação. A data de validade se preenche sozinha, pelo prazo da ficha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await rolarPara(palco, abas(p), 40);
        await palco.clicar(aba(p, /Imprimir/), { ms: 600 });
        const fabricacao = p.locator('input[type="date"]').nth(0);
        const validade = p.locator('input[type="date"]').nth(1);
        await fabricacao.waitFor({ state: "visible", timeout: 8000 });
        await rolarPara(palco, fabricacao, 78);
        await ctx.ate(0.3);
        await palco.destacar(fabricacao, { folga: 5 });
        await palco.apontar(fabricacao);
        // hoje no relógio da gravação (o do navegador), como quem etiqueta o que acabou de preparar
        const hoje = await p.evaluate(() => new Intl.DateTimeFormat("en-CA").format(new Date()));
        await fabricacao.fill(hoje);
        await ctx.ate(0.6);
        await palco.destacar(validade, { folga: 5 });
        await palco.mover(validade, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Quantas etiquetas",
      fala: "Escolha quantas etiquetas vão sair. Com mais de uma, você decide se todas levam o mesmo código ou se cada uma leva o seu.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const mais = p.getByRole("button", { name: "+", exact: true });
        await palco.clicar(mais, { ms: 600 });
        await palco.clicar(mais, { ms: 200 });
        const fornada = p.getByRole("button", { name: /Um código para a fornada/ });
        const porEtiqueta = p.getByRole("button", { name: /Um por etiqueta/ });
        await fornada.waitFor({ state: "visible", timeout: 8000 });
        // a Numeração abriu e empurrou o resto para baixo: sobe a página até o fim dela
        await rolarPara(palco, p.getByText(/deixe a margem em/), 680);
        await palco.camera([p.getByText("Quantas etiquetas"), mais, fornada, porEtiqueta], { zoomMax: 1.6, margem: 50, ms: 500 });
        await ctx.ate(0.45);
        await palco.destacar([fornada, porEtiqueta], { folga: 6 });
        await ctx.ate(0.6);
        await palco.mover(fornada, { ms: 500 });
        await ctx.ate(0.82);
        await palco.mover(porEtiqueta, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "A prévia",
      fala: "A bolinha do WhatsApp está na frente da prévia da etiqueta: é só arrastar a bolinha para outro canto.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const bolinha = botaoDoWhatsApp(p);
        await palco.mover(bolinha, { ms: 800 });
        await ctx.ate(0.5);
        // Para baixo e para a esquerda, no vão entre as duas colunas: a bolinha fica abaixo do papel e o
        // rótulo dela sai de cima do rodapé da etiqueta. (Na tela de Estoque, mais adiante, esse canto cai
        // entre as colunas Saldo e Situação da tabela, sem tampar nada.)
        await palco.arrastar(bolinha, { x: 1000, y: 742 });
        await ctx.ate(1);
      },
    },
    {
      fala: "A prévia mostra a etiqueta do jeito que ela sai na impressora, com as datas e o QR code.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const folha = papel(p);
        await palco.camera(folha, { zoomMax: 1.25, margem: 24 });
        await palco.mover(folha.getByText("Molho de tomate", { exact: false }).first(), { ms: 700 });
        await ctx.ate(0.5);
        const fab = folha.getByText(/Fab:/).first();
        const caixa = await folha.boundingBox();
        const linha = await fab.boundingBox();
        // a parte de baixo do papel: datas, QR e os dados da loja
        await palco.camera({ x: caixa.x, y: linha.y - 30, width: caixa.width, height: caixa.y + caixa.height - linha.y + 30 }, { zoomMax: 2, margem: 30, ms: 700 });
        await palco.mover(fab, { ms: 500 });
        await ctx.ate(0.85);
        await palco.mover(folha.locator("img").last(), { ms: 500 });
        await ctx.ate(1);
        await dormir(500);
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Imprimir",
      fala: "Para imprimir, é neste botão. O navegador abre a janela de impressão, e a margem deve ficar em Nenhuma, como avisa o texto aqui embaixo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /^Imprimir \d+ etiquetas$/ });
        const margem = p.getByText(/deixe a margem em/);
        await palco.camera([botao, margem], { zoomMax: 1.6, margem: 60, ms: 500 });
        await palco.destacar(botao, { folga: 5 });
        await palco.mover(botao, { ms: 600 });
        await ctx.ate(0.55);
        await palco.destacar(margem, { folga: 5 });
        await palco.mover(margem, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Imprimir não mexe no estoque. O produto só entra quando alguém aponta a câmera do celular para o QR da etiqueta e confirma a entrada.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const nota = p.locator(".fh-aviso--info").filter({ hasText: "Ao escanear o QR" });
        await palco.camera([nota, p.getByRole("button", { name: /^Imprimir \d+ etiquetas$/ })], { zoomMax: 1.6, margem: 50, ms: 500 });
        await ctx.ate(0.3);
        await palco.destacar(nota, { folga: 4 });
        await palco.mover(nota, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Acompanhar os vencimentos",
      fala: "Para acompanhar os vencimentos, abra o Estoque, aqui no menu, e clique na aba Lotes e Validade.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const estoque = menu(p, "estoque");
        await palco.rolarAte(estoque, { bloco: "center" });
        await ctx.ate(0.3);
        await palco.clicar(estoque, { ms: 600 });
        await p.getByRole("heading", { name: "Controle de estoque" }).waitFor({ state: "visible", timeout: 30_000 });
        const lotes = p.locator(".tab-link").filter({ hasText: "Lotes" });
        await lotes.waitFor({ state: "visible", timeout: 30_000 });
        await ctx.ate(0.7);
        await palco.clicar(lotes, { ms: 600 });
        await p.locator(".items-table tbody tr").first().waitFor({ state: "visible", timeout: 15_000 });
        await enquadrarLotes(palco);
        await ctx.ate(1);
      },
    },
    {
      fala: "As etiquetas impressas aparecem aqui como lotes, com a validade, o saldo e a situação. Aguardando entrada é a etiqueta que ainda não foi escaneada.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const tabela = p.locator(".items-table");
        const cabeca = (texto) => tabela.locator("th").filter({ hasText: texto });
        const aguardando = tabela.locator("tbody .fh-chip").filter({ hasText: "Aguardando entrada" }).first();
        // A bolinha, que veio junto da outra tela, caiu em cima da última linha da tabela: vai para o
        // vão vazio à direita dos filtros (o mesmo gesto que a cena da prévia ensinou).
        const filtro = await p.getByRole("button", { name: /^Vencidos \(/ }).boundingBox();
        await palco.arrastar(botaoDoWhatsApp(p), { x: 1312, y: filtro.y + filtro.height / 2 });
        await palco.camera(tabela, { zoomMax: 1.25, margem: 30 });
        await ctx.ate(0.3);
        await palco.mover(cabeca("Validade"), { ms: 500 });
        await ctx.ate(0.42);
        await palco.mover(cabeca("Saldo do lote"), { ms: 450 });
        await ctx.ate(0.52);
        await palco.mover(cabeca("Situação"), { ms: 450 });
        await ctx.ate(0.66);
        await palco.destacar(aguardando, { folga: 6 });
        await palco.mover(aguardando, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "Os filtros Vencendo e Vencidos mostram só o que precisa de atenção.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const vencendo = p.getByRole("button", { name: /^Vencendo \(/ });
        const vencidos = p.getByRole("button", { name: /^Vencidos \(/ });
        const tabela = p.locator(".items-table");
        await palco.clicar(vencendo, { ms: 600 });
        await p.getByText("Vence em 2 dias").waitFor({ state: "visible", timeout: 15_000 });
        await dormir(300);
        // Com menos linhas a página encurta e a tabela desce para baixo do aviso flutuante: a câmera
        // fica nos filtros e nas colunas do produto ao saldo, que é o que a fala mostra.
        const enquadrar = async () => palco.camera(
          [p.getByRole("button", { name: "Todos", exact: true }), vencidos, tabela.locator("th").filter({ hasText: "Validade" }), tabela.locator("tbody tr").last().locator("td").first()],
          { zoomMax: 1.5, margem: 40, ms: 500 },
        );
        await enquadrar();
        await palco.mover(tabela.getByText("Vence em 2 dias"), { ms: 500 });
        await ctx.ate(0.6);
        await palco.clicar(vencidos, { ms: 400 });
        await p.getByText(/Venceu há/).waitFor({ state: "visible", timeout: 15_000 });
        await palco.mover(tabela.getByText(/Venceu há/), { ms: 500 });
        await ctx.ate(1);
        await dormir(800);
        await palco.cameraAberta({ ms: 400 });
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso a validade da cozinha fica sob controle. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        // de volta à tela das etiquetas, pelo menu: é nela que o botão Tutorial abre este vídeo
        await palco.clicar(menu(p, "etiquetas"), { ms: 600 });
        await p.getByRole("heading", { name: "Etiquetas de validade" }).waitFor({ state: "visible", timeout: 30_000 });
        await palco.rolarPagina(0);
        const botao = p.getByRole("button", { name: /^Tutorial/ });
        // A câmera fecha no alto da tela: o botão fica maior, e a bolinha arrastada (que ficou na
        // borda direita, por cima do campo de escolher o insumo) sai do quadro.
        await palco.camera({ x: 350, y: 0, width: 760, height: 427 }, { zoomMax: 1.8, margem: 0, ms: 600 });
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
