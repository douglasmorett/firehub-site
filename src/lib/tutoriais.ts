/**
 * Os tutoriais em vídeo do painel — de qual tela é cada vídeo.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * O lojista abre uma tela, não entende um botão e chama o suporte. O vídeo
 * curto no topo da própria tela responde na hora, sem ninguém do outro lado.
 *
 * ── Uma lista só ────────────────────────────────────────────────────────────
 * A tela não declara o próprio vídeo: quem liga a ROTA ao vídeo é este arquivo,
 * e o botão (components/TutorialDaTela) mora uma vez só, na barra do topo.
 * Vídeo novo = uma linha em TELAS. O botão aparece sozinho na tela certa e
 * fica sempre no mesmo lugar, que é como o lojista aprende onde procurar.
 *
 * ── De onde vêm título, duração e capítulos ────────────────────────────────
 * De tutoriais-fichas.json, que NÃO se edita à mão: quem escreve é
 * `node tutoriais/publicar.mjs <id>`, a partir da gravação. Tela listada aqui
 * sem ficha publicada simplesmente não mostra botão.
 */
import fichas from "./tutoriais-fichas.json";

export type CapituloDoTutorial = { em: number; titulo: string };

export type Tutorial = {
  id: string;
  titulo: string;
  /** Segundos. */
  duracao: number;
  capitulos: CapituloDoTutorial[];
  /** Muda a cada regravação: entra no endereço para o navegador não mostrar o vídeo velho. */
  versao: string;
};

/**
 * Rota do painel → vídeos daquela tela, na ordem em que aparecem.
 * Tela grande (Cardápio) leva vários vídeos curtos em vez de um longo.
 */
const TELAS: Record<string, string[]> = {
  "/store": ["inicio"],
  "/store/pedidos-clientes": ["pedidos"],
  "/store/kds": ["kds"],
  "/store/mesas": ["mesas"],
  "/store/venda-presencial": ["balcao"],
  "/store/caixa": ["caixa"],
  "/store/cardapio": ["cardapio-produto", "cardapio-precos", "cardapio-combos", "cardapio-organizar"],
  "/store/fiscal": ["fiscal"],
  "/store/impressoras": ["impressoras"],
  "/store/minha-loja": ["horarios", "entrega", "pagamento", "equipe", "fidelidade"],
  "/store/integracoes": ["integracoes"],
  "/store/chatbot": ["chatbot"],
  "/store/roteirizacao": ["roteirizacao"],
  "/store/motoboys": ["motoboys"],
  "/store/garcons": ["garcons"],
  "/store/marketing": ["marketing"],
  "/store/estoque": ["estoque"],
  "/store/financeiro": ["financeiro"],
  "/store/relatorios": ["relatorios"],
  "/store/etiquetas": ["etiquetas"],
  "/store/funcionarios": ["fiado"],
};

/**
 * Em Minha loja, cada seção tem o seu vídeo: a âncora da URL (#entrega) escolhe
 * qual abre primeiro. Sem âncora conhecida, abre o primeiro da lista.
 */
const ANCORA: Record<string, string> = {
  horarios: "#horarios",
  entrega: "#entrega",
  pagamento: "#pagamento",
  equipe: "#equipe",
  fidelidade: "#fidelidade",
};

/** Qual vídeo da lista abrir primeiro, dada a âncora da URL. */
export function indiceInicial(tutoriais: Tutorial[], hash: string | null | undefined): number {
  const i = tutoriais.findIndex((t) => ANCORA[t.id] && ANCORA[t.id] === hash);
  return i >= 0 ? i : 0;
}

const FICHAS = fichas as Record<string, Tutorial>;

/**
 * Onde os arquivos de vídeo moram: NEXT_PUBLIC_TUTORIAIS_URL.
 *
 * Sem a variável, NENHUM botão aparece. É de propósito: os vídeos não entram
 * no repositório, então um deploy deste código sem a hospedagem decidida
 * mostraria um botão que abre um vídeo inexistente. A variável é o interruptor
 * — "/tutoriais" para servir da pasta public do próprio site, ou o endereço do
 * armazenamento externo. Nenhuma tela muda quando ela muda.
 */
const BASE = (process.env.NEXT_PUBLIC_TUTORIAIS_URL || "").replace(/\/+$/, "");

/** Os vídeos da tela que a rota está mostrando — a rota mais específica vence. */
export function tutoriaisDaTela(pathname: string | null | undefined): Tutorial[] {
  if (!BASE) return [];
  const p = String(pathname || "");
  let achada = "";
  for (const rota of Object.keys(TELAS)) {
    // "/store" é o Início e só casa exato: senão o passeio geral apareceria em toda tela sem vídeo.
    const casa = p === rota || (rota !== "/store" && p.startsWith(`${rota}/`));
    if (casa && rota.length > achada.length) achada = rota;
  }
  if (!achada) return [];
  return TELAS[achada].map((id) => FICHAS[id]).filter(Boolean);
}

export function arquivosDoTutorial(t: Tutorial) {
  const pasta = `${BASE}/${t.id}`;
  const v = `?v=${t.versao}`;
  return { video: `${pasta}/video.mp4${v}`, capa: `${pasta}/capa.jpg${v}`, legendas: `${pasta}/legendas.vtt${v}` };
}

/** "3 min", "1 min" — arredondado para cima: ninguém se sente enganado por sobrar tempo. */
export function duracaoEmMinutos(segundos: number): string {
  return `${Math.max(1, Math.ceil(segundos / 60))} min`;
}

export function relogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
