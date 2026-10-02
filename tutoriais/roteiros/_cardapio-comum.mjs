// O que os quatro vídeos da tela de Cardápio dividem: como achar cada pedaço da
// tela, os gestos repetidos (abrir o formulário, limpar um campo) e os dados
// que só os vídeos do cardápio precisam.
import { dormir, BASE } from "../motor/palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";

export const ROTA = "store/cardapio";
export const PRONTA = "text=Cardápio Completo";

// ── onde está cada coisa ───────────────────────────────────────────────────
/**
 * Ancestral mais próximo com este canto arredondado no `style`.
 *
 * O atributo chega escrito de dois jeitos: "border-radius: 12px" quando o
 * React desenhou a linha no navegador e "border-radius:12px" quando ela veio
 * pronta do servidor e só foi hidratada (aconteceu numa gravação, depois de
 * voltar do cardápio do cliente). Tirando os espaços, os dois casam.
 */
const comCanto = (px) => `xpath=ancestor::div[contains(translate(@style,' ',''),'border-radius:${px}px')][1]`;

/** A linha de um produto na lista (foto, nome, canais, preço e botões). */
export const linha = (p, nome) =>
  p.locator("h4").filter({ hasText: new RegExp(`^${nome}$`) }).first()
    .locator(comCanto(12));

/** A caixa inteira de uma categoria (cabeçalho + produtos). */
export const categoria = (p, nome) =>
  p.locator("span").filter({ hasText: new RegExp(`^\\S+ ${nome}$`) }).first()
    .locator(comCanto(16));

/** O cabeçalho da categoria: nome à esquerda, botões à direita. */
export const cabecalho = (p, nome) => categoria(p, nome).locator("xpath=./div[1]");

/** O nome clicável da categoria (emoji, nome, contagem e lápis). */
export const nomeDaCategoria = (p, nome) =>
  p.locator("span").filter({ hasText: new RegExp(`^\\S+ ${nome}$`) }).first().locator("xpath=..");

/** A janela do formulário de produto (é ela que rola). */
export const janela = (p) => p.locator('div[style*="max-height: 90vh"], div[style*="max-height:90vh"]').first();

export const botaoDaLinha = (p, nome, titulo) => linha(p, nome).locator(`button[title="${titulo}"]`);
export const lapis = (p, nome) => botaoDaLinha(p, nome, "Editar produto");
export const pausar = (p, nome) => linha(p, nome).locator('button[title="Pausar vendas"], button[title="Ativar vendas"]');
export const canal = (p, nome, rotulo) => linha(p, nome).locator("button").filter({ hasText: new RegExp(`${rotulo}$`) }).first();

/** Campo do formulário pelo rótulo escrito em cima dele. */
export const campo = {
  nome: (p) => janela(p).getByPlaceholder("Ex: Esfirra de Carne"),
  preco: (p) => janela(p).getByPlaceholder("Ex: 9.90"),
  promo: (p) => janela(p).locator("label").filter({ hasText: "Preço promocional" }).locator("xpath=..").locator("input"),
  faixaDaPromo: (p) => janela(p).locator("label").filter({ hasText: "Preço promocional" }).locator("xpath=.."),
  categoria: (p) => janela(p).locator("select.input-field").first(),
  custo: (p) => janela(p).getByPlaceholder("Ex: 4.50"),
  descricao: (p) => janela(p).locator("textarea"),
  salvar: (p) => janela(p).getByRole("button", { name: /Salvar Alterações|Cadastrar Produto/ }),
  cancelar: (p) => janela(p).getByRole("button", { name: "Cancelar", exact: true }),
};

/** Um bloco do formulário pelo título dele ("Tags do Produto", "Canais de Venda"…). */
export const bloco = (p, titulo) =>
  janela(p).locator("p, h4").filter({ hasText: titulo }).first()
    .locator(comCanto(14));

// ── antes de gravar ────────────────────────────────────────────────────────
/**
 * Espera a tela assentar antes de a gravação começar.
 *
 * Logo depois de abrir, o painel ainda busca as outras telas do menu e o
 * servidor (com o banco recém-semeado) responde devagar: nesse meio-tempo cada
 * passo da seta leva 200 ms em vez de 16, e um gesto de 1 segundo ocupava 9 —
 * a fala acabava e o vídeo ficava mudo esperando o mouse chegar. Aqui a
 * gravação só começa quando a rede sossegou e a seta voltou a responder rápido.
 */
export async function assentar(palco) {
  const p = palco.pagina;
  moverNoTempo(palco);
  rolagemFirme(palco);
  let ultimo = Date.now();
  const marcar = () => { ultimo = Date.now(); };
  p.on("request", marcar);
  const limite = Date.now() + 45_000;
  try {
    // 1. rede quieta: 2,5 s sem pedido novo (as consultas periódicas do painel
    //    são espaçadas; o que se espera aqui é a rajada da abertura acabar)
    while (Date.now() < limite && Date.now() - ultimo < 2500) await dormir(250);
    // 2. a seta responde rápido: dez passos no mesmo lugar, na média abaixo de 30 ms
    while (Date.now() < limite) {
      const t0 = Date.now();
      for (let i = 0; i < 10; i++) await p.mouse.move(palco.x + (i % 2), palco.y);
      if ((Date.now() - t0) / 10 < 30) break;
      await dormir(1000);
    }
  } finally {
    p.off("request", marcar);
  }
  await p.mouse.move(palco.x, palco.y);
  await dormir(300);
}

/**
 * A seta leva o TEMPO pedido, não um número fixo de passos.
 *
 * O `mover` do palco dá um passo a cada 16 ms e espera o navegador confirmar
 * cada um. Com a máquina ocupada (outra gravação montando ao lado), cada passo
 * custa até 200 ms e um gesto de 0,7 s durava 9 s: a fala acabava e o vídeo
 * ficava mudo. Aqui a posição sai do relógio — com a máquina livre o movimento
 * é o mesmo; carregada, a seta dá menos passos mas chega na hora.
 */
function moverNoTempo(palco) {
  const suave = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  palco.mover = async function (alvo, { ms } = {}) {
    const destino = await this.centroDe(alvo);
    const distancia = Math.hypot(destino.x - this.x, destino.y - this.y);
    const duracao = ms ?? Math.min(1100, Math.max(380, distancia * 1.5));
    const de = { x: this.x, y: this.y };
    const inicio = Date.now();
    for (;;) {
      const k = (Date.now() - inicio) / duracao;
      if (k >= 1) break;
      await this.pagina.mouse.move(de.x + (destino.x - de.x) * suave(k), de.y + (destino.y - de.y) * suave(k));
      await dormir(16);
    }
    await this.pagina.mouse.move(destino.x, destino.y);
    this.x = destino.x;
    this.y = destino.y;
  };
}

/**
 * A rolagem só "terminou" quando a tela parou de se mexer.
 *
 * O palco rola suave e espera 750 ms. Com a máquina ocupada a rolagem leva
 * mais que isso, e o gesto seguinte media a posição do alvo NO MEIO do
 * caminho: numa gravação o destaque da categoria nova ficou parado em cima de
 * outro produto. Aqui, depois de cada rolagem, espera-se a posição repetir.
 */
function rolagemFirme(palco) {
  const parar = async (ler) => {
    let antes = null;
    for (let i = 0; i < 30; i++) {
      const agora = await ler();
      if (agora !== null && agora === antes) return;
      antes = agora;
      await dormir(120);
    }
  };
  const rolarPagina = palco.rolarPagina.bind(palco);
  const rolarAte = palco.rolarAte.bind(palco);
  palco.rolarPagina = async (y) => {
    await rolarPagina(y);
    await parar(() => palco.pagina.evaluate(() => String(Math.round(window.scrollY))));
  };
  palco.rolarAte = async (alvo, opcoes) => {
    await rolarAte(alvo, opcoes);
    await parar(async () => { const c = await alvo.boundingBox(); return c ? `${Math.round(c.x)},${Math.round(c.y)}` : null; });
  };
}

// ── gestos ─────────────────────────────────────────────────────────────────
/** Abre o formulário de um produto pelo lápis e espera a janela. */
export async function abrirEdicao(palco, nome) {
  const p = palco.pagina;
  await palco.clicar(lapis(p, nome));
  await janela(p).waitFor({ state: "visible", timeout: 8000 });
  await dormir(350);
}

/** Espera o formulário fechar e a lista recarregar. */
export async function esperarFechar(palco) {
  await janela(palco.pagina).waitFor({ state: "hidden", timeout: 15_000 });
  await dormir(500);
}

/**
 * Fecha o formulário sem mostrar o clique em Cancelar (que fica no fim da
 * janela e pediria rolagem): a fala já acabou, e o vídeo segue para a lista.
 */
export async function fecharSemClicar(palco) {
  await campo.cancelar(palco.pagina).evaluate((el) => el.click());
  await esperarFechar(palco);
}

/** Leva a página até a altura pedida, só se ela não estiver lá (a tela volta ao topo quando o formulário fecha). */
export async function rolarSePreciso(palco, y) {
  const atual = await palco.pagina.evaluate(() => window.scrollY);
  if (Math.abs(atual - y) > 4) await palco.rolarPagina(y);
}

/** Rola a página até o alvo ficar na altura `y` da tela. */
export async function rolarPaginaAte(palco, alvo, y = 200) {
  const c = await alvo.boundingBox();
  if (!c) throw new Error("Elemento para rolar a página não está na tela — a tela mudou?");
  const atual = await palco.pagina.evaluate(() => window.scrollY);
  if (Math.abs(c.y - y) > 4) await palco.rolarPagina(Math.max(0, atual + c.y - y));
}

/** Clica no campo, apaga o que tem e digita o texto novo, letra por letra. */
export async function redigitar(palco, alvo, texto) {
  await palco.clicar(alvo);
  await palco.pagina.keyboard.press("Control+A");
  await dormir(120);
  if (texto === "") {
    await palco.pagina.keyboard.press("Delete");
  } else {
    await palco.pagina.keyboard.type(texto, { delay: 95 });
  }
  await dormir(300);
}

/** Um retângulo solto, para destacar um pedaço da tela que não é um elemento só. */
export const caixa = (x, y, width, height) => ({ boundingBox: async () => ({ x, y, width, height }) });

/**
 * Abre o cardápio que o cliente vê, pelo caminho da tela: Ver cardápio › Abrir
 * o cardápio. O link abre em outra aba; como a gravação segue nesta, a aba
 * nova é fechada e o mesmo endereço é aberto aqui. `prova` é um elemento do
 * cardápio do cliente que tem de aparecer.
 */
export async function abrirCardapioDoCliente(palco, prova, { destaque = true } = {}) {
  const p = palco.pagina;
  await rolarSePreciso(palco, 0);
  const ver = p.getByRole("button", { name: /Ver cardápio/ }).first();
  await palco.clicar(ver);
  const abrir = p.getByText("Abrir o cardápio");
  await abrir.waitFor({ state: "visible", timeout: 8000 });
  if (destaque) {
    await palco.destacar(abrir, { folga: 8 });
    await dormir(500);
    await palco.apagarDestaque();
  }
  p.context().once("page", (nova) => nova.close().catch(() => {}));
  await palco.clicar(abrir);
  await p.goto(`${BASE}/loja/${LOJA.slug}`, { waitUntil: "load" });
  await prova(p).waitFor({ state: "visible", timeout: 30_000 });
  await dormir(300);
}

/**
 * A tela já responde a clique? O HTML chega pronto do servidor e só depois o
 * React assume os botões; numa gravação a tela ficou nesse meio-termo e o
 * clique seguinte caiu no vazio. A prova é o próprio React: ele pendura uma
 * propriedade `__reactProps…` em cada botão que já assumiu.
 */
const telaViva = (p, ms) => p.waitForFunction(() => {
  const botao = [...document.querySelectorAll("button")].find((b) => /Novo Item/.test(b.textContent || ""));
  return !!botao && Object.keys(botao).some((k) => k.startsWith("__reactProps"));
}, null, { timeout: ms }).then(() => true, () => false);

/** Volta do cardápio do cliente para a tela de Cardápio do painel. */
export async function voltarAoPainel(palco) {
  const p = palco.pagina;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    await p.goto(`${BASE}/${ROTA}`, { waitUntil: "load" });
    await p.locator(PRONTA).first().waitFor({ state: "visible", timeout: 30_000 });
    if (await telaViva(p, 12_000)) break;
  }
  await dormir(800);
}

/** A última cena de todo vídeo do cardápio: o botão Tutorial, no topo. */
export const cenaFinal = (fala) => ({
  capitulo: "Para rever este vídeo",
  fala,
  acao: async (palco, ctx) => {
    const p = palco.pagina;
    await palco.rolarPagina(0);
    const botao = p.getByRole("button", { name: /^Tutorial/ });
    // A fala começa por "clicar em Tutorial, aqui no topo": o destaque tem de cair nessa hora.
    await ctx.ate(0.06);
    await palco.camera([botao, { x: 560, y: 0, width: 520, height: 150 }], { zoomMax: 1.7, margem: 30 });
    await palco.destacar(botao, { folga: 6 });
    await palco.mover(botao, { ms: 900 });
    await ctx.ate(1);
    await dormir(700);
    await palco.apagarDestaque();
    await palco.cameraAberta();
  },
  pausa: 600,
});

// ── dados ──────────────────────────────────────────────────────────────────
/**
 * Um combo de lanche (bebida obrigatória + adicionais opcionais) e uma pizza
 * de dois sabores que cobra o sabor mais caro. As opções nascem carimbadas
 * `apenasEmCombo`, como as que a tela cria em "Cadastrar item novo".
 */
export async function semearCombos(prisma, { loja, produtos }) {
  const L = loja.id;
  const opcao = (name, description) => prisma.menuProduct.create({
    data: { franchiseeId: L, name, description: description || name, price: 0, category: "Adicionais", apenasEmCombo: true },
  });
  const bacon = await opcao("Bacon extra");
  const cheddar = await opcao("Cheddar");
  const ovo = await opcao("Ovo");
  const sabores = [];
  for (const [nome, desc] of [
    ["Calabresa", "Calabresa fatiada e cebola"],
    ["Marguerita", "Tomate, manjericão e mussarela"],
    ["Portuguesa", "Presunto, ovo, cebola e azeitona"],
    ["Frango com Catupiry", "Frango desfiado e catupiry"],
  ]) sabores.push(await opcao(nome, desc));
  const precoDoSabor = { Calabresa: 54, Marguerita: 52, Portuguesa: 60, "Frango com Catupiry": 58 };

  const combo = await prisma.menuProduct.create({
    data: {
      franchiseeId: L, name: "Combo X-Bacon", description: "X-Bacon, batata frita e bebida", price: 42,
      category: "Lanches", sortOrder: -1, isCombo: true,
      comboGroups: { create: [
        { title: "Escolha a bebida", minQty: 1, maxQty: 1, sortOrder: 0, items: { create: [
          { menuProductId: produtos["Coca-Cola lata"].id, additionalPrice: 0, sortOrder: 0 },
          { menuProductId: produtos["Guaraná 2 L"].id, additionalPrice: 5, sortOrder: 1 },
        ] } },
        { title: "Deseja adicionais?", minQty: 0, maxQty: 3, sortOrder: 1, items: { create: [
          { menuProductId: bacon.id, additionalPrice: 4, sortOrder: 0 },
          { menuProductId: cheddar.id, additionalPrice: 3, sortOrder: 1 },
          { menuProductId: ovo.id, additionalPrice: 2, sortOrder: 2 },
        ] } },
      ] },
    },
  });

  const pizza = await prisma.menuProduct.create({
    data: {
      franchiseeId: L, name: "Pizza Grande 2 Sabores", description: "8 fatias, até dois sabores", price: 0,
      category: "Pizzas", sortOrder: -1, isCombo: true,
      comboGroups: { create: [
        { title: "Escolha até 2 sabores", minQty: 1, maxQty: 2, priceRule: "MAIOR", sortOrder: 0, items: { create:
          sabores.map((s, i) => ({ menuProductId: s.id, additionalPrice: precoDoSabor[s.name], sortOrder: i })),
        } },
      ] },
    },
  });
  return { combo, pizza };
}
