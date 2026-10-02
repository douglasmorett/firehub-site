// Tutorial de Minha loja › Equipe e permissões (/store/minha-loja#equipe).
//
// Regra de todo roteiro: a fala só afirma o que a tela faz DE VERDADE nesta
// gravação. Se a frase descreve um clique, o clique acontece na imagem.
//
// O que foi conferido no código antes de escrever:
// - o cadastro grava um usuário STAFF ligado ao dono, com a lista de caixinhas
//   (api/store/team); no formulário novo todas vêm marcadas, menos "Editar
//   pedidos já lançados" (MODULOS_PADRAO, em StoreTeamManager);
// - a permissão é POR TELA: lib/permissao-da-tela.ts diz qual caixinha abre
//   cada rota. "Relatórios Financeiros" abre Financeiro, Relatórios, Fiscal e
//   Fiado; "Configurações da Loja" abre Minha loja, Marketing, Chatbot e
//   Garçons. Rota que não está na lista não abre para funcionário: tela nova
//   nasce fechada;
// - o menu do funcionário só mostra o que ele abre (menuDaLoja) e o proxy
//   manda de volta para a primeira tela liberada quem abre outra;
// - o proxy relê a permissão do banco com 15 s de memória: bloqueio novo vale
//   em segundos, sem o funcionário sair e entrar;
// - e-mail que já tem conta é recusado no cadastro (api/store/team, POST);
// - a lixeira pede confirmação (confirm do navegador) e apaga o acesso.
//
// Fora da câmera, de propósito:
// - o menu do funcionário: a gravação não troca de usuário, só afirma o que o
//   código garante;
// - o clique na lixeira: a confirmação é uma janela do navegador, que não
//   aparece na captura. O vídeo só aponta o botão.
import bcrypt from "bcryptjs";
import { dormir } from "../motor/palco.mjs";

const menuMinhaLoja = (p) => p.locator('nav.fh-menu-lista a.fh-menu-item[href="/store/minha-loja"]');
const menuEquipe = (p) => p.locator('nav.fh-menu-lista a.fh-menu-filho[href="/store/minha-loja#equipe"]');
const formulario = (p) => p.locator("form");
/** A grade das caixinhas, no formulário de funcionário novo. */
const grade = (p) => formulario(p).locator("xpath=.//div[contains(@style,'minmax(260px')]");
/** Uma caixinha do formulário novo (a caixa inteira, com a descrição). */
const caixinha = (p, nome) => formulario(p).getByText(nome).locator("xpath=../..");
/** O cartão de um funcionário na lista. */
const cartao = (p, nome) => p.getByText(nome, { exact: true }).locator("xpath=ancestor::div[.//button][1]");
const contagem = (p, nome) => cartao(p, nome).getByText(/módulos liberados/);
/** A janela de permissões de quem já está cadastrado. */
const titulo = (p) => p.getByRole("heading", { name: /Permissões de Juliana/ });
const janela = (p) => titulo(p).locator("xpath=../../..");
const linha = (p, nome) => janela(p).getByText(nome).locator("xpath=../../..");

/** Rola a PÁGINA até o alvo ficar a `topo` pixels do alto da tela (o rolarAte do palco só rola caixas internas). */
async function rolarPaginaPara(palco, alvo, topo = 120) {
  const c = await alvo.boundingBox();
  const y = await palco.pagina.evaluate(() => window.scrollY);
  await palco.rolarPagina(Math.max(0, Math.round(y + c.y - topo)));
}

/** O retângulo de um pedaço da tela, do alto de um elemento ao pé de outro (para a câmera). */
async function trecho(de, ate, folga = 0) {
  const a = await de.boundingBox(), b = await ate.boundingBox();
  const x = Math.min(a.x, b.x) - folga, y = a.y - folga;
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x + folga, height: b.y + b.height - y + folga };
}

export default {
  id: "equipe",
  titulo: "Equipe e permissões: criar funcionário e escolher as telas dele",
  rota: "store/minha-loja#equipe",
  prontaQuando: "text=Juliana - Caixa",

  /** Uma funcionária já cadastrada, a do caixa: é nela que o vídeo mostra como mudar as permissões depois. */
  async preparar(prisma, { loja }) {
    await prisma.user.create({
      data: {
        name: "Juliana - Caixa", email: "juliana@tutorial.local", password: await bcrypt.hash("tutorial123", 10),
        role: "STAFF", ownerId: loja.id, permissions: "orders,kds,venda_presencial,motoboys",
        storeName: loja.storeName, city: loja.city,
      },
    });
  },

  /** O botão flutuante de ajuda pulsa sem parar e cada pulso é um quadro novo na captura: só o pulso para. */
  async antesDeGravar(palco) {
    await palco.pagina.addStyleTag({ content: "#contact-widget-fab{animation:none !important}" });
    await palco.pagina.evaluate(() => window.scrollTo({ top: 0 }));
    await dormir(300);
  },

  cenas: [
    {
      capitulo: "O que é esta tela",
      fala: "Em Minha loja, Equipe e permissões, você cria um login para cada funcionário e escolhe quais telas do painel ele pode abrir. Cada um entra com o próprio e-mail e senha, sem usar a conta do dono.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await dormir(400);
        await palco.rolarAte(menuEquipe(p), { bloco: "center" });
        await palco.destacar([menuMinhaLoja(p), menuEquipe(p)], { folga: 6 });
        await palco.mover(menuEquipe(p), { ms: 800 });
        await ctx.ate(0.3);
        await palco.apagarDestaque();
        await palco.mover(p.getByRole("heading", { name: /Equipe da Loja/ }), { ms: 800 });
        await ctx.ate(0.62);
        await palco.destacar(cartao(p, "Juliana - Caixa"), { folga: 4 });
        await palco.mover(cartao(p, "Juliana - Caixa").getByText("juliana@tutorial.local"), { ms: 600 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Cadastrar um funcionário",
      fala: "Para criar um acesso, clique em Cadastrar Novo Membro.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /Cadastrar Novo Membro/ });
        await palco.destacar(botao, { folga: 6 });
        await ctx.ate(0.4);
        await palco.apagarDestaque();
        await palco.clicar(botao, { ms: 500 });
        await p.getByText("Novo Login de Funcionário").waitFor({ state: "visible", timeout: 8000 });
        await ctx.ate(1);
      },
    },
    {
      fala: "Preencha o nome do funcionário, o e-mail que ele vai usar para entrar e a senha de acesso. O e-mail não pode ser de outra conta já cadastrada.",
      acao: async (palco) => {
        const p = palco.pagina;
        const nome = p.getByPlaceholder("Ex: Carlos - Operador de Caixa");
        const email = p.getByPlaceholder("exemplo@sualoja.com.br");
        const senha = p.getByPlaceholder("Mínimo 4 caracteres");
        await palco.camera(await trecho(p.getByText("Novo Login de Funcionário"), senha, 10), { zoomMax: 1.6, margem: 30, ms: 500 });
        await palco.digitar(nome, "Marcos - Cozinha");
        await palco.digitar(email, "marcos@tutorial.local");
        await palco.digitar(senha, "cozinha2026");
      },
    },
    {
      capitulo: "Escolher as telas",
      fala: "Mais abaixo ficam os módulos. Cada caixinha libera uma parte do painel, e todas já vêm marcadas, menos Editar pedidos já lançados.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.cameraAberta({ ms: 400 });
        await rolarPaginaPara(palco, p.getByText("Módulos Liberados para este Funcionário:"), 60);
        await palco.camera(grade(p), { zoomMax: 1.5, margem: 34, ms: 600 });
        await palco.mover(caixinha(p, "Painel de Pedidos (Kanban)"), { ms: 500 });
        await ctx.ate(0.45);
        await palco.mover(caixinha(p, "Gestão de Motoboys"), { ms: 600 });
        await ctx.ate(0.68);
        const editar = caixinha(p, "Editar pedidos já lançados");
        await palco.destacar(editar, { folga: 5 });
        await palco.mover(editar, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "A permissão é por tela",
      fala: "A permissão é por tela. Quem tem a caixinha Relatórios Financeiros abre o financeiro, os relatórios, o fiscal e o fiado. E quem tem Configurações da Loja abre também o marketing, o chatbot e os garçons.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const financeiro = caixinha(p, "Relatórios Financeiros & DRE");
        const loja = caixinha(p, "Configurações da Loja");
        await ctx.ate(0.12);
        await palco.destacar(financeiro, { folga: 5 });
        await palco.mover(financeiro, { ms: 500 });
        await ctx.ate(0.58);
        await palco.destacar(loja, { folga: 5 });
        await palco.mover(loja, { ms: 500 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "E tela nova do painel nasce fechada para funcionário, até entrar em uma dessas caixinhas.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.destacar(grade(p), { folga: 8 });
        await palco.mover(caixinha(p, "Controle de Estoque"), { ms: 700 });
        await ctx.ate(1);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Para a cozinha, clique em Desmarcar Todos e marque só a Tela da Cozinha.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const desmarcar = p.getByRole("button", { name: "Desmarcar Todos" });
        await palco.camera([desmarcar, grade(p)], { zoomMax: 1.5, margem: 30, ms: 500 });
        await ctx.ate(0.2);
        await palco.clicar(desmarcar, { ms: 500 });
        await ctx.ate(0.62);
        await palco.clicar(formulario(p).getByText("Tela da Cozinha (KDS)"), { ms: 500 });
        await palco.destacar(caixinha(p, "Tela da Cozinha (KDS)"), { folga: 5 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Salvar o acesso",
      fala: "Depois clique em Salvar e Criar Acesso do Funcionário.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const salvar = p.getByRole("button", { name: /Salvar e Criar Acesso do Funcionário/ });
        await palco.cameraAberta({ ms: 500 });
        // até o fim da página: mais acima, o aviso flutuante "WhatsApp da loja" fica por cima da ponta do botão
        await palco.rolarPagina(2000);
        await palco.destacar(salvar, { folga: 5 });
        await palco.mover(salvar, { ms: 600 });
        await ctx.ate(0.7);
        await palco.apagarDestaque();
        await palco.clicar(salvar, { ms: 200 });
        await cartao(p, "Marcos - Cozinha").waitFor({ state: "visible", timeout: 15_000 });
      },
    },
    {
      fala: "O Marcos aparece na lista, com a conta de quantos módulos estão liberados.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.rolarPagina(0);
        const c = cartao(p, "Marcos - Cozinha");
        await palco.destacar(c, { folga: 4 });
        await palco.mover(c.getByText("Marcos - Cozinha", { exact: true }), { ms: 500 });
        await ctx.ate(0.5);
        await palco.destacar(contagem(p, "Marcos - Cozinha").locator("xpath=.."), { folga: 6 });
        await palco.mover(contagem(p, "Marcos - Cozinha"), { ms: 400 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "O que o funcionário vê",
      fala: "Quando ele entrar no painel, o menu mostra só as telas liberadas. Se tentar abrir outra, o painel leva de volta para uma tela que ele pode usar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, "Marcos - Cozinha");
        // o menu que aparece aqui é o do dono, inteiro: o vídeo só aponta ONDE o funcionário vê menos
        const menu = p.locator("nav.fh-menu-lista");
        await palco.mover(c.getByText("marcos@tutorial.local"), { ms: 500 });
        await ctx.ate(0.14);
        await palco.destacar(menu, { folga: 2 });
        await palco.mover(menuEquipe(p), { ms: 700 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        await palco.camera(c, { zoomMax: 1.45, margem: 50, ms: 600 });
        await palco.mover(contagem(p, "Marcos - Cozinha"), { ms: 500 });
        await ctx.ate(1);
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Mudar permissões e senha",
      fala: "Para mudar depois, clique em Configurar Permissões. Cada linha mostra Liberado ou Bloqueado, e um clique troca.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await palco.clicar(cartao(p, "Juliana - Caixa").getByRole("button", { name: "Configurar Permissões" }), { ms: 600 });
        await titulo(p).waitFor({ state: "visible", timeout: 8000 });
        await dormir(250);
        const cardapio = linha(p, "Cardápio & Produtos");
        await palco.camera(await trecho(titulo(p), linha(p, "Controle de Estoque"), 14), { zoomMax: 1.45, margem: 26, ms: 600 });
        await ctx.ate(0.5);
        await palco.mover(linha(p, "Venda Balcão (PDV / Caixa)").getByText("LIBERADO"), { ms: 450 });
        await ctx.ate(0.66);
        await palco.mover(cardapio.getByText("BLOQUEADO"), { ms: 400 });
        await ctx.ate(0.8);
        await palco.clicar(cardapio.getByText("Cardápio & Produtos"), { ms: 450 });
        await palco.destacar(cardapio, { folga: 5 });
        await ctx.ate(1);
        await dormir(400);
        await palco.apagarDestaque();
      },
    },
    {
      fala: "Aqui também dá para trocar a senha do funcionário. No fim, clique em Salvar Alterações.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const senha = janela(p).getByPlaceholder("Nova senha...");
        await palco.destacar(senha.locator("xpath=../.."), { folga: 5 });
        await palco.mover(senha, { ms: 500 });
        await ctx.ate(0.5);
        await palco.apagarDestaque();
        const salvar = p.getByRole("button", { name: /Salvar Alterações/ });
        await palco.rolarAte(salvar, { bloco: "end" });
        await palco.camera(await trecho(linha(p, "Configuração de Impressoras"), salvar, 16), { zoomMax: 1.45, margem: 26, ms: 500 });
        await ctx.ate(0.85);
        await palco.clicar(salvar, { ms: 450 });
        await titulo(p).waitFor({ state: "hidden", timeout: 15_000 });
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      fala: "Tela bloqueada deixa de abrir em poucos segundos, mesmo com o funcionário já logado.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        await p.getByText(/5 de 11 módulos liberados/).waitFor({ state: "visible", timeout: 15_000 });
        await palco.destacar(contagem(p, "Juliana - Caixa").locator("xpath=.."), { folga: 6 });
        await palco.mover(contagem(p, "Juliana - Caixa"), { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
      },
    },
    {
      capitulo: "Remover o acesso",
      fala: "Para tirar o acesso de quem saiu da loja, clique na lixeira e confirme. O login dele deixa de funcionar.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const c = cartao(p, "Juliana - Caixa");
        const lixeira = c.getByTitle("Excluir funcionário");
        await palco.camera(c, { zoomMax: 1.45, margem: 50, ms: 500 });
        await palco.destacar(lixeira, { folga: 6 });
        await palco.mover(lixeira, { ms: 600 });
        await ctx.ate(1);
        await dormir(300);
        await palco.apagarDestaque();
        await palco.cameraAberta({ ms: 500 });
      },
    },
    {
      capitulo: "Para rever este vídeo",
      fala: "Com isso cada pessoa da equipe vê só o que precisa. Para rever este vídeo, é só clicar em Tutorial, aqui no topo.",
      acao: async (palco, ctx) => {
        const p = palco.pagina;
        const botao = p.getByRole("button", { name: /^Tutorial/ });
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
