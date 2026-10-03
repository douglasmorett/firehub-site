// Parte B: o computador do caixa, no Chrome do dia a dia do lojista — à
// esquerda a tela de pedidos da loja de teste (porta 3000), à direita a tela de
// Entrega do iFood DE VERDADE, logada. O portal do iFood recusa navegador
// controlado por automação, então aqui nada passa por DevTools: só mouse e
// teclado do Windows (controle.ps1) e a leitura de acessibilidade para saber
// onde clicar e quanto o iFood marca.
//
// Antes de rodar (feito à mão, uma vez):
//   - janela da esquerda: localhost:3000/store/pedidos-clientes logada, x=-8 w=716;
//   - janela da direita: a aba de Entrega do iFood (só ela), x=692 w=916;
//   - extensão SEM login (o login é parte do vídeo) e com o robô desligado;
//   - cozinha da loja de teste no começo: node tutoriais/ao-vivo/pedidos.mjs voltar.
//
//   CHROME_PID=6660 node tutoriais/ao-vivo/gravar-b.mjs
// Depois: node tutoriais/ao-vivo/restaurar-b.mjs (devolve o prazo do iFood).
import path from "node:path";
import { Maos, dormir } from "./mesa.mjs";
import { Fita } from "./fita.mjs";
import { CENAS_B, PRONUNCIA, ID } from "./falas.mjs";
import { narrar } from "../motor/narrar.mjs";
import * as P from "./pedidos.mjs";

const PASTA = path.resolve("tutoriais/saida", ID);
const PID = Number(process.env.CHROME_PID || 6660);
const B = Object.fromEntries(CENAS_B.map((c) => [c.id, c]));
const vozes = {};
for (const c of CENAS_B) vozes[c.id] = await narrar(c.fala, { pronuncia: PRONUNCIA });

const maos = new Maos();
const prisma = P.abrir();
// Onde as coisas ficam na tela (1600×900, medidas nas fotos da montagem).
// O ícone de fogo muda de lugar quando a barra ganha um botão (Downloads, outra
// extensão): na segunda tomada ele andou 36 px e o clique abriu o quebra-cabeça.
// Por isso é achado pelo nome; a janelinha abre alinhada à direita dele e tudo
// dentro dela anda junto (DX = quanto andou desde as medidas de 550, 63).
let ICONE, POPUP, DX = 0;
const COLUNA = { x: 305, y: 312, w: 290, h: 170 };
const PAINEL = { x: 1200, y: 330, w: 330, h: 500 };
const LUGAR_ESQ = { x: -8, y: 0, w: 716, h: 908 };
const LUGAR_DIR = { x: 692, y: 0, w: 916, h: 908 };
let janelas = await maos.janelas(PID);
let esq = janelas.find((j) => !j.oculta && j.x === LUGAR_ESQ.x && j.w === LUGAR_ESQ.w)?.hwnd;
let dir = janelas.find((j) => !j.oculta && j.x === LUGAR_DIR.x && j.w === LUGAR_DIR.w)?.hwnd;
// Se alguém minimizou ou mexeu (Win+D, por exemplo), acha pelo nome e põe de volta.
if (!esq) esq = janelas.find((j) => j.nome.startsWith("FireHub — Simples"))?.hwnd;
if (!dir) dir = janelas.find((j) => j.nome.startsWith("iFood - Portal do Parceiro"))?.hwnd;
if (!esq || !dir) throw new Error("não achei as duas janelas: " + JSON.stringify(janelas));
await maos.posicionar(esq, LUGAR_ESQ);
await maos.posicionar(dir, LUGAR_DIR);
await dormir(1200);
// Confere a cena antes de gravar qualquer coisa (na primeira tomada a esquerda
// estava na Roteirização e o vídeo saiu errado).
const confere = async (nome, hwnd) => (await maos.pedir({ cmd: "achar", nome, hwnd })).ok;
const problemas = [];
if (!(await confere("Em Produção", esq)) || !(await confere("Novos Pedidos", esq))) problemas.push("a janela da esquerda não está na tela de Pedidos");
if (!(await confere("Tempo e taxa", dir))) problemas.push("o iFood não está no quadro Tempo e taxa");
if ((await confere("Desativar nas configurações", esq)) || (await confere("Desativar nas configurações", dir))) problemas.push("o aviso de software de teste automatizado está na tela");
const etaDaLoja = (await prisma.user.findUnique({ where: { email: "demo@tutorial.local" }, select: { etaConfig: true } }))?.etaConfig;
if (etaDaLoja?.motoboysCount !== 2) problemas.push(`a loja de teste está com ${etaDaLoja?.motoboysCount} motoboys salvos (o roteiro conta com 2)`);
const fogo = await maos.achar("FireHub — Prazo Automático de Entrega", { hwnd: esq, tipo: "Button" }).catch(() => null);
if (!fogo || fogo.y > 80) problemas.push("não achei o ícone de fogo na barra da janela da esquerda");
if (problemas.length) { maos.fechar(); await prisma.$disconnect(); throw new Error("não gravei: " + problemas.join("; ")); }
ICONE = { x: fogo.x + fogo.w / 2, y: fogo.y + fogo.h / 2 };
DX = fogo.x + fogo.w - 567;
POPUP = { x: 247 + DX, y: 80, w: 320, h: 360 };
console.log("ícone de fogo em", ICONE, "DX", DX);
// ENSAIO=1: só confere a cena (janelas, telas, ícone) e para, sem gravar nem clicar.
if (process.env.ENSAIO) { console.log("ensaio ok"); maos.fechar(); await prisma.$disconnect(); process.exit(0); }


/** Os minutos da primeira linha da tabela do iFood (o que a extensão lê e muda). */
async function prazo() {
  const campos = await maos.valores(dir);
  const tempo = campos.find((c) => c.x > 1280 && c.x < 1370 && /^\d+$/.test(String(c.valor || "")));
  return tempo ? Number(tempo.valor) : null;
}
async function esperarPrazo(alvo, ms = 30000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if ((await prazo()) === alvo) { await dormir(1800); return true; }
    await dormir(250);
  }
  console.warn(`o iFood não chegou a ${alvo} min (está em ${await prazo()})`);
  return false;
}
/** A pílula da extensão na tela de pedidos diz quantos pedidos ela leu da coluna Em Produção. */
async function esperarPedidos(n, ms = 25000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const r = await maos.pedir({ cmd: "achar", nome: `· ${n} ped.`, hwnd: esq });
    if (r.ok) return true;
    await dormir(250);
  }
  console.warn(`a extensão não leu ${n} pedidos`);
  return false;
}
async function recarregarIfood() {
  const rec = await maos.achar("Recarregar", { hwnd: dir, tipo: "Button", exato: true });
  await maos.clicar(rec.x + rec.w / 2, rec.y + rec.h / 2, 300);
  await maos.mover(150, 640, 300);
  await dormir(2000);
  for (let i = 0; i < 40 && (await prazo()) === null; i++) await dormir(500);
  await dormir(1500);
}
/** Põe o iFood num prazo pelos botões −/+ 5 min e Salvar, partindo do gravado (recarrega antes) e conferindo o gravado (recarrega depois). */
async function garantirPrazo(alvo) {
  await recarregarIfood();
  let v = await prazo();
  if (v === null) return false;
  if (v !== alvo) {
    const descer = v > alvo;
    const botao = await maos.achar(descer ? "subtract 5 min" : "add 5 min", { hwnd: dir, tipo: "Button" });
    for (let i = 0; i < 20 && v !== alvo && (v > alvo) === descer; i++) {
      await maos.clicar(botao.x + botao.w / 2, botao.y + botao.h / 2, 250);
      await dormir(600);
      v = await prazo();
    }
    if (v !== alvo) return false;
    const salvar = await maos.achar("Salvar", { hwnd: dir, tipo: "Button", exato: true });
    await maos.clicar(salvar.x + salvar.w / 2, salvar.y + salvar.h / 2, 300);
    await dormir(3000);
    await recarregarIfood();
  }
  return (await prazo()) === alvo;
}
const naTela = async (nome) => (await maos.pedir({ cmd: "achar", nome, hwnd: esq })).ok;
/** Um texto da janelinha da extensão (a página de pedidos atrás tem textos iguais, como "Em Produção"). */
async function noPopup(nome) {
  for (const l of await maos.listar({ hwnd: esq, tipo: "Text" })) {
    const p = l.split(" | ");
    if (!p[1] || !p[1].toLowerCase().includes(nome.toLowerCase())) continue;
    const [pos, tam] = p[2].split(" ");
    const [x, y] = pos.split(",").map(Number);
    const [w, h] = tam.split("x").map(Number);
    if (x >= POPUP.x && x <= POPUP.x + POPUP.w && y < 700) return { x, y, w, h };
  }
  throw new Error(`não achei "${nome}" na janelinha da extensão`);
}

// A janelinha da extensão ficou aberta na montagem: o vídeo começa sem ela.
await maos.tecla("ESC");
await P.voltar(prisma);
console.log("iFood agora:", await prazo(), "min");
await esperarPedidos(2);
await maos.mover(160, 640, 300);
await dormir(800);

const fita = new Fita(PASTA, "b");
let roboLigado = false;
await fita.comecar();
try {
  await fita.cena(B.b1, vozes.b1, async (ctx) => {
    await ctx.ate(0.12);
    fita.camera({ x: 0, y: 80, w: 700, h: 820 }, { zoomMax: 1.15, margem: 0 });
    await ctx.ate(0.36);
    fita.camera({ x: 700, y: 80, w: 900, h: 820 }, { zoomMax: 1.15, margem: 0 });
    await ctx.ate(0.78);
    fita.camera({ x: 380 + DX, y: 38, w: 320, h: 54 }, { zoomMax: 2.2, margem: 30 });
    await maos.mover(ICONE.x, ICONE.y, 800);
    await ctx.ate(0.96);
    await maos.clicar();
    await dormir(700);
    fita.camera(POPUP, { zoomMax: 1.9, margem: 20 });
  });

  await fita.cena(B.b2, vozes.b2, async (ctx) => {
    // Sem a tela de login aberta não digita nada (o robô ainda está desligado:
    // parar aqui não mexe no iFood).
    await maos.esperarAchar("Faça Login", { hwnd: esq }, 5000);
    await ctx.ate(0.15);
    await maos.clicar(407 + DX, 273, 500);
    await maos.digitar("demo@tutorial.local", 45);
    await maos.clicar(407 + DX, 335, 400);
    await maos.digitar("tutorial123", 45);
    await ctx.ate(0.85);
    await maos.clicar(407 + DX, 384, 400);
  }, {
    esperarDepois: async () => {
      const fim = Date.now() + 20000;
      while (Date.now() < fim && !(await naTela("Robô Automático"))) await dormir(250);
      await dormir(600);
    },
  });

  await fita.cena(B.b3, vozes.b3, async (ctx) => {
    const titulo = await noPopup("Motoboys na Casa");
    const yContador = titulo.y + titulo.h / 2 + 31;
    fita.camera({ x: 263 + DX, y: titulo.y - 14, w: 288, h: 84 }, { zoomMax: 2.2, margem: 16 });
    // Só aponta o menos e o mais: os 2 motoboys vêm do servidor (conferido no
    // banco antes de gravar). Na terceira tomada o script tentou "acertar" o
    // número lendo a tela, pegou o 6 do cartão "#6" atrás da janelinha e
    // baixou para 1 — e o iFood foi a 78.
    await ctx.ate(0.1);
    await maos.mover(293 + DX, yContador, 700);
    await ctx.ate(0.22);
    await maos.mover(520 + DX, yContador, 700);
    await ctx.ate(0.5);
    const robo = await noPopup("Robô Automático");
    const chave = { x: 514 + DX, y: robo.y + robo.h / 2 + 6 };
    fita.camera({ x: 263 + DX, y: chave.y - 26, w: 288, h: 52 }, { zoomMax: 2.2, margem: 16 });
    await maos.mover(chave.x, chave.y, 800);
    await ctx.ate(0.7);
    await maos.clicar();
    roboLigado = true;
    await dormir(700);
    // Tela inteira: o iFood muda à direita em uns 2 segundos.
    fita.cameraAberta(700);
    await maos.mover(chave.x - 120, chave.y + 120, 600);
  });

  await fita.cena(B.b4, vozes.b4, async (ctx) => {
    fita.camera(PAINEL, { zoomMax: 1.6, margem: 20 });
    await esperarPrazo(28, 25000);
    await ctx.ate(0.6);
    const metricas = await noPopup("Em Produção").catch(() => null);
    if (metricas) fita.camera({ x: 263 + DX, y: metricas.y - 40, w: 288, h: 60 }, { zoomMax: 2.2, margem: 16 });
    await ctx.ate(0.97);
  });
  // Fecha a janelinha da extensão (ela não precisa ficar aberta).
  await maos.tecla("ESC");
  await dormir(500);
  fita.cameraAberta(500);

  await fita.cena(B.b5, vozes.b5, async (ctx) => {
    await P.chegar(prisma, 2);
    fita.camera(COLUNA, { zoomMax: 2, margem: 16 });
    await ctx.ate(0.5);
    await maos.mover(450, 340, 900);
  }, {
    esperarDepois: async () => {
      await esperarPedidos(4);
      await dormir(400);
      fita.camera(PAINEL, { zoomMax: 1.6, margem: 20 });
      await maos.mover(160, 640, 700);
    },
  });

  await fita.cena(B.b6, vozes.b6, async () => {
    await esperarPrazo(38);
  });

  await fita.cena(B.b7, vozes.b7, async (ctx) => {
    await P.chegar(prisma, 2);
    fita.camera(COLUNA, { zoomMax: 2, margem: 16 });
    await esperarPedidos(6);
    await dormir(300);
    fita.camera(PAINEL, { zoomMax: 1.6, margem: 20 });
    await esperarPrazo(58);
  });

  await fita.cena(B.b8, vozes.b8, async () => {
    await P.sair(prisma);
    fita.camera({ x: 20, y: 312, w: 670, h: 300 }, { zoomMax: 1.6, margem: 10 });
    await esperarPedidos(0);
    await dormir(600);
    fita.camera(PAINEL, { zoomMax: 1.6, margem: 20 });
    await esperarPrazo(28);
  });

  await fita.cena(B.b9, vozes.b9, async (ctx) => {
    fita.cameraAberta(800);
    await ctx.ate(0.6);
    await maos.mover(800, 450, 1200);
  });

  await fita.cena(B.b10, vozes.b10, async (ctx) => {
    await ctx.ate(0.15);
    await maos.clicar(27, 111, 700);
    await dormir(800);
    const tut = await maos.esperarAchar("Tutoriais em vídeo", { hwnd: esq }, 5000).catch(() => null);
    if (tut) {
      fita.camera({ x: tut.x - 20, y: tut.y - 30, w: tut.w + 40, h: tut.h + 60 }, { zoomMax: 2.2, margem: 30 });
      await maos.mover(tut.x + tut.w / 2, tut.y + tut.h / 2, 700);
    }
  });
} finally {
  const dados = await fita.parar();
  console.log(`parte B: ${(dados.fim / 1000).toFixed(1)} s, ${dados.cenas.length} cenas; iFood agora: ${await prazo()} min`);
  if (roboLigado) {
    // 1) Desliga o robô (estava desligado antes da gravação), conferindo pela
    //    cor da chave: verde = ligada. Clicar às cegas podia LIGAR de novo.
    await maos.clicar(150, 640, 300);
    await dormir(400);
    await maos.clicar(ICONE.x, ICONE.y, 300);
    await dormir(1800);
    const robo = await noPopup("Robô Automático").catch(() => null);
    let desligado = false;
    if (robo) {
      const chave = { x: 514 + DX, y: robo.y + robo.h / 2 + 6 };
      const verde = async () => { const c = await maos.cor(chave.x - 9, chave.y); return c.g > 150 && c.r < 120; };
      if (await verde()) { await maos.clicar(chave.x, chave.y, 300); await dormir(900); }
      desligado = !(await verde());
    }
    await maos.clicar(150, 640, 300);
    console.log(desligado ? "robô desligado" : "ATENÇÃO: não consegui conferir o robô desligado");
    // 2) Um ajuste que já tinha começado termina sozinho (recarrega, mexe, salva):
    //    espera ele acabar antes de mexer no iFood.
    await dormir(20000);
    // 3) Devolve o iFood ao prazo de antes (38 min em todos os raios) pelos
    //    botões do próprio iFood, e confere o GRAVADO recarregando a página —
    //    o número na tela antes de recarregar é só o formulário.
    const voltou = await garantirPrazo(38);
    console.log(voltou ? "iFood de volta a 38 min (conferido depois de recarregar)" : `ATENÇÃO: o iFood ficou em ${await prazo()} min — volte para 38 à mão`);
  }
  console.log(JSON.stringify(await P.estado(prisma)));
  maos.fechar();
  await prisma.$disconnect();
}
