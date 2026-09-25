/**
 * Paleta "Brasa" no painel — o segundo passo depois de scripts/aplicar-tema.js.
 *
 * O dono aprovou em 23/09/2026, olhando a tela de pedidos no localhost:
 * "não é sobre deixar tudo cinza, é sobre construir uma paleta de cores que
 * combine e não fique poluído, tudo colorido". Poucas cores, da família do
 * fogo, cada uma com UM papel (a mesma tabela de src/lib/paleta-brasa.ts):
 *
 *   vermelho FireHub #C92E09  → ação principal            (já é a marca)
 *   laranja brasa    #E8590C  → o que é da entrega        (os laranjas soltos)
 *   verde-azulado    #0F766E  → deu certo                 (o verde "ok" inteiro)
 *   âmbar            #B45309  → atenção                   (fica)
 *   vermelho grave   #B71C1C  → erro, atrasado            (fica)
 *   carvão #1C1917 / areia #FAF6F2 → navegação e informação
 *                                  (o azul "info", o roxo e o índigo)
 *
 * Os neutros slate (texto, borda, fundo) ficam como estão: foi com eles que o
 * dono aprovou. Cores de MARCA de terceiros também ficam — vermelho do iFood
 * (#EA1D2C), verde do WhatsApp (#25D366), azul do Facebook (#1877F2) — porque
 * é por elas que o lojista reconhece de onde vem a coisa.
 *
 *   node scripts/aplicar-paleta-brasa.js          → aplica
 *   node scripts/aplicar-paleta-brasa.js --conta  → só conta, não escreve
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const ALVOS = ["src/components", "src/app/store", "src/app/admin"];
const SO_CONTA = process.argv.includes("--conta");

// Telas do CLIENTE FINAL: fora (mesma lista de scripts/aplicar-tema.js).
const FORA = [
  "src/components/customer/CustomerStorePage.tsx",
  "src/components/customer/ConfirmarPontoNoMapa.tsx",
  "src/components/customer/FacebookPixel.tsx",
  "src/components/customer/GoogleAnalytics.tsx",
  "src/components/FloatingContactWidget.tsx",
  "src/components/trilha/TrilhaDoCliente.tsx",
  "src/components/CartProvider.tsx",
  // Cópias do popup da extensão (que não usa a paleta): tematizar tira a semelhança com o que o lojista vê.
  "src/app/store/extensao-ifood/ilustracoes.tsx",
  "src/components/Providers.tsx",
].map((p) => path.join(RAIZ, p).toLowerCase());

const CARVAO = "#1C1917", CARVAO2 = "#44403C", CARVAO3 = "#57534E", CARVAO_INERTE = "#A8A29E";
const AREIA = "#FAF6F2", AREIA_BORDA = "#E7DDD3";
const OK = "#0F766E", OK_ESCURO = "#134E4A", OK_MEDIO = "#0D9488", OK_CLARO = "#F0FDFA", OK_BORDA = "#99F6E4", OK_BORDA2 = "#5EEAD4";
const BRASA = "#E8590C", BRASA_TINTA = "#9A3412", BRASA_CLARO = "#FFF4EF", BRASA_BORDA = "#FFD3C2";

/** de → para */
const MAPA = [
  // ── VERDE "ok" → verde-azulado (combina com o laranja; o verde-bandeira não)
  ["#15803D", OK], ["#16A34A", OK], ["#047857", OK], ["#059669", OK], ["#10B981", OK_MEDIO],
  ["#22C55E", OK_MEDIO], ["#34D399", OK_BORDA2], ["#4ADE80", OK_BORDA2], ["#4CAF50", OK_MEDIO],
  ["#00BFA5", OK_MEDIO], ["#065F46", OK_ESCURO], ["#14532D", OK_ESCURO], ["#166534", OK_ESCURO],
  ["#ECFDF3", OK_CLARO], ["#ECFDF5", OK_CLARO], ["#F0FDF4", OK_CLARO], ["#DCFCE7", OK_CLARO], ["#D1FAE5", OK_CLARO],
  ["#ABEFC6", OK_BORDA], ["#A7F3D0", OK_BORDA], ["#BBF7D0", OK_BORDA], ["#86EFAC", OK_BORDA], ["#6EE7B7", OK_BORDA2],
  // lima (canal Wabiz) cai no mesmo verde-azulado
  ["#65A30D", OK], ["#3F6212", OK_ESCURO], ["#F7FEE7", OK_CLARO], ["#ECFCCB", OK_CLARO], ["#84CC16", OK_MEDIO],
  // ciano (totem, "aguardando pagamento") também
  ["#0891B2", OK], ["#06B6D4", OK_MEDIO], ["#155E75", OK_ESCURO], ["#ECFEFF", OK_CLARO], ["#CFFAFE", OK_CLARO],
  ["#67E8F9", OK_BORDA], ["#A5F3FC", OK_BORDA], ["#22D3EE", OK_BORDA2],

  // ── AZUL "info" → carvão (texto, botão) e areia (fundo, borda) ──────────
  ["#1D4ED8", CARVAO], ["#1565C0", CARVAO], ["#1976D2", CARVAO], ["#0D47A1", CARVAO], ["#0369A1", CARVAO],
  ["#0284C7", CARVAO], ["#0EA5E9", CARVAO2], ["#38BDF8", CARVAO_INERTE],
  ["#EFF6FF", AREIA], ["#E3F2FD", AREIA], ["#F0F9FF", AREIA], ["#E0F2FE", AREIA],
  ["#B2DDFF", AREIA_BORDA], ["#BAE6FD", AREIA_BORDA],

  // ── ROXO e ÍNDIGO → carvão e areia ───────────────────────────────────────
  ["#7E22CE", CARVAO], ["#6B21A8", CARVAO], ["#581C87", CARVAO], ["#4F46E5", CARVAO], ["#6366F1", CARVAO],
  ["#9333EA", CARVAO2], ["#9C27B0", CARVAO2], ["#667EEA", CARVAO2], ["#A855F7", CARVAO3], ["#818CF8", CARVAO_INERTE],
  ["#F3E8FF", AREIA], ["#FAF5FF", AREIA], ["#F0EDFF", AREIA], ["#EEF2FF", AREIA], ["#E0E7FF", AREIA],
  ["#E9D5FF", AREIA_BORDA], ["#D8B4FE", AREIA_BORDA], ["#C7D2FE", AREIA_BORDA],
  // o "noturno" azulado (tela escura) vira carvão quente
  ["#1A1A2E", CARVAO], ["#2A2A4A", "#292524"], ["#3A3A5A", CARVAO2],

  // ── LARANJAS soltos → brasa ──────────────────────────────────────────────
  ["#EA580C", BRASA], ["#F97316", BRASA], ["#FB923C", BRASA], ["#FF5722", BRASA], ["#E65100", BRASA], ["#FF8A00", BRASA],
  ["#C2410C", BRASA_TINTA],
  ["#FFF7ED", BRASA_CLARO], ["#FFEDD5", BRASA_CLARO],
  ["#FED7AA", BRASA_BORDA], ["#FDBA74", BRASA_BORDA],

  // ── AMARELO → âmbar (a paleta tem um amarelo só: o de atenção) ───────────
  ["#EAB308", "#B45309"], ["#CA8A04", "#B45309"], ["#A16207", "#B45309"], ["#854D0E", "#92400E"],
  ["#FEF9C3", "#FFF7E6"], ["#FCD34D", "#FDE68A"],

  // ── ROSA → família do vermelho ───────────────────────────────────────────
  ["#EC4899", "#C92E09"], ["#DB2777", "#C92E09"], ["#F43F5E", "#C92E09"], ["#BE185D", "#B71C1C"],
  ["#FCE7F3", BRASA_CLARO], ["#FFE4E6", "#FEF2F2"],
];

/** Brilhos (box-shadow) com rgba das famílias que saíram. */
const MAPA_RGBA = [
  [/rgba\(\s*(37\s*,\s*99\s*,\s*235|59\s*,\s*130\s*,\s*246|29\s*,\s*78\s*,\s*216|99\s*,\s*102\s*,\s*241|124\s*,\s*58\s*,\s*237|126\s*,\s*34\s*,\s*206|147\s*,\s*51\s*,\s*234)\s*,/g, "rgba(28, 25, 23,"],
  [/rgba\(\s*(5\s*,\s*150\s*,\s*105|16\s*,\s*185\s*,\s*129|34\s*,\s*197\s*,\s*94|22\s*,\s*163\s*,\s*74|21\s*,\s*128\s*,\s*61)\s*,/g, "rgba(15, 118, 110,"],
];

function arquivos(dir, lista) {
  lista = lista || [];
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (fs.statSync(p).isDirectory()) arquivos(p, lista);
    else if (/\.(tsx|ts|css)$/.test(nome)) lista.push(p);
  }
  return lista;
}

let todos = [];
for (const alvo of ALVOS) {
  const dir = path.join(RAIZ, alvo);
  if (fs.existsSync(dir)) todos = todos.concat(arquivos(dir));
}
todos = todos.filter((p) => !FORA.includes(p.toLowerCase()));

const placar = new Map();
let tocados = 0;
let trocasTotal = 0;

for (const arq of todos) {
  const antes = fs.readFileSync(arq, "utf8");
  let depois = antes;

  for (const [de, para] of MAPA) {
    const re = new RegExp(de + "(?![0-9A-Fa-f])", "gi");
    const achou = depois.match(re);
    if (achou) {
      placar.set(de, (placar.get(de) || 0) + achou.length);
      trocasTotal += achou.length;
      depois = depois.replace(re, para);
    }
  }
  for (const [re, para] of MAPA_RGBA) {
    const achou = depois.match(re);
    if (achou) {
      placar.set("rgba " + para, (placar.get("rgba " + para) || 0) + achou.length);
      trocasTotal += achou.length;
      depois = depois.replace(re, para);
    }
  }

  if (depois !== antes) {
    tocados++;
    if (!SO_CONTA) fs.writeFileSync(arq, depois, "utf8");
  }
}

console.log(SO_CONTA ? "— SÓ CONTAGEM, nada escrito —\n" : "— aplicado —\n");
for (const [de, n] of [...placar].sort((a, b) => b[1] - a[1])) {
  const alvo = MAPA.find((m) => m[0] === de);
  console.log(`  ${String(n).padStart(4)}x  ${de}${alvo ? " → " + alvo[1] : ""}`);
}
console.log(`\n  ${trocasTotal} trocas em ${tocados} arquivos (de ${todos.length} lidos)`);
