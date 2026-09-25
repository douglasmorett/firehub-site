/**
 * A localização que o cliente manda pelo WhatsApp (📎 → Localização).
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * Loja que cobra por km (Divinos Burger, modo ROTA) depende de um PONTO para
 * cobrar certo, e o ponto mais confiável que existe é o do próprio aparelho do
 * cliente. Até 25/09/2026 o robô não via esse ponto: o gateway só lia texto,
 * legenda e áudio, e descartava a mensagem de localização sem nem avisar o
 * webhook (auditoria do caminho da mensagem, whatsapp-gateway/server.js). O
 * cliente mandava o alfinete, o robô ficava mudo, e o endereço digitado seguia
 * sendo geocodificado pelo texto — que é onde nascem o "centro do bairro" e a
 * rua homônima do outro lado da cidade.
 *
 * Agora a localização:
 *   1. chega ao webhook (o gateway encaminha `locationMessage`);
 *   2. vira uma linha de texto na conversa — o modelo lê e o histórico guarda,
 *      e é esse texto que sobrevive a deploy (memória da conversa no banco);
 *   3. vai como `coords` para `avaliarEntrega`, na cotação e na gravação.
 *
 * O texto da linha é também o formato que `localizacaoNoTexto` lê de volta:
 * um formato só, testado nos dois sentidos.
 *
 * Arquivo puro, sem imports: o teste o carrega sozinho
 * (scripts/teste-localizacao-do-whatsapp.mjs).
 */

export type LocalizacaoDoCliente = {
  lat: number;
  lng: number;
  /** Nome do lugar, quando o cliente escolheu um ponto da lista ("Padaria X"). */
  nome?: string;
  /** Endereço que o próprio WhatsApp anexou ao ponto. */
  endereco?: string;
  /** Localização em tempo real (liveLocationMessage). */
  aoVivo?: boolean;
};

/**
 * Coordenada que dá para usar. (0,0) é o Atlântico — é "não sei" disfarçado de
 * número, e chega assim de integração que preenche com zero em vez de omitir.
 */
export function coordenadaValida(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" && typeof lat !== "string") return false;
  if (typeof lng !== "number" && typeof lng !== "string") return false;
  if (typeof lat === "string" && !lat.trim()) return false;
  if (typeof lng === "string" && !lng.trim()) return false;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return false;
  if (a === 0 && b === 0) return false;
  return true;
}

/** Texto curto e limpo: sem quebra de linha, sem parêntese (que o formato da linha usa). */
function textoCurto(v: unknown, max = 120): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\r\n()]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

/**
 * Tira os envelopes que o WhatsApp põe em volta do conteúdo: mensagem
 * temporária (ephemeral), de visualização única e documento com legenda. Sem
 * isto, a localização de quem usa mensagens temporárias sumia do mesmo jeito.
 */
export function desembrulharMensagem(message: any): any {
  let atual = message;
  for (let i = 0; i < 5 && atual && typeof atual === "object"; i++) {
    const dentro =
      atual.ephemeralMessage?.message ||
      atual.viewOnceMessage?.message ||
      atual.viewOnceMessageV2?.message ||
      atual.viewOnceMessageV2Extension?.message ||
      atual.documentWithCaptionMessage?.message;
    if (!dentro) break;
    atual = dentro;
  }
  return atual;
}

/** A localização dentro de uma mensagem do WhatsApp (formato Baileys/Evolution), ou null. */
export function localizacaoDaMensagem(message: any): LocalizacaoDoCliente | null {
  const conteudo = desembrulharMensagem(message);
  if (!conteudo || typeof conteudo !== "object") return null;
  const fixa = conteudo.locationMessage;
  const aoVivo = conteudo.liveLocationMessage;
  const bruta = fixa || aoVivo;
  if (!bruta || typeof bruta !== "object") return null;
  const lat = bruta.degreesLatitude ?? bruta.latitude ?? bruta.lat;
  const lng = bruta.degreesLongitude ?? bruta.longitude ?? bruta.lng;
  if (!coordenadaValida(lat, lng)) return null;
  const loc: LocalizacaoDoCliente = { lat: Number(lat), lng: Number(lng) };
  const nome = textoCurto(bruta.name);
  const endereco = textoCurto(bruta.address);
  if (nome) loc.nome = nome;
  if (endereco) loc.endereco = endereco;
  if (!fixa && aoVivo) loc.aoVivo = true;
  return loc;
}

/**
 * A localização do payload do webhook. Aceita o campo `localizacao` que o
 * gateway do FireHub manda pronto e, na falta dele, lê a própria mensagem —
 * a Evolution oficial manda só a mensagem.
 */
export function localizacaoDoPayload(data: any): LocalizacaoDoCliente | null {
  if (!data || typeof data !== "object") return null;
  const pronta = data.localizacao;
  if (pronta && typeof pronta === "object" && coordenadaValida(pronta.lat, pronta.lng)) {
    const loc: LocalizacaoDoCliente = { lat: Number(pronta.lat), lng: Number(pronta.lng) };
    const nome = textoCurto(pronta.nome);
    const endereco = textoCurto(pronta.endereco);
    if (nome) loc.nome = nome;
    if (endereco) loc.endereco = endereco;
    if (pronta.aoVivo === true) loc.aoVivo = true;
    return loc;
  }
  return localizacaoDaMensagem(data.message);
}

/** O começo fixo da linha. É por ele que a localização é reconhecida no histórico. */
export const MARCA_DA_LOCALIZACAO = "📍 Localização enviada pelo WhatsApp:";

/**
 * A linha que entra na conversa no lugar da mensagem de localização.
 *
 * Seis casas decimais (~11 cm): é o que o aparelho manda de verdade, e a
 * coordenada de parceiro com menos de 3 casas é recusada como falsa em outro
 * ponto do sistema (R8 da especificação de 25/09/2026).
 */
export function textoDaLocalizacao(loc: LocalizacaoDoCliente): string {
  const ponto = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
  const detalhes = [loc.nome, loc.endereco].filter(Boolean).join(" — ");
  return `${MARCA_DA_LOCALIZACAO} ${ponto}${detalhes ? ` (${detalhes})` : ""}${loc.aoVivo ? " [em tempo real]" : ""}`;
}

const LINHA_DA_LOCALIZACAO = /📍\s*Localiza[çc][ãa]o enviada pelo WhatsApp:\s*(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:\s*\(([^)]*)\))?/;

/** Lê de volta a linha escrita por `textoDaLocalizacao`. */
export function localizacaoNoTexto(texto: unknown): LocalizacaoDoCliente | null {
  if (typeof texto !== "string" || !texto) return null;
  const m = texto.match(LINHA_DA_LOCALIZACAO);
  if (!m) return null;
  if (!coordenadaValida(m[1], m[2])) return null;
  const loc: LocalizacaoDoCliente = { lat: Number(m[1]), lng: Number(m[2]) };
  if (m[3]) {
    const [nome, ...resto] = m[3].split(" — ");
    if (nome?.trim()) loc.nome = nome.trim();
    if (resto.join(" — ").trim()) loc.endereco = resto.join(" — ").trim();
  }
  return loc;
}

/**
 * O texto sem as COORDENADAS das linhas de localização — fica só o nome e o
 * endereço que o WhatsApp anexou ao ponto.
 *
 * É o que vai como "endereço" para o mapa quando a coordenada já vai em
 * separado: "-22.854031, -42.029652" no meio do texto não ajuda a achar rua
 * nenhuma e pode confundir quem lê o endereço como texto.
 */
export function semCoordenadasDaLocalizacao(texto: unknown): string {
  if (typeof texto !== "string") return "";
  return texto
    .replace(new RegExp(LINHA_DA_LOCALIZACAO.source, "g"), (_m, _lat, _lng, detalhes) => (detalhes ? String(detalhes) : " "))
    .replace(/\[em tempo real\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Só o que o cliente DIGITOU: a linha da localização sai inteira, com o nome e
 * o endereço que o WhatsApp anexou ao ponto.
 *
 * Esse nome é texto de terceiros (o cadastro do lugar no mapa), não fala do
 * cliente. Ele passava pelos detectores de "pediu atendente" e de reclamação
 * como se fosse: quem mandava a localização da "Suporte Técnico Informática",
 * onde trabalha, pausava o robô e chamava a equipe (revisão de 25/09/2026).
 */
export function semLinhaDaLocalizacao(texto: unknown): string {
  if (typeof texto !== "string") return "";
  return texto
    .replace(new RegExp(LINHA_DA_LOCALIZACAO.source + "(?:\\s*\\[em tempo real\\])?", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** O tipo de rua seguido de um nome: "Rua X", "Av. Y", "Travessa Canaã". */
const TIPO_DE_RUA_COM_NOME = /\b(?:rua|r\.|avenida|av\.?|travessa|tv\.?|alameda|al\.|estrada|est\.|rodovia|rod\.|pra[çc]a|largo|beco|servid[ãa]o|viela|ladeira)\s+\S/i;

/**
 * O endereço, a partir das falas do cliente que parecem endereço (em ordem de
 * chegada): a mais recente — e, quando ela não traz a rua ("bairro Boca do
 * Mato", "casa 2"), junto das anteriores desde a última que traz. Duas falas
 * com rua são TROCA de endereço: vale só a última. Juntar "Rua A, 10" com
 * "Rua B, 20" num texto só era mandar ao mapa um endereço que não existe. E
 * pergunta sem rua ("vcs entregam no meu bairro?") não é complemento: não
 * entra na junção.
 */
export function enderecoDasFalas(falas: readonly string[]): string {
  const f = falas.map((t) => String(t || "").trim()).filter(Boolean);
  if (!f.length) return "";
  const ultima = f[f.length - 1];
  if (TIPO_DE_RUA_COM_NOME.test(ultima)) return ultima;
  const naoEPergunta = (t: string) => !/\?\s*$/.test(t);
  for (let i = f.length - 2; i >= 0; i--) {
    if (TIPO_DE_RUA_COM_NOME.test(f[i])) return [f[i], ...f.slice(i + 1).filter(naoEPergunta)].join(" ");
  }
  return f.filter(naoEPergunta).slice(-2).join(" ") || ultima;
}

/** A janela do cooldown do webhook: mensagem que chega antes disto depois da última resposta é descartada. */
export const JANELA_DO_COOLDOWN_MS = 3000;

/**
 * O webhook pode descartar esta mensagem pelo cooldown?
 *
 * Nunca a LOCALIZAÇÃO. Ela chega justamente logo depois da resposta: "vou
 * mandar minha localização" → o robô responde → 📎 → Localização → Enviar, 2 s
 * depois. Descartada, ia só para o painel e não entrava no histórico em
 * memória, de onde o robô a lê — e na mensagem seguinte ele pedia a
 * localização de novo ou cotava pelo texto (revisão de 25/09/2026). O gateway
 * já a isentava do cooldown dele. Nem o pedido de atendente (18/09/2026).
 */
export function descartavelNoCooldown(e: { msDesdeAUltimaResposta: number; temLocalizacao: boolean; pediuAtendente: boolean }): boolean {
  return e.msDesdeAUltimaResposta < JANELA_DO_COOLDOWN_MS && !e.temLocalizacao && !e.pediuAtendente;
}

type MensagemDoHistorico = { sender?: string; text?: string };

/** A localização em vigor, com o endereço que o cliente escreveu DEPOIS dela. */
export type LocalizacaoVigente = LocalizacaoDoCliente & {
  /**
   * O endereço que o cliente digitou depois de mandar o ponto — em geral a
   * resposta ao "me diz a rua e o número" que o próprio robô pede. Quem chama
   * confere no mapa se ele cai perto do ponto (complemento do mesmo lugar) ou
   * longe (outro lugar): `pontoDaEntregaDoRobo`, em lib/entrega-do-robo.ts.
   */
  enderecoDigitadoDepois?: string;
};

export type EstadoDaLocalizacao = {
  localizacao: LocalizacaoVigente | null;
  /**
   * O cliente disse, depois do ponto, que a entrega é em OUTRO lugar ("na
   * verdade entrega no...", "outro endereço", "a localização está errada").
   * O ponto não vale mais — nem o que o rascunho guardou dele.
   */
  descartadaPeloCliente: boolean;
};

/** Palavra inteira, sem `\b` (que não enxerga letra acentuada sem a flag u). */
const FIM_DE_PALAVRA = "(?![a-zà-úç])";

/**
 * O cliente está dizendo que a entrega NÃO é no ponto que ele mandou?
 *
 * Só frase de MUDANÇA conta. "Casa da minha mãe" sozinho não conta: pode ser
 * justamente a descrição do ponto que ele acabou de mandar. "Outra casa" e
 * "outra rua" também não ("é a outra casa do terreno", "a entrada é pela outra
 * rua" são complemento do mesmo lugar). E "na verdade" só vale junto de
 * entregar/mandar/levar: "na verdade é o número 45" corrige o número, não o
 * lugar.
 */
export function clienteIndicaOutroLugar(texto: unknown): boolean {
  if (typeof texto !== "string" || !texto.trim()) return false;
  const t = texto.toLowerCase();
  return (
    new RegExp(`\\boutr[oa]s?\\s+(?:endere[çc]o|lugar|local|bairro)${FIM_DE_PALAVRA}`).test(t) ||
    new RegExp(`\\b(?:endere[çc]o|local|lugar)\\s+(?:diferente|novo)${FIM_DE_PALAVRA}|\\bnov[oa]\\s+endere[çc]o${FIM_DE_PALAVRA}`).test(t) ||
    new RegExp(`\\bmud(?:ei|ou|ar|a)\\s+(?:o\\s+|de\\s+)?endere[çc]o${FIM_DE_PALAVRA}`).test(t) ||
    /\bna\s+verdade\b[^.?!\n]{0,30}?\b(?:entreg|mand|lev)/.test(t) ||
    /\blocaliza[çc][ãa]o\s+(?:(?:est[áa]|t[áa]|saiu|foi|veio)\s+)?errad/.test(t) ||
    /\bmandei\s+(?:a\s+)?(?:localiza[çc][ãa]o\s+)?errad/.test(t) ||
    new RegExp(`\\bn[ãa]o\\s+(?:é|e|eh)\\s+(?:mais\\s+)?(?:a[íi]|aqui|nesse|nessa|neste|nesta)${FIM_DE_PALAVRA}|\\bn[ãa]o\\s+(?:é|e|eh)\\s+(?:essa|esta)\\s+localiza`).test(t)
  );
}

/**
 * A localização que vale AGORA para esta conversa.
 *
 * Vale a mais recente. Até 25/09/2026 qualquer texto com cara de endereço
 * digitado DEPOIS dela a derrubava — inclusive a rua e o número que o robô
 * pede logo depois de receber o ponto ("o entregador precisa do endereço
 * escrito"). O fluxo feito para o endereço que o mapa não acha se desfazia na
 * mensagem seguinte: "Travessa Canaã, 6 - Boca do Mato" (Divinos) voltava a
 * ser procurado pelo texto, dava "não achei", e o robô pedia a localização DE
 * NOVO a quem tinha acabado de mandar. Até "vcs entregam no meu bairro?" e
 * "quantos km dá?" derrubavam o ponto.
 *
 * Agora o texto digitado depois é tratado como COMPLEMENTO do mesmo lugar e
 * volta em `enderecoDigitadoDepois` — quem chama confere no mapa se ele cai
 * longe (outro lugar) antes de trocar o ponto. Só a frase explícita de mudança
 * (`clienteIndicaOutroLugar`) descarta o ponto aqui.
 *
 * `pareceEndereco` é a régua de quem chama para separar o endereço escrito do
 * resto da conversa ("pix", "pode fechar").
 *
 * Só mensagens do CLIENTE contam: o robô nunca manda a própria localização, e
 * um texto dele citando coordenada não é o ponto de ninguém.
 */
export function estadoDaLocalizacao(
  historico: MensagemDoHistorico[] | null | undefined,
  mensagemAtual: string | null | undefined,
  pareceEndereco: (texto: string) => boolean,
): EstadoDaLocalizacao {
  const falasDoCliente = [
    ...(historico || []).filter((h) => h && h.sender === "user").map((h) => String(h.text || "")),
    String(mensagemAtual || ""),
  ];
  /** O que ele digitou depois do ponto, em ordem de chegada. */
  const depois: string[] = [];
  let descartada = false;
  for (let i = falasDoCliente.length - 1; i >= 0; i--) {
    const fala = falasDoCliente[i];
    if (!fala.trim()) continue;
    const loc = localizacaoNoTexto(fala);
    if (loc) {
      if (descartada) return { localizacao: null, descartadaPeloCliente: true };
      // Texto que veio na mesma mensagem da linha também é do cliente.
      const junto = semLinhaDaLocalizacao(fala);
      if (junto && pareceEndereco(junto)) depois.unshift(junto);
      const vigente: LocalizacaoVigente = { ...loc };
      const digitado = enderecoDasFalas(depois.slice(-3));
      if (digitado) vigente.enderecoDigitadoDepois = digitado;
      return { localizacao: vigente, descartadaPeloCliente: false };
    }
    if (clienteIndicaOutroLugar(fala)) descartada = true;
    if (pareceEndereco(fala)) depois.unshift(fala.trim());
  }
  return { localizacao: null, descartadaPeloCliente: false };
}

/** Atalho: só a localização vigente (ou null). Ver `estadoDaLocalizacao`. */
export function localizacaoVigente(
  historico: MensagemDoHistorico[] | null | undefined,
  mensagemAtual: string | null | undefined,
  pareceEndereco: (texto: string) => boolean,
): LocalizacaoVigente | null {
  return estadoDaLocalizacao(historico, mensagemAtual, pareceEndereco).localizacao;
}

/**
 * O pedido de localização que o robô manda. Fixo de propósito: é por ele que
 * se sabe que a pergunta já foi feita (`roboJaPediuLocalizacao`) — e a segunda
 * vez não repete, segura o pedido para a loja.
 */
export const COMO_MANDAR_A_LOCALIZACAO = "É só tocar no 📎 (clipe) → Localização → Enviar localização atual.";

/**
 * O robô já PEDIU a localização nesta conversa?
 *
 * Conta só o pedido com o CAMINHO do clipe — a frase fixa acima, que o prompt
 * (ponto aproximado, endereço não achado) e a gravação do pedido mandam usar,
 * ou o modelo reescrevendo esse caminho ("toca no 📎 e escolhe Localização").
 * O clipe vem ANTES da palavra localização, como nos passos que se ensinam.
 *
 * Até 25/09/2026 valia qualquer "mandar/enviar … localização". A OFERTA da
 * regra 18a ("me passa a rua, o número e o bairro (ou manda sua localização
 * pelo 📎)"), que o robô diz a quem só perguntou a taxa, já contava como
 * pedido, e "quer que eu te envie a localização da loja?" também: a trava que
 * pede o ponto UMA vez antes de segurar (R2) ou de fechar com a taxa estimada
 * (R3) nunca disparava. Se o modelo pediu com outras palavras, a gravação pede
 * de novo, uma vez, com a frase fixa — uma pergunta a mais, nunca um laço.
 */
export function roboJaPediuLocalizacao(historico: MensagemDoHistorico[] | null | undefined): boolean {
  const caminhoDoClipe = /(?:📎|\bclipe\b)[^\n]{0,40}?localiza[çc][ãa]o/i;
  return (historico || []).some((h) => {
    if (!h || h.sender === "user") return false;
    const t = String(h.text || "");
    return t.includes(COMO_MANDAR_A_LOCALIZACAO) || caminhoDoClipe.test(t);
  });
}
