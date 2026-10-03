import { normalizar, formasDaPalavra, ehPalavraDeLigacao } from "@/lib/busca-nos-tutoriais";
import { duracaoEmMinutos, relogio, type Tutorial } from "@/lib/tutoriais";
import fala from "@/lib/tutoriais-busca.json";

/**
 * OS VÍDEOS TUTORIAIS NO ROBÔ DO FIREHUB.
 *
 * Pedido do Douglas (02/10/2026): "como eu mexo na roteirização?" → o robô
 * responde curto e manda o link do vídeo da Roteirização, direto no WhatsApp.
 * Qualquer dúvida que um vídeo pronto já explica vira o link dele.
 *
 * ── Por que a fala do vídeo é fonte ────────────────────────────────────────
 * Cada vídeo foi gravado no painel de verdade a partir de um roteiro
 * (tutoriais/roteiros): a gravação PARA quando o botão que a voz cita não
 * existe. O que a voz diz é o manual mais conferido que o FireHub tem, e o
 * revisor (conferente.ts) aceita como fonte.
 *
 * ── Por que não vai tudo no prompt ─────────────────────────────────────────
 * A fala dos vídeos passa de 50 mil caracteres. Em toda resposta, nas
 * chamadas do robô e na do revisor, isso triplicaria o custo (e o
 * gemini-3.6-flash dobra de preço em 2027). Então:
 *   - a LISTA (título, capítulos, link) vai sempre: é por ela que o robô sabe
 *     que existe vídeo de quê;
 *   - a FALA vai só dos vídeos que a busca abaixo acha para a conversa (até 2),
 *     e o robô pede a de outro pela ferramenta ver_tutorial.
 *
 * Este arquivo não lê disco: quem diz quais vídeos já estão no servidor é
 * videos-no-ar.ts. Assim o teste (scripts/teste-videos-do-robo.ts) roda sem
 * banco e sem a pasta de uploads.
 */

const SITE = "https://firehubfood.com.br";
export const LINK_DOS_TUTORIAIS = `${SITE}/tutoriais`;

/** O endereço público do vídeo; `em` (segundos) abre direto no capítulo. */
export function linkDoVideo(id: string, em = 0): string {
  const s = Math.max(0, Math.floor(Number(em) || 0));
  return `${SITE}/tutoriais/${id}${s > 0 ? `?t=${s}` : ""}`;
}

type Fala = Record<string, { em: number; texto: string }[]>;
const FALA = fala as Fala;

/** A lista que vai na BASE: um vídeo por item, com o link e os capítulos. */
export function listaDosVideos(videos: Tutorial[]): string {
  if (!videos.length) return "";
  const itens = videos.map(
    (t) => `- ${t.titulo} (${duracaoEmMinutos(t.duracao)}): ${linkDoVideo(t.id)}\n  Capítulos: ${t.capitulos.map((c) => c.titulo).join("; ")}.`,
  );
  return `# Vídeos tutoriais do painel
Gravados no painel de verdade, numa loja de demonstração. Cada link abre no celular sem login, com os capítulos para pular direto ao ponto. A lista com todos: ${LINK_DOS_TUTORIAIS}
${itens.join("\n")}`;
}

/** O que o vídeo ensina, capítulo por capítulo (a fala gravada), com o link que abre em cada um. */
export function aulaDoVideo(t: Tutorial): string {
  const falas = FALA[t.id] || [];
  const capitulos = t.capitulos.map((c, i) => {
    const texto = String(falas[i]?.texto || "").replace(/\s+/g, " ").trim();
    return `- ${relogio(c.em)} ${c.titulo} (${linkDoVideo(t.id, c.em)}): ${texto}`;
  });
  return `## ${t.titulo} (${duracaoEmMinutos(t.duracao)}): ${linkDoVideo(t.id)}\n${capitulos.join("\n")}`;
}

// ── QUAL VÍDEO RESPONDE A CONVERSA ─────────────────────────────────────────
//
// A busca da central de tutoriais (lib/busca-nos-tutoriais.ts) exige que TODA
// palavra apareça no vídeo — certo para quem digita "app motoboy" numa caixa de
// busca, errado para mensagem de WhatsApp: em "como eu mexo na roteirização?",
// "mexo" não está em vídeo nenhum e nada voltaria. Aqui cada palavra soma
// pontos, pesados pela raridade: "roteirização" (um vídeo) vale muito mais que
// "pedido" (quase todos). Título pesa 3, título de capítulo 2, a fala 1.

/** Palavras de conversa que não dizem o assunto ("como eu mexo", "não tá aparecendo"). */
const DE_CONVERSA = new Set(
  ("oi ola opa bom boa dia tarde noite tudo bem obrigado obrigada valeu ok certo sim nao ne ta to tah esta estou isso esse essa " +
    "este aqui ali la ai voce vc vcs gente ja agora hoje mexo mexer mexe consigo consegue conseguir sei saber sabe queria quero qro " +
    "gostaria preciso precisa ajuda ajudar duvida explicar explica mostra mostrar sistema painel firehub tela botao aparece " +
    "aparecendo funciona funcionar coisa coisas algum alguma tipo jeito favor mim me nosso nossa vou vai pode posso tenho " +
    "quanto quanta quais faco fiz fica ficar fico dou dar coloco colocar coloca mudo mudar muda alterar altera vejo pq porque " +
    "blz td tb tbm entao assim mesmo muito melhor criar crio cria")
    .split(" "),
);

/** O que o gateway escreve no lugar da mídia (entrada.ts) não diz assunto nenhum. */
const SO_MIDIA = /^(?:📷 Imagem|🎬 Vídeo|🎤 Áudio \(não consegui transcrever[^)]*\))$/u;

/** O singular, do jeito simples: "cupons" → "cupom", "integrações" → "integracao", "pedidos" → "pedido". */
function singular(p: string): string {
  if (p.length <= 3) return p;
  if (p.endsWith("oes") || p.endsWith("aes")) return `${p.slice(0, -3)}ao`;
  if (p.endsWith("ais")) return `${p.slice(0, -3)}al`;
  if (p.endsWith("eis")) return `${p.slice(0, -3)}el`;
  if (p.endsWith("ns")) return `${p.slice(0, -2)}m`;
  if (p.endsWith("res") || p.endsWith("zes")) return p.slice(0, -2);
  if (p.endsWith("s") && !p.endsWith("ss")) return p.slice(0, -1);
  return p;
}

/**
 * Mesma palavra: igual no singular ("motoboys" ~ "motoboy", "cupons" ~ "cupom")
 * ou, nas compridas, o mesmo começo com folga de 3 letras no fim ("roteirizar" ~
 * "roteirização", "imprime" ~ "imprimir"). Palavra curta não tem folga: com ela,
 * "preço" casava com "precisa", que está na fala de quase todo vídeo.
 */
function mesmaPalavra(a: string, b: string): boolean {
  if (a === b) return true;
  const sa = singular(a);
  const sb = singular(b);
  if (sa === sb) return true;
  const menor = Math.min(sa.length, sb.length);
  if (menor < 6) return false;
  let comum = 0;
  while (comum < menor && sa[comum] === sb[comum]) comum++;
  return comum >= Math.max(5, menor - 3);
}

const bate = (palavras: string[], formas: string[]) => palavras.some((p) => formas.some((f) => mesmaPalavra(f, p)));

/**
 * Um assunto da mensagem: as palavras que a pessoa escreveu e os sinônimos
 * delas. A palavra escrita vale inteira; só o sinônimo vale 0,6 — a busca da
 * central põe "cupom" junto de "nota" (cupom fiscal), e "como ligo a nota
 * fiscal" trazia Marketing ("Marketing e cupons") empatado com Fiscal.
 */
type Assunto = { escritas: string[]; formas: string[] };

function acerto(palavras: string[], a: Assunto): number {
  if (bate(palavras, a.escritas)) return 1;
  return bate(palavras, a.formas) ? 0.6 : 0;
}

type PalavrasDoVideo = { titulo: string[]; capitulos: string[]; fala: string[] };
const cacheDasPalavras = new Map<string, PalavrasDoVideo>();

function palavrasDoVideo(t: Tutorial): PalavrasDoVideo {
  const chave = `${t.id}/${t.versao}`;
  const guardada = cacheDasPalavras.get(chave);
  if (guardada) return guardada;
  const unicas = (texto: string) => [...new Set(normalizar(texto).split(" ").filter((p) => p.length >= 2))];
  const p = {
    titulo: unicas(t.titulo),
    capitulos: unicas(t.capitulos.map((c) => c.titulo).join(" ")),
    fala: unicas((FALA[t.id] || []).map((f) => f.texto).join(" ")),
  };
  cacheDasPalavras.set(chave, p);
  return p;
}

/** Os assuntos da mensagem: cada palavra que conta, com os sinônimos dela (um grupo de sinônimos conta uma vez). */
function assuntosDe(texto: string): Assunto[] {
  const porGrupo = new Map<string, Assunto>();
  for (const palavra of normalizar(texto).split(" ")) {
    if (palavra.length < 2 || /^\d+$/.test(palavra) || ehPalavraDeLigacao(palavra)) continue;
    if (DE_CONVERSA.has(palavra) || DE_CONVERSA.has(singular(palavra))) continue;
    const formas = formasDaPalavra(palavra);
    const chave = formas.join("|");
    const visto = porGrupo.get(chave);
    if (!visto) porGrupo.set(chave, { escritas: [palavra], formas });
    else if (!visto.escritas.includes(palavra)) visto.escritas.push(palavra);
  }
  return [...porGrupo.values()];
}

/** Pontuação mínima: um acerto no título com palavra que não está em metade dos vídeos já passa. */
const MINIMO = 3;

/**
 * Os vídeos que parecem responder o que o contato escreveu, o melhor primeiro
 * (até `maximo`). Só entra vídeo em que alguma palavra da mensagem bate no
 * TÍTULO ou num CAPÍTULO: a fala só desempata. Palavra rara que aparece de
 * passagem numa fala ("custa") puxava vídeo para "quanto custa o sistema?".
 */
export function videosParaAConversa(textos: string[], videos: Tutorial[], maximo = 2): Tutorial[] {
  // Localização (📍 + endereço) e mídia sem legenda não dizem o assunto: nome de rua batia em capítulo.
  const comAssunto = textos.map((t) => String(t || "").trim()).filter((t) => t && !t.startsWith("📍") && !SO_MIDIA.test(t));
  const assuntos = assuntosDe(comAssunto.join(" "));
  if (!assuntos.length || !videos.length) return [];
  const docs = videos.map((t) => ({ t, p: palavrasDoVideo(t) }));
  const pontos = new Map<string, number>();
  const peloNome = new Set<string>();
  for (const assunto of assuntos) {
    const pesos = docs.map(({ p }) => {
      const noTitulo = 3 * acerto(p.titulo, assunto);
      const noCapitulo = 2 * acerto(p.capitulos, assunto);
      return { peso: Math.max(noTitulo, noCapitulo, acerto(p.fala, assunto)), peloNome: noTitulo > 0 || noCapitulo > 0 };
    });
    const emQuantos = pesos.filter((x) => x.peso > 0).length;
    if (!emQuantos) continue;
    const raridade = Math.log(1 + docs.length / emQuantos);
    docs.forEach(({ t }, i) => {
      if (!pesos[i].peso) return;
      pontos.set(t.id, (pontos.get(t.id) || 0) + pesos[i].peso * raridade);
      if (pesos[i].peloNome) peloNome.add(t.id);
    });
  }
  const ordem = docs
    .map(({ t }) => ({ t, pontos: pontos.get(t.id) || 0 }))
    .filter((x) => peloNome.has(x.t.id) && x.pontos >= MINIMO)
    .sort((a, b) => b.pontos - a.pontos);
  if (!ordem.length) return [];
  // O segundo só entra se estiver perto do primeiro: "imprimir" não pode trazer
  // de carona o vídeo de Pedidos (que fala de imprimir de passagem).
  return ordem.filter((x) => x.pontos >= ordem[0].pontos * 0.6).slice(0, maximo).map((x) => x.t);
}

// ── O LINK QUE SAI É SEMPRE UM QUE EXISTE ──────────────────────────────────
//
// O revisor confere o texto, mas link é coisa de máquina: endereço de vídeo
// inventado ("…/tutoriais/rotas") abriria página vazia no celular do lojista.
// Toda menção a /tutoriais/<id> é reescrita no formato canônico (com https,
// que é o que faz o WhatsApp mostrar a prévia), e id que não é de vídeo no ar
// vira a lista de todos.

const LINK_NO_TEXTO = /(?:https?:\/\/)?(?:www\.)?firehubfood\.com\.br\/tutoriais(?:\/([a-z0-9-]+))?\/?(?:\?t=(\d+))?/gi;

export function consertarLinksDeVideo(texto: string, idsNoAr: ReadonlySet<string>): string {
  return String(texto || "").replace(LINK_NO_TEXTO, (_todo, id: string | undefined, t: string | undefined) => {
    const certo = String(id || "").toLowerCase();
    return certo && idsNoAr.has(certo) ? linkDoVideo(certo, Number(t) || 0) : LINK_DOS_TUTORIAIS;
  });
}

/** Os vídeos que o FireHub já mandou nesta conversa (pelo link nas mensagens que saíram). */
export function videosJaEnviados(historico: { direcao: string; texto: string }[]): string[] {
  const ids = new Set<string>();
  for (const m of historico) {
    if (m.direcao !== "SAIDA") continue;
    for (const r of String(m.texto || "").matchAll(/firehubfood\.com\.br\/tutoriais\/([a-z0-9-]+)/gi)) ids.add(r[1].toLowerCase());
  }
  return [...ids];
}
