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
  /** Gravado em tela de celular (o app do motoboy): o player mostra em pé. */
  emPe?: boolean;
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
  // O caixa abre e fecha pelo botão da barra do topo e não tem tela própria (só o histórico):
  // o vídeo dele aparece também no Balcão, que é onde o caixa fechado trava a venda.
  "/store/venda-presencial": ["balcao", "caixa"],
  "/store/caixa": ["caixa"],
  "/store/cardapio": ["cardapio-produto", "cardapio-pizza", "cardapio-combos", "cardapio-precos", "cardapio-organizar"],
  "/store/fiscal": ["fiscal"],
  "/store/impressoras": ["impressoras"],
  "/store/minha-loja": ["horarios", "entrega", "pagamento", "equipe", "fidelidade"],
  "/store/integracoes": ["integracoes"],
  "/store/extensao-ifood": ["extensao-ifood", "extensao-ifood-ao-vivo"],
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
  // O app do entregador não é tela do painel (/loja/<slug>/motoboy): o botão dele passa a rota.
  "/motoboy-app": ["app-motoboy"],
};

/**
 * O nome da tela no botão ("Tutorial Pedidos", "Tutorial KDS Cozinha"). Pedido
 * do Douglas em 02/10/2026: só "Tutorial" não dizia DE QUÊ — o lojista precisa
 * ler no botão que aquele vídeo é o da tela em que ele está. Nome curto, como
 * o do menu (lib/menu-do-painel.ts), porque mora na barra do topo.
 */
const NOMES: Record<string, string> = {
  "/store": "Início",
  "/store/pedidos-clientes": "Pedidos",
  "/store/kds": "KDS Cozinha",
  "/store/mesas": "Mesas",
  "/store/venda-presencial": "Balcão",
  "/store/caixa": "Caixa",
  "/store/cardapio": "Cardápio",
  "/store/fiscal": "Fiscal",
  "/store/impressoras": "Impressoras",
  "/store/minha-loja": "Minha loja",
  "/store/integracoes": "Integrações",
  "/store/extensao-ifood": "Extensão iFood",
  "/store/chatbot": "Chatbot",
  "/store/roteirizacao": "Roteirização",
  "/store/motoboys": "Motoboys",
  "/store/garcons": "Garçons",
  "/store/marketing": "Marketing",
  "/store/estoque": "Estoque",
  "/store/financeiro": "Financeiro",
  "/store/relatorios": "Relatórios",
  "/store/etiquetas": "Etiquetas",
  "/store/funcionarios": "Fiado",
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
 * Onde os arquivos de vídeo moram. Em produção, o volume de uploads do
 * servidor (`/uploads/tutoriais`, enviados por /api/admin/tutoriais). A
 * gravação local usa a pasta public (`NEXT_PUBLIC_TUTORIAIS_URL=/tutoriais`),
 * e um armazenamento externo seria só trocar a variável.
 *
 * Os vídeos não entram no repositório. O botão de uma tela só aparece quando o
 * vídeo dela já chegou ao servidor (lib/tutoriais-no-servidor.ts): deploy sem
 * os vídeos não mostra botão quebrado.
 */
export const BASE_DOS_TUTORIAIS = (process.env.NEXT_PUBLIC_TUTORIAIS_URL || "/uploads/tutoriais").replace(/\/+$/, "");
const BASE = BASE_DOS_TUTORIAIS;

export const ARQUIVOS_DO_TUTORIAL = ["video.mp4", "capa.jpg", "legendas.vtt"] as const;

/** Ids que já estão no servidor; null = todos (não há como saber). */
export type TutoriaisEnviados = ReadonlySet<string> | null;
const enviado = (enviados: TutoriaisEnviados) => (t: Tutorial | undefined): t is Tutorial => !!t && (!enviados || enviados.has(t.id));

/** A rota de TELAS que a URL está mostrando — a mais específica vence. */
function telaDaRota(pathname: string | null | undefined): string {
  const p = String(pathname || "");
  let achada = "";
  for (const rota of Object.keys(TELAS)) {
    // "/store" é o Início e só casa exato: senão o passeio geral apareceria em toda tela sem vídeo.
    const casa = p === rota || (rota !== "/store" && p.startsWith(`${rota}/`));
    if (casa && rota.length > achada.length) achada = rota;
  }
  return achada;
}

/** Os vídeos da tela que a rota está mostrando. */
export function tutoriaisDaTela(pathname: string | null | undefined, enviados: TutoriaisEnviados = null): Tutorial[] {
  const achada = telaDaRota(pathname);
  if (!achada) return [];
  return TELAS[achada].map((id) => FICHAS[id]).filter(enviado(enviados));
}

/**
 * Todos os vídeos, na ordem da central de tutoriais (components/CentralDeTutoriais):
 * a janela de orientação que abre depois do login e mostra um vídeo depois do
 * outro. Os grupos são os do menu (lib/menu-do-painel.ts), na ordem em que o
 * lojista novo precisa: primeiro operar, depois o cardápio, por último ajustes.
 */
const GRUPOS: { titulo: string; ids: string[] }[] = [
  { titulo: "Operação", ids: ["inicio", "pedidos", "kds", "mesas", "balcao", "caixa", "roteirizacao"] },
  { titulo: "Cardápio", ids: ["cardapio-produto", "cardapio-pizza", "cardapio-combos", "cardapio-precos", "cardapio-organizar"] },
  { titulo: "Vendas", ids: ["marketing", "chatbot"] },
  { titulo: "Gestão", ids: ["financeiro", "relatorios", "fiscal", "estoque", "etiquetas"] },
  { titulo: "Equipe", ids: ["motoboys", "app-motoboy", "garcons", "fiado"] },
  { titulo: "Configurações", ids: ["horarios", "entrega", "pagamento", "equipe", "fidelidade", "impressoras", "integracoes", "extensao-ifood", "extensao-ifood-ao-vivo"] },
];

export function todosOsTutoriais(enviados: TutoriaisEnviados = null): { titulo: string; tutoriais: Tutorial[] }[] {
  return GRUPOS.map((g) => ({ titulo: g.titulo, tutoriais: g.ids.map((id) => FICHAS[id]).filter(enviado(enviados)) }))
    .filter((g) => g.tutoriais.length > 0);
}

/** A ficha de um vídeo pelo id (o fim do link público /tutoriais/<id>). */
export function tutorialPorId(id: string): Tutorial | null {
  return Object.prototype.hasOwnProperty.call(FICHAS, id) ? FICHAS[id] : null;
}

/** O grupo da central em que o vídeo está ("Operação", "Cardápio"...) e os outros vídeos dele. */
export function grupoDoTutorial(id: string): { titulo: string; ids: string[] } | null {
  return GRUPOS.find((g) => g.ids.includes(id)) || null;
}

/** O nome que vai no botão: "Tutorial Pedidos". */
export function nomeDaTela(pathname: string | null | undefined): string {
  return NOMES[telaDaRota(pathname)] || "";
}

export function arquivosDoTutorial(t: Tutorial) {
  // A versão é pasta, não ?v=: cada gravação tem endereço próprio e cache eterno.
  const pasta = `${BASE}/${t.id}/${t.versao}`;
  return { video: `${pasta}/video.mp4`, capa: `${pasta}/capa.jpg`, legendas: `${pasta}/legendas.vtt` };
}

/**
 * Os títulos sem o prefixo que todos os vídeos da tela repetem: no cartão,
 * "Cardápio: cadastrar e editar um produto" vira "Cadastrar e editar um
 * produto" — o nome da tela já está escrito em cima, e o que diferencia um
 * vídeo do outro é o que precisa caber. Sem prefixo comum, fica o título inteiro.
 */
export function titulosCurtos(tutoriais: Tutorial[]): string[] {
  const prefixos = tutoriais.map((t) => /^([^:]{2,30}):\s+\S/.exec(t.titulo)?.[1] ?? null);
  const comum = tutoriais.length > 1 && prefixos[0] && prefixos.every((p) => p === prefixos[0]) ? prefixos[0] : null;
  return tutoriais.map((t) => {
    if (!comum) return t.titulo;
    const resto = t.titulo.slice(comum.length).replace(/^:\s+/, "");
    return resto.charAt(0).toUpperCase() + resto.slice(1);
  });
}

/** "3 min", "1 min" — arredondado para cima: ninguém se sente enganado por sobrar tempo. */
export function duracaoEmMinutos(segundos: number): string {
  return `${Math.max(1, Math.ceil(segundos / 60))} min`;
}

export function relogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * "Fechar" a central de tutoriais vale até o próximo login: a marca é um cookie
 * de sessão (some quando o navegador fecha) e o login apaga a marca ao entrar.
 * "Já vi, não mostrar mais" é outra coisa e mora no localStorage, por usuário.
 */
export const MARCA_CENTRAL_FECHADA = "fh_central_tutoriais_fechada";
export const CHAVE_CENTRAL_NAO_MOSTRAR = "fh_central_tutoriais_nao_mostrar:";

export function esquecerCentralFechada() {
  try {
    document.cookie = `${MARCA_CENTRAL_FECHADA}=; Max-Age=0; path=/; SameSite=Lax`;
  } catch {}
}
