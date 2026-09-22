/**
 * Aplica o tema "preto e vermelho" no painel: colapsa as cores duplicadas em
 * cima da paleta que o sistema JÁ tem (src/styles/fh-tokens.css).
 *
 * Não inventa cor nenhuma. Cada destino abaixo é um token que já existe no
 * arquivo de tokens — o que some são as FAMÍLIAS que o sistema não tem:
 * roxo, um segundo verde, um segundo âmbar, um segundo azul, quatro tons de
 * vermelho e o ramp `gray` do Tailwind convivendo com o `slate`.
 *
 *   node scratch/aplicar-tema.js          → aplica
 *   node scratch/aplicar-tema.js --conta  → só conta, não escreve
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const ALVOS = ["src/components", "src/app/store", "src/app/admin"];
const SO_CONTA = process.argv.includes("--conta");

/** de → para. Comentário = por que este destino. */
const MAPA = [
  // ── VERMELHO: quatro tons viram dois (a marca e o "grave") ───────────────
  ["#EF4444", "#C92E09"], // --fh-marca
  ["#DC2626", "#C92E09"], // --fh-marca
  ["#F87171", "#E8360C"], // --fh-marca-topo
  ["#B91C1C", "#B71C1C"], // --fh-grave
  ["#991B1B", "#B71C1C"], // --fh-grave
  ["#7F1D1D", "#B71C1C"], // --fh-grave
  ["#C62828", "#C92E09"], // o vermelho da barra lateral = o da marca
  ["#E53935", "#C92E09"],

  // ── VERDE: o ramp emerald sai, fica o do token ───────────────────────────
  ["#16A34A", "#15803D"], // --fh-ok
  ["#10B981", "#15803D"], // --fh-ok
  ["#22C55E", "#15803D"], // --fh-ok
  ["#059669", "#15803D"], // --fh-ok
  ["#166534", "#15803D"], // --fh-ok
  ["#F0FDF4", "#ECFDF3"], // --fh-ok-claro
  ["#DCFCE7", "#ECFDF3"], // --fh-ok-claro
  ["#D1FAE5", "#ECFDF3"], // --fh-ok-claro
  ["#BBF7D0", "#ABEFC6"], // --fh-ok-borda
  ["#86EFAC", "#ABEFC6"], // --fh-ok-borda

  // ── ÂMBAR ────────────────────────────────────────────────────────────────
  ["#F59E0B", "#B45309"], // --fh-atencao
  ["#D97706", "#B45309"], // --fh-atencao
  ["#FBBF24", "#B45309"], // --fh-atencao
  ["#FFFBEB", "#FFF7E6"], // --fh-atencao-claro
  ["#FEF3C7", "#FFF7E6"], // --fh-atencao-claro
  ["#FFFBF0", "#FFF7E6"], // --fh-atencao-claro

  // ── AZUL: fica só o "info" ───────────────────────────────────────────────
  ["#2563EB", "#1D4ED8"], // --fh-info
  ["#3B82F6", "#1D4ED8"], // --fh-info
  ["#60A5FA", "#1D4ED8"], // --fh-info
  ["#1E40AF", "#1D4ED8"], // --fh-info
  ["#1E3A8A", "#1D4ED8"], // --fh-info
  ["#DBEAFE", "#EFF6FF"], // --fh-info-claro
  ["#93C5FD", "#B2DDFF"], // --fh-info-borda
  ["#BFDBFE", "#B2DDFF"], // --fh-info-borda

  // ── ROXO: não existe na paleta. Vira o cinza-ardósia da casa ─────────────
  ["#7C3AED", "#475569"], // --fh-t3
  ["#6D28D9", "#334155"], // --fh-t2
  ["#8B5CF6", "#64748B"], // --fh-t4
  ["#A78BFA", "#94A3B8"], // --fh-t-inerte
  ["#C4B5FD", "#CBD5E1"], // --fh-linha-forte
  ["#DDD6FE", "#E2E8F0"], // --fh-linha
  ["#EDE9FE", "#F1F5F9"], // --fh-neutro-claro
  ["#F5F3FF", "#F8FAFC"], // --fh-n3
  ["#5B21B6", "#334155"], // --fh-t2
  ["#4C1D95", "#0F172A"], // --fh-t1

  // ── CINZA: o ramp `gray` sai, fica o `slate` (o sistema usa slate) ───────
  ["#374151", "#334155"], // --fh-t2
  ["#4B5563", "#475569"], // --fh-t3
  ["#6B7280", "#64748B"], // --fh-t4
  ["#9CA3AF", "#94A3B8"], // --fh-t-inerte
  ["#D1D5DB", "#CBD5E1"], // --fh-linha-forte
  ["#E5E7EB", "#E2E8F0"], // --fh-linha
  ["#F3F4F6", "#F1F5F9"], // --fh-neutro-claro
  ["#F9FAFB", "#F8FAFC"], // --fh-n3
  ["#111827", "#0F172A"], // --fh-t1
  ["#1F2937", "#1E293B"],
];

function arquivos(dir, lista) {
  lista = lista || [];
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    const st = fs.statSync(p);
    if (st.isDirectory()) arquivos(p, lista);
    else if (/\.(tsx|ts|css)$/.test(nome)) lista.push(p);
  }
  return lista;
}

let todos = [];
for (const alvo of ALVOS) {
  const dir = path.join(RAIZ, alvo);
  if (fs.existsSync(dir)) todos = todos.concat(arquivos(dir));
}

const placar = new Map();
let tocados = 0;
let trocasTotal = 0;

for (const arq of todos) {
  const antes = fs.readFileSync(arq, "utf8");
  let depois = antes;

  for (const [de, para] of MAPA) {
    // Só hex de 6 dígitos, maiúsculo ou minúsculo, sem engolir um hex maior.
    const re = new RegExp(de.replace("#", "#") + "(?![0-9A-Fa-f])", "gi");
    const achou = depois.match(re);
    if (achou) {
      placar.set(de, (placar.get(de) || 0) + achou.length);
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
  const para = MAPA.find((m) => m[0] === de)[1];
  console.log(`  ${String(n).padStart(4)}x  ${de} → ${para}`);
}
console.log(`\n  ${trocasTotal} trocas em ${tocados} arquivos (de ${todos.length} lidos)`);
