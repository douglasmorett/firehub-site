/**
 * Trava os vídeos tutoriais no robô do número do FireHub (lib/atendimento/videos.ts).
 *
 *   npx tsx scripts/teste-videos-do-robo.ts
 *
 * O pedido do Douglas (02/10/2026): "como eu mexo na roteirização?" → o robô
 * manda o link do vídeo da Roteirização. Aqui: a busca acha o vídeo certo para
 * pergunta escrita do jeito do WhatsApp, não acha vídeo nenhum para conversa
 * fiada, e o link que sai é sempre de vídeo que existe.
 *
 * Usa as fichas e a fala publicadas (lib/tutoriais-fichas.json e
 * tutoriais-busca.json), sem disco e sem banco: todos os vídeos contam como no ar.
 */
import { todosOsTutoriais } from "../src/lib/tutoriais";
import {
  LINK_DOS_TUTORIAIS,
  aulaDoVideo,
  consertarLinksDeVideo,
  linkDoVideo,
  listaDosVideos,
  videosJaEnviados,
  videosParaAConversa,
} from "../src/lib/atendimento/videos";

let falhas = 0;
const confere = (oQue: string, ok: boolean, detalhe = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok || !detalhe ? "" : ` — ${detalhe}`}`);
};

const VIDEOS = todosOsTutoriais(null).flatMap((g) => g.tutoriais);
const IDS = new Set(VIDEOS.map((v) => v.id));
const achados = (pergunta: string) => videosParaAConversa([pergunta], VIDEOS).map((v) => v.id);

// ── A busca: o primeiro tem que ser o vídeo do assunto ─────────────────────
const PRIMEIRO: [string, string[]][] = [
  ["como eu mexo na roteirização?", ["roteirizacao"]],
  ["Como faço pra montar a rota do motoboy", ["roteirizacao"]],
  ["como roteirizar os pedidos de entrega", ["roteirizacao"]],
  ["como cadastro um motoboy?", ["motoboys"]],
  ["como coloco um preço diferente no ifood?", ["cardapio-precos"]],
  ["como faço meio a meio na pizza?", ["cardapio-combos"]],
  ["Como mexo nos combos?", ["cardapio-combos"]],
  ["como abro o caixa?", ["caixa"]],
  ["como ligo a nota fiscal", ["fiscal"]],
  ["taxa de entrega por bairro", ["entrega"]],
  ["como conecto o ifood", ["integracoes"]],
  ["como funciona o fiado?", ["fiado"]],
  ["quero mudar o horário que a loja abre", ["horarios"]],
  ["como cadastrar produto no cardápio", ["cardapio-produto"]],
  ["como dar baixa no estoque", ["estoque"]],
  ["como faço a etiqueta de validade", ["etiquetas"]],
  ["como uso a tela da cozinha", ["kds"]],
  ["como vender no balcão", ["balcao"]],
  ["como vejo quanto sobrou no mês", ["financeiro", "relatorios"]],
  ["como libero só algumas telas pro funcionário", ["equipe"]],
  ["como ativo o cashback", ["fidelidade"]],
  ["quais formas de pagamento aceito", ["pagamento"]],
  ["como configuro a impressora", ["impressoras"]],
  ["robô do whatsapp, como ligo?", ["chatbot"]],
  // Sinônimo da central ("cupom" = cupom fiscal) não ganha da palavra escrita:
  ["quero criar um cupom de desconto", ["marketing"]],
  ["como emito nota fiscal", ["fiscal"]],
  ["meu entregador não sabe usar o aplicativo", ["app-motoboy"]],
];
for (const [pergunta, aceitos] of PRIMEIRO) {
  const r = achados(pergunta);
  confere(`"${pergunta}" → ${aceitos.join(" ou ")}`, aceitos.includes(r[0]), `veio [${r.join(", ")}]`);
}

// ── A busca: o vídeo do assunto tem que estar entre os sugeridos ───────────
const ENTRE: [string, string][] = [
  ["meu entregador não sabe usar o aplicativo", "app-motoboy"],
  ["não está imprimindo na cozinha", "impressoras"],
  ["quero criar um cupom de desconto", "marketing"],
  ["como o garçom lança o pedido na mesa", "garcons"],
  ["como o garçom lança o pedido na mesa", "mesas"],
];
for (const [pergunta, id] of ENTRE) {
  const r = achados(pergunta);
  confere(`"${pergunta}" traz ${id}`, r.includes(id), `veio [${r.join(", ")}]`);
}

// ── Conversa fiada e assunto sem vídeo: nenhum ─────────────────────────────
for (const pergunta of ["oi, tudo bem?", "bom dia!", "quanto custa o sistema?", "obrigado, valeu", "ok", "📷 Imagem", "🎤 sim pode ser"]) {
  const r = achados(pergunta);
  confere(`"${pergunta}" não sugere vídeo`, r.length === 0, `veio [${r.join(", ")}]`);
}

confere("no máximo 2 vídeos", VIDEOS.length > 0 && achados("pedidos mesas cozinha balcão caixa").length <= 2);
confere("sem vídeos no ar, nada", videosParaAConversa(["como eu mexo na roteirização?"], []).length === 0);

// ── Os links ───────────────────────────────────────────────────────────────
confere("link do vídeo", linkDoVideo("roteirizacao") === "https://firehubfood.com.br/tutoriais/roteirizacao");
confere("link do capítulo", linkDoVideo("roteirizacao", 95.7) === "https://firehubfood.com.br/tutoriais/roteirizacao?t=95");
confere("capítulo 0 sem ?t", linkDoVideo("pedidos", 0) === "https://firehubfood.com.br/tutoriais/pedidos");

const conserta = (texto: string) => consertarLinksDeVideo(texto, IDS);
confere("sem https ganha https", conserta("Veja: firehubfood.com.br/tutoriais/roteirizacao") === "Veja: https://firehubfood.com.br/tutoriais/roteirizacao");
confere("capítulo é mantido", conserta("https://firehubfood.com.br/tutoriais/kds?t=40") === "https://firehubfood.com.br/tutoriais/kds?t=40");
confere("www some", conserta("https://www.firehubfood.com.br/tutoriais/kds") === "https://firehubfood.com.br/tutoriais/kds");
confere("id inventado vira a lista", conserta("Olha: https://firehubfood.com.br/tutoriais/rotas") === `Olha: ${LINK_DOS_TUTORIAIS}`);
confere("id com maiúscula é o mesmo vídeo", conserta("firehubfood.com.br/tutoriais/Roteirizacao") === "https://firehubfood.com.br/tutoriais/roteirizacao");
confere("a lista continua a lista", conserta("Todos: firehubfood.com.br/tutoriais") === `Todos: ${LINK_DOS_TUTORIAIS}`);
confere("outros links ficam", conserta("Cadastro: firehubfood.com.br/cadastro") === "Cadastro: firehubfood.com.br/cadastro");
confere(
  "vídeo fora do ar vira a lista",
  consertarLinksDeVideo("https://firehubfood.com.br/tutoriais/app-motoboy", new Set(["pedidos"])) === LINK_DOS_TUTORIAIS,
);

// ── Já mandados ────────────────────────────────────────────────────────────
const ja = videosJaEnviados([
  { direcao: "ENTRADA", texto: "firehubfood.com.br/tutoriais/fiado" },
  { direcao: "SAIDA", texto: "Esse vídeo mostra:\nhttps://firehubfood.com.br/tutoriais/roteirizacao?t=40" },
  { direcao: "SAIDA", texto: "E esse: https://firehubfood.com.br/tutoriais/kds e https://firehubfood.com.br/tutoriais/roteirizacao" },
]);
confere("já mandados: só os que SAÍRAM, sem repetir", JSON.stringify(ja.sort()) === JSON.stringify(["kds", "roteirizacao"]), JSON.stringify(ja));

// ── Lista e aula ───────────────────────────────────────────────────────────
const lista = listaDosVideos(VIDEOS);
confere("a lista tem o link de todos os vídeos", VIDEOS.every((v) => lista.includes(linkDoVideo(v.id))));
confere("a lista tem o link da página com todos", lista.includes(LINK_DOS_TUTORIAIS));
confere("lista vazia sem vídeo no ar", listaDosVideos([]) === "");
const rot = VIDEOS.find((v) => v.id === "roteirizacao");
if (rot) {
  const aula = aulaDoVideo(rot);
  confere("a aula tem um link por capítulo", rot.capitulos.every((c) => aula.includes(linkDoVideo(rot.id, c.em))));
  confere("a aula tem a fala (não só os títulos)", aula.length > rot.capitulos.map((c) => c.titulo).join("").length * 3);
}
console.log(`\nTamanho da lista na base: ${lista.length} caracteres (${VIDEOS.length} vídeos).`);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
