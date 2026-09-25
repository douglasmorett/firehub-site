/**
 * A ENTREGA NO CHECKOUT — o estado da cotação de frete, sem React.
 *
 * O cardápio (CustomerStorePage) e o balcão (venda-presencial) perguntam a
 * taxa a /api/delivery-fee. Quem decide é o servidor (lib/area-de-entrega.ts);
 * a tela só precisa não estragar a resposta no caminho. E estragava, de quatro
 * jeitos, todos vistos na Divinos Burger (Cabo Frio, modo ROTA) em 25/09/2026:
 *
 *  1. O GPS SE PERDIA. O "Minha localização" carimbava o endereço ANTES de o
 *     mapa preencher rua e bairro; o preenchimento mudava o carimbo, e o ponto
 *     era jogado fora. A taxa saía do texto — o centro do bairro. Só 2 de 168
 *     pedidos do site em lojas por km tinham coordenada.
 *  2. RESPOSTA VELHA GANHAVA DA NOVA. O cliente corrige o número; a cotação do
 *     número anterior, mais lenta, chega depois e pinta a taxa errada.
 *  3. O PINO SÓ EXISTIA NA ÁREA DESENHADA. Em km/rota, "não achei" virava a
 *     faixa mais cara (R$ 12 para quem mora a 300 m) e "achei só o bairro"
 *     virava a faixa do centro do bairro, sem ninguém conferir.
 *  4. A COTAÇÃO NÃO IA NO PEDIDO. O POST geocodificava de novo; quando a
 *     segunda consulta falhava, o pedido saía "não localizado" com outra taxa.
 *
 * Aqui mora a parte que dá para testar sem navegador: quando o ponto do
 * cliente ainda vale, o que identifica "a mesma consulta", como ler a resposta,
 * o que falta para fechar o pedido e o que o painel de entrega mostra.
 * Teste: scripts/teste-entrega-no-checkout.ts.
 *
 * Este arquivo roda NO NAVEGADOR: nada de `crypto` nem de Prisma. Os tipos de
 * lib/cotacao-de-entrega.ts entram só como `import type` (somem no build).
 */
import type { MedidaDaDistancia, OrigemDoPonto } from "./cotacao-de-entrega";

export type Ponto = { lat: number; lng: number };
/** O ponto que o PRÓPRIO cliente deu: GPS do aparelho ou pino confirmado no mapa. */
export type PontoDoCliente = Ponto & { origem: Extract<OrigemDoPonto, "gps" | "pino"> };
export type EnderecoDigitado = {
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
};

/**
 * Quanto tempo a tela confia na cotação antes de pedir outra. O servidor dá 30
 * minutos (VALIDADE_DA_COTACAO_MS em lib/cotacao-de-entrega.ts, que não pode
 * ser importado aqui porque usa `crypto`); a folga de 5 minutos cobre o relógio
 * do celular e o tempo do próprio POST.
 */
export const VALIDADE_DA_COTACAO_NA_TELA_MS = 25 * 60 * 1000;

// ── TEXTO ───────────────────────────────────────────────────────────────────

/**
 * A MESMA normalização de `chaveDoEndereco` no servidor: sem acento, sem caixa,
 * tudo que não é letra ou número vira um espaço. Se as duas divergirem, a tela
 * acha que a cotação vale e o servidor acha que não (ou o contrário).
 */
export function textoLimpo(t: unknown): string {
  return String(t ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TIPO_DE_RUA =
  /^(rua|r|avenida|av|travessa|trav|tv|estrada|estr|est|alameda|al|rodovia|rod|praca|pca|largo|lgo|beco|servidao|serv|viela|via|ladeira|ld|caminho|passagem|psg|rua projetada)\s+/;
const PREFIXO_DE_BAIRRO =
  /^(vila|vl|jardim|jd|jardins|parque|pq|conjunto|conj|residencial|res|loteamento|lot|bairro|condominio|cond|nucleo)\s+/;

/** Abreviações de nome de rua: o mapa escreve por extenso, o cliente abrevia (ou o contrário). */
const ABREVIACOES: Record<string, string> = {
  dr: "doutor", dra: "doutora", prof: "professor", profa: "professora", pe: "padre",
  sto: "santo", sta: "santa", sr: "senhor", sra: "senhora", gov: "governador",
  pres: "presidente", cel: "coronel", cap: "capitao", ten: "tenente", sgt: "sargento",
  mal: "marechal", gal: "general", alm: "almirante", eng: "engenheiro", dep: "deputado",
  ver: "vereador", sen: "senador", min: "ministro",
};
/** "Treze de Maio" e "Treze Maio" são a mesma grafia; a ligação não é o nome. */
const LIGACOES = new Set(["de", "da", "do", "das", "dos", "e", "d"]);

/**
 * O NOME de uma rua ou bairro, sem as diferenças de grafia: sem acento e sem
 * caixa, sem o tipo ("Rua", "Av.") ou o prefixo ("Vila", "Jd"), com as
 * abreviações por extenso e sem "de/da/do".
 */
function nomeCanonico(texto: unknown, prefixo: RegExp): string {
  let t = textoLimpo(texto);
  // Duas passadas: "Rua Travessa X" e "Parque Jardim Y" existem.
  for (let i = 0; i < 2; i++) t = t.replace(prefixo, "");
  return t
    .split(" ")
    .filter(Boolean)
    .map((p) => ABREVIACOES[p] ?? p)
    .join(" ")
    .replace(/\bn senhora\b/g, "nossa senhora")
    .split(" ")
    .filter((p) => !LIGACOES.has(p))
    .join(" ");
}

/**
 * "Rua Beira Alta" e "Beira Alta" são o mesmo nome; "Vila Monte Alegre" e
 * "Monte Alegre" também; "R. Dr. Fulano" e "Rua Doutor Fulano" também — o mapa
 * escreve de um jeito e o cliente de outro, e isso não pode custar o ponto do
 * GPS dele.
 *
 * SÓ grafia. Até 25/09/2026 valia "um nome contém o outro", e com isso "Rua
 * Treze" passava por "Rua Treze de Maio", "Rua Brasil Novo" por "Avenida
 * Brasil" e "Portinho do Sul" por "Portinho": ruas e bairros DIFERENTES que
 * dividem uma palavra, e o pedido ia com o pino de um lugar e o texto de
 * outro. Nome que não é o mesmo depois de limpar a grafia é outro nome.
 */
function mesmoNome(a: unknown, b: unknown, prefixo: RegExp): boolean {
  return nomeCanonico(a, prefixo) === nomeCanonico(b, prefixo);
}

/** "S/N", "s n" e "SN" são o mesmo; "12-A" e "12a" também. */
function numeroCanonico(t: unknown): string {
  return textoLimpo(t).replace(/\s+/g, "");
}

// ── PONTO ───────────────────────────────────────────────────────────────────

/** Coordenada utilizável: números finitos, dentro do globo, e não o (0,0) de quem não tem ponto. */
export function pontoValido(p: unknown): Ponto | null {
  const v = p as any;
  const lat = Number(v?.lat);
  const lng = Number(v?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return null;
  return { lat, lng };
}

/** O endereço diz ONDE (rua ou bairro)? Só número não localiza nada. */
export function temRuaOuBairro(e: EnderecoDigitado | null | undefined): boolean {
  return Boolean(e && (textoLimpo(e.street) || textoLimpo(e.neighborhood)));
}

/**
 * O PONTO QUE O CLIENTE DEU AINDA VALE PARA O ENDEREÇO NA TELA?
 *
 * `carimbo` é o endereço que estava na tela quando o ponto foi dado — gravado
 * DEPOIS de o "Minha localização" preencher rua e bairro (era antes, e foi
 * assim que o GPS se perdia: o próprio preenchimento "mudava o endereço").
 * Monte-o com `carimboDoPonto`.
 *
 * Complemento não entra (apto 201 não muda a casa de lugar). O número entra
 * quando está NO CARIMBO: "10" → "1500" na mesma avenida é outra casa. O
 * número que o mapa chutou para um GPS (o da casa conhecida mais próxima,
 * muitas vezes errado) não vai para o carimbo — o cliente corrigir "250" para
 * "12" é corrigir o rótulo, não mudar de casa.
 *
 * Rua ou bairro DIFERENTES derrubam o ponto — é o caso que já aconteceu: o
 * cliente confirmou o pino em casa, trocou a rua para a do trabalho e fechou; a
 * área aprovou um lugar e o motoboy foi para outro. Campo que estava vazio no
 * carimbo e foi preenchido depois não conta como troca (o GPS sem número,
 * completado à mão). Campo apagado no meio da edição também não — a tela não
 * fecha pedido sem ele, e o que ele virar é comparado com o carimbo de novo.
 *
 * Carimbo SEM rua e SEM bairro não vale para endereço nenhum: é o GPS cujo
 * reverse geocode falhou (429, rede) com o formulário vazio. Se ele valesse,
 * o cliente que tocou "Minha localização" no trabalho e digitou o endereço de
 * casa mandaria a casa no texto e o trabalho no ponto — o ponto decide a taxa
 * e o motoboy vai para o trabalho.
 *
 * A tela pergunta isto a CADA leitura (painel, cotação, pedido) e não guarda
 * a resposta: o texto no meio da redigitação ("E", "Es"... de "Esperança")
 * não é endereço nenhum, e derrubar o ponto de vez numa tecla era perder o
 * GPS de quem só estava corrigindo a grafia.
 */
export function pontoValeParaEndereco(carimbo: EnderecoDigitado | null | undefined, atual: EnderecoDigitado): boolean {
  if (!carimbo || !temRuaOuBairro(carimbo)) return false;
  const confere = (antes: unknown, agora: unknown, igual: (a: unknown, b: unknown) => boolean) => {
    if (!textoLimpo(antes) || !textoLimpo(agora)) return true;
    return igual(antes, agora);
  };
  return confere(carimbo.street, atual.street, (a, b) => mesmoNome(a, b, TIPO_DE_RUA))
    && confere(carimbo.neighborhood, atual.neighborhood, (a, b) => mesmoNome(a, b, PREFIXO_DE_BAIRRO))
    && confere(carimbo.number, atual.number, (a, b) => numeroCanonico(a) === numeroCanonico(b));
}

/**
 * O carimbo de um ponto: o endereço na tela quando o ponto foi dado, SEM o
 * número quando quem o escreveu foi o mapa (reverse geocode do GPS) — esse é
 * palpite, e o cliente corrigi-lo não pode custar o ponto.
 */
export function carimboDoPonto(endereco: EnderecoDigitado, o: { numeroDoMapa?: boolean } = {}): EnderecoDigitado {
  return {
    street: String(endereco.street ?? ""),
    number: o.numeroDoMapa ? "" : String(endereco.number ?? ""),
    neighborhood: String(endereco.neighborhood ?? ""),
  };
}

/**
 * Até quantos metros de incerteza o GPS do aparelho vale como a porta do
 * cliente. É o mesmo limite do deslocamento até a rua no roteador (R4):
 * acima disso, o ponto já pode ser de outra faixa de 0,5 km.
 */
export const PRECISAO_MAXIMA_DO_GPS_M = 150;

/**
 * O "Minha localização" é PRECISO o bastante para decidir a taxa?
 *
 * Android 12+ e iOS com "Localização precisa" desligada dão a localização
 * APROXIMADA (círculo de ~3 km, o ponto no meio dele); desktop localiza por
 * IP. Esse ponto, aceito como o do cliente, decidia a faixa sem ninguém
 * conferir — a R3 não pede confirmação com coordenada do cliente — e ia para
 * o pedido como "gps", para o motoboy e a roteirização. Sem precisão
 * informada, também não vale (não dá para saber).
 */
export function gpsEhPreciso(precisaoEmMetros: unknown): boolean {
  return typeof precisaoEmMetros === "number" && Number.isFinite(precisaoEmMetros)
    && precisaoEmMetros >= 0 && precisaoEmMetros <= PRECISAO_MAXIMA_DO_GPS_M;
}

export type MotivoDoMapaNaTela = "nao-achou" | "aproximado" | "conferir" | "gps-aproximado";

/**
 * ONDE o mapa de confirmação abre, com qual texto, e se o ponto inicial já
 * pode ser confirmado sem o cliente tocar.
 *
 * Só dispensa o toque o ponto que já é confiável: o do cliente, ainda deste
 * endereço, ou o palpite PRECISO do servidor. Todo o resto — GPS aproximado,
 * o pino de antes de o número mudar, o centro do bairro, o ponto de uma rua
 * que o cliente trocou — só abre o mapa perto; confirmar sem olhar seria o
 * chute de antes com carimbo de "confirmado".
 */
export function comoAbrirOMapa(e: {
  /** O "Minha localização" veio aproximado: é ele que o cliente precisa acertar. */
  gpsAproximado: Ponto | null;
  pontoDoCliente: { ponto: Ponto; carimbo: EnderecoDigitado } | null;
  endereco: EnderecoDigitado;
  pontoAproximado: Ponto | null;
  pontoDescartado: Ponto | null;
  precisaConfirmarNoMapa: boolean;
  pedeConfirmacao: boolean;
}): { pontoInicial: Ponto | null; motivo: MotivoDoMapaNaTela; exigirToque: boolean } {
  if (e.gpsAproximado) return { pontoInicial: e.gpsAproximado, motivo: "gps-aproximado", exigirToque: true };
  const c = e.pontoDoCliente;
  if (c && pontoValeParaEndereco(c.carimbo, e.endereco)) return { pontoInicial: c.ponto, motivo: "conferir", exigirToque: false };
  const motivo: MotivoDoMapaNaTela = e.precisaConfirmarNoMapa ? "nao-achou" : e.pedeConfirmacao ? "aproximado" : "conferir";
  const palpitePreciso = !e.precisaConfirmarNoMapa && !e.pedeConfirmacao;
  if (e.pontoAproximado && palpitePreciso) return { pontoInicial: e.pontoAproximado, motivo, exigirToque: false };
  // Mesma rua e bairro, só o número mudou: o pino de antes está a poucas
  // casas daqui — melhor palpite que o centro do bairro.
  if (c && pontoValeParaEndereco({ ...c.carimbo, number: "" }, e.endereco)) return { pontoInicial: c.ponto, motivo, exigirToque: true };
  return { pontoInicial: e.pontoAproximado || e.pontoDescartado || c?.ponto || null, motivo, exigirToque: true };
}

// ── A CONSULTA ──────────────────────────────────────────────────────────────

/**
 * O que identifica "a mesma cotação": rua, número e bairro normalizados e o
 * ponto a 4 casas (~11 m) — exatamente as peças de `chaveDoEndereco` no
 * servidor. Se a assinatura do que está na tela não é a da cotação mostrada,
 * a taxa mostrada é de OUTRO endereço, e o token dela seria recusado no POST.
 */
export function assinaturaDaConsulta(e: EnderecoDigitado, ponto?: Ponto | null): string {
  const p = ponto && pontoValido(ponto);
  const coord = p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : "";
  return `${textoLimpo(e.street)}|${textoLimpo(e.number)}|${textoLimpo(e.neighborhood)}#${coord}`;
}

/**
 * A query de /api/delivery-fee. Rua, número e bairro vão SEMPRE — inclusive
 * junto do ponto confirmado no mapa, que antes ia sozinho: o servidor assina a
 * cotação com a chave do endereço, e o POST do pedido manda as peças; cotação
 * feita sem elas nunca casaria com o pedido.
 */
export function consultaDaCotacao(a: EnderecoDigitado & { franchiseeId?: string | null; cidade?: string | null; ponto?: PontoDoCliente | null }): string {
  const q = new URLSearchParams();
  if (a.franchiseeId) q.set("franchiseeId", a.franchiseeId);
  const rua = String(a.street ?? "").trim();
  const numero = String(a.number ?? "").trim();
  const bairro = String(a.neighborhood ?? "").trim();
  q.set("street", rua);
  q.set("number", numero);
  q.set("neighborhood", bairro);
  // O mesmo formato de texto livre que o checkout sempre mandou ("Rua X, 10 -
  // Bairro, Cidade"): é ele que o geocodificador recebe quando as peças não
  // bastam, e trocar a pontuação muda o que o Nominatim acha.
  const cidade = String(a.cidade ?? "").trim();
  q.set("address", `${rua}, ${numero} - ${bairro}${cidade ? `, ${cidade}` : ""}`.trim());
  const p = a.ponto && pontoValido(a.ponto);
  if (p && a.ponto) {
    q.set("lat", String(p.lat));
    q.set("lng", String(p.lng));
    q.set("origem", a.ponto.origem);
  }
  return q.toString();
}

// ── A RESPOSTA ──────────────────────────────────────────────────────────────

export type CotacaoNaTela = {
  /** Dá para fechar entrega com esta cotação (ainda sujeito ao pino, ver pedeConfirmacao). */
  disponivel: boolean;
  /** Taxa cotada; null quando não há (fora, ou sem ponto). */
  taxa: number | null;
  /** 0 é distância válida (cliente na porta da loja): não vira null. */
  distanciaKm: number | null;
  raioMaxKm: number | null;
  tempoMin: number | null;
  medida: MedidaDaDistancia | null;
  faixaKm: number | null;
  mensagem: string;
  /** Sem ponto confiável não há taxa: o cliente marca no mapa ou não fecha (R2). */
  precisaConfirmarNoMapa: boolean;
  /** Há taxa, mas ESTIMADA por um ponto aproximado: o pino é obrigatório antes de fechar (R3). */
  pedeConfirmacao: boolean;
  /** O cliente pode conferir o ponto, mesmo sem ser obrigado. */
  podeConferirNoMapa: boolean;
  /** O palpite do servidor — é onde o mapa abre. */
  pontoAproximado: Ponto | null;
  /** Resposta antiga "não localizado" com taxa (modos que ainda aceitam). */
  naoLocalizado: boolean;
  /** O token assinado que o pedido devolve ao servidor (R1). */
  cotacao: string | null;
};

const numeroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function lerRespostaDaCotacao(bruto: unknown, taxaPadrao: number = 0): CotacaoNaTela {
  const d: any = bruto && typeof bruto === "object" ? bruto : {};
  const precisaConfirmarNoMapa = d.precisaConfirmarNoMapa === true;
  const disponivel = d.available !== false && !precisaConfirmarNoMapa;
  const distanciaKm = numeroOuNulo(d.distanceKm);
  const tempo = numeroOuNulo(d.tempoMin);
  const medida: MedidaDaDistancia | null =
    d.medida === "rota" || d.medida === "estimada" || d.medida === "linha-reta" ? d.medida : null;
  const taxa = disponivel ? (numeroOuNulo(d.fee) ?? taxaPadrao) : null;
  const pedeConfirmacao = disponivel && d.pedeConfirmacao === true;
  const mensagemPadrao = disponivel
    ? ""
    : precisaConfirmarNoMapa
      ? "Não localizamos esse endereço no mapa. Marque no mapa onde fica a sua casa para calcular a entrega."
      : "Endereço fora da área de entrega da loja.";
  return {
    disponivel,
    taxa: taxa == null ? null : Math.max(0, Math.round(taxa * 100) / 100),
    distanciaKm: distanciaKm != null && distanciaKm >= 0 ? distanciaKm : null,
    raioMaxKm: numeroOuNulo(d.maxRadiusKm),
    tempoMin: tempo != null && tempo > 0 ? Math.round(tempo) : null,
    medida,
    faixaKm: numeroOuNulo(d.faixaKm),
    mensagem: typeof d.message === "string" && d.message.trim() ? d.message.trim() : mensagemPadrao,
    precisaConfirmarNoMapa,
    pedeConfirmacao,
    // Quem diz se há mapa para conferir é o servidor: em km/rota ele só
    // oferece quando a loja tem pino (sem ele não há "a loja" no mapa nem
    // régua para o ponto confirmado).
    podeConferirNoMapa: d.podeConfirmarNoMapa === true || d.type === "poligono",
    pontoAproximado: pontoValido(d.ponto),
    naoLocalizado: d.unknown === true,
    cotacao: disponivel && typeof d.cotacao === "string" && d.cotacao.length > 0 && d.cotacao.length <= 4000 ? d.cotacao : null,
  };
}

// ── O QUE A TELA MOSTRA ─────────────────────────────────────────────────────

const km = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/**
 * "0,84 km pela rua · até ~30 min". A distância diz COMO foi medida: pela rua
 * (rota de verdade), estimada (o roteador não respondeu e a conta foi linha
 * reta × o desvio típico da loja — o cliente e a loja precisam saber) ou da
 * loja em linha reta (modo raio, que é linha reta de propósito).
 */
export function detalheDaEntrega(c: { distanciaKm: number | null; medida: MedidaDaDistancia | null; tempoMin: number | null }): string {
  const partes: string[] = [];
  if (c.distanciaKm != null) {
    partes.push(
      c.medida === "rota" ? `${km(c.distanciaKm)} km pela rua`
        : c.medida === "estimada" ? `~${km(c.distanciaKm)} km (distância estimada)`
          : `${km(c.distanciaKm)} km da loja`,
    );
  }
  if (c.tempoMin != null) partes.push(`chega em até ~${c.tempoMin} min`);
  return partes.join(" · ");
}

export type PainelDaEntrega = {
  tom: "ok" | "alerta" | "erro" | "neutro" | "calculando";
  icone: string;
  titulo: string;
  /** Distância e prazo (vazio quando não há). */
  detalhe: string;
  mensagem: string;
  /** O botão do mapa: obrigatório (não fecha sem), opcional (conferir) ou nenhum. */
  botaoDoMapa: "obrigatorio" | "opcional" | null;
};

export function painelDaEntrega(e: {
  bairroLocal: boolean;
  calculando: boolean;
  calculada: boolean;
  disponivel: boolean;
  erro: boolean;
  /** A taxa que entra no total (0 com frete grátis). */
  taxaEfetiva: number;
  freteGratisPorMinimo: boolean;
  precisaConfirmarNoMapa: boolean;
  pedeConfirmacao: boolean;
  podeConferirNoMapa: boolean;
  temPontoDoCliente: boolean;
  /** Resposta "não localizado, a loja confirma" (loja sem pino no mapa): há taxa, mas é provisória. */
  naoLocalizado?: boolean;
  distanciaKm: number | null;
  medida: MedidaDaDistancia | null;
  tempoMin: number | null;
  mensagem: string;
}): PainelDaEntrega {
  const detalhe = e.disponivel ? detalheDaEntrega(e) : "";
  if (e.calculando) {
    return { tom: "calculando", icone: "⏳", titulo: "Calculando a entrega...", detalhe: "", mensagem: "", botaoDoMapa: null };
  }
  if (e.precisaConfirmarNoMapa && !e.temPontoDoCliente) {
    return {
      tom: "alerta", icone: "📍", titulo: "Marque no mapa onde você mora", detalhe: "",
      mensagem: e.mensagem || "Não localizamos esse endereço no mapa. A entrega é calculada pela distância até a sua porta.",
      botaoDoMapa: "obrigatorio",
    };
  }
  if (e.erro) {
    return { tom: "erro", icone: "⚠️", titulo: "Não consegui calcular a entrega", detalhe: "", mensagem: e.mensagem, botaoDoMapa: null };
  }
  if (!e.disponivel && e.calculada) {
    return {
      tom: "erro", icone: "⛔", titulo: "Fora da área de entrega", detalhe: "", mensagem: e.mensagem,
      botaoDoMapa: e.podeConferirNoMapa || e.precisaConfirmarNoMapa ? "opcional" : null,
    };
  }
  if (e.pedeConfirmacao && !e.temPontoDoCliente) {
    return {
      tom: "alerta", icone: "📍",
      titulo: e.taxaEfetiva > 0 ? `Taxa estimada: ${reais(e.taxaEfetiva)}` : "Confirme no mapa onde você mora",
      detalhe,
      mensagem: "O mapa achou só um ponto aproximado do seu endereço. Marque a sua porta no mapa para confirmar a taxa.",
      botaoDoMapa: "obrigatorio",
    };
  }
  const opcional = e.podeConferirNoMapa || e.temPontoDoCliente ? "opcional" : null;
  if (e.naoLocalizado && e.calculada && !e.temPontoDoCliente) {
    // Loja sem pino no mapa: não há mapa para oferecer, e a taxa é a que a
    // loja vai confirmar. Aviso em âmbar, não "tudo certo" em verde.
    return {
      tom: "alerta", icone: "⚠️",
      titulo: e.taxaEfetiva > 0 ? `Taxa de Entrega: ${reais(e.taxaEfetiva)}` : "Entrega Grátis! 🎉",
      detalhe, mensagem: e.mensagem, botaoDoMapa: opcional,
    };
  }
  // Com a distância e o prazo na tela, "Distância: 0,84 km pela rua" do
  // servidor só repetiria o detalhe.
  const mensagem = detalhe ? "" : e.mensagem;
  if (e.freteGratisPorMinimo && e.calculada) {
    return { tom: "ok", icone: "🎉", titulo: "Frete Grátis Aplicado! 🎉", detalhe, mensagem, botaoDoMapa: opcional };
  }
  if (e.calculada && e.taxaEfetiva > 0) {
    return { tom: "ok", icone: "🛵", titulo: `Taxa de Entrega: ${reais(e.taxaEfetiva)}`, detalhe, mensagem, botaoDoMapa: opcional };
  }
  if (e.calculada) {
    return { tom: "ok", icone: "🎉", titulo: "Entrega Grátis! 🎉", detalhe, mensagem, botaoDoMapa: opcional };
  }
  return {
    tom: "neutro", icone: "📍",
    titulo: e.bairroLocal ? "Selecione seu bairro acima" : "Preencha rua, número e bairro para calcular",
    detalhe: "", mensagem: e.mensagem, botaoDoMapa: null,
  };
}

// ── O QUE VAI NO PEDIDO ─────────────────────────────────────────────────────

/**
 * A parte de entrega do corpo de POST /api/customer-order. O ponto vai com a
 * ORIGEM (pino ou GPS) dentro e ao lado — o servidor lê qualquer um dos dois —,
 * e a cotação assinada vai de volta para o servidor cobrar o que o cliente viu
 * (R1). Quem chama garante que os dois são DESTE endereço.
 */
export function entregaNoPedidoDoSite(ponto: PontoDoCliente | null, cotacao: string | null) {
  return {
    customerCoords: ponto ? { lat: ponto.lat, lng: ponto.lng, origem: ponto.origem } : null,
    customerCoordsOrigem: ponto ? ponto.origem : null,
    cotacao: cotacao || null,
  };
}

// ── FECHAR O PEDIDO ─────────────────────────────────────────────────────────

export type PendenciaDaEntrega =
  /** Espere a cotação em voo terminar. */
  | { acao: "aguardar"; mensagem: string }
  /** A cotação na tela não é deste endereço (ou venceu, ou falhou): cote de novo. */
  | { acao: "recotar"; mensagem: string }
  /** Sem o pino não fecha: abra o mapa. */
  | { acao: "abrir-mapa"; mensagem: string }
  /** Fora da área. */
  | { acao: "recusar"; mensagem: string };

/**
 * O que ainda impede o pedido de entrega de sair. null = pode mandar.
 *
 * A ordem importa: uma cotação em voo ou de outro endereço torna todo o resto
 * velho; e "sem ponto" vem antes de "fora", porque em km/rota "não achei" não
 * é "fora" — é "me mostre onde".
 */
export function oQueFaltaParaFechar(e: {
  calculando: boolean;
  /** false no modo bairro, em que a taxa é a da lista e não há cotação do servidor. */
  cotadaPeloServidor: boolean;
  assinaturaCotada: string | null;
  assinaturaAtual: string;
  idadeDaCotacaoMs: number | null;
  erro: boolean;
  calculada: boolean;
  disponivel: boolean;
  precisaConfirmarNoMapa: boolean;
  pedeConfirmacao: boolean;
  temPontoDoCliente: boolean;
  freteGratis: boolean;
  mensagem: string;
}): PendenciaDaEntrega | null {
  if (e.calculando) {
    return { acao: "aguardar", mensagem: "⏳ Ainda estamos calculando a entrega do seu endereço. Um instante e toque em Finalizar de novo." };
  }
  if (e.cotadaPeloServidor) {
    if (e.erro) {
      return { acao: "recotar", mensagem: "Não consegui calcular a entrega. Estou tentando de novo — confira a taxa e toque em Finalizar." };
    }
    if (e.assinaturaCotada !== e.assinaturaAtual) {
      return { acao: "recotar", mensagem: "O endereço mudou depois do cálculo da entrega. Atualizamos a taxa — confira e toque em Finalizar de novo." };
    }
    if (e.idadeDaCotacaoMs != null && e.idadeDaCotacaoMs > VALIDADE_DA_COTACAO_NA_TELA_MS) {
      return { acao: "recotar", mensagem: "A taxa de entrega foi calculada há muito tempo. Atualizamos — confira e toque em Finalizar de novo." };
    }
  }
  if (e.precisaConfirmarNoMapa) {
    return { acao: "abrir-mapa", mensagem: e.mensagem || "Marque no mapa onde fica a sua casa para calcularmos a entrega." };
  }
  if (e.pedeConfirmacao && !e.temPontoDoCliente) {
    return { acao: "abrir-mapa", mensagem: "Confirme no mapa onde fica a sua porta: a taxa mostrada é estimada." };
  }
  if (!e.disponivel) {
    return { acao: "recusar", mensagem: e.mensagem || "Este endereço está fora da área de entrega da loja. Revise o endereço ou escolha 'Retirar no Balcão'." };
  }
  if (!e.calculada && !e.freteGratis) {
    return { acao: "aguardar", mensagem: "⚠️ Por favor, aguarde o cálculo da taxa de entrega do seu endereço." };
  }
  return null;
}

// ── CORRIDA DE COTAÇÕES ─────────────────────────────────────────────────────

/**
 * Só a ÚLTIMA cotação pedida pode pintar a tela. Cada pedido novo cancela o
 * anterior (AbortController, quando existe) e ganha um número; a resposta que
 * chega com número velho é descartada — mesmo que o cancelamento não tenha
 * chegado a tempo.
 */
export function criarSequenciadorDeCotacoes() {
  let atual = 0;
  let controle: AbortController | null = null;
  return {
    nova(): { id: number; signal?: AbortSignal } {
      controle?.abort();
      controle = typeof AbortController === "function" ? new AbortController() : null;
      atual += 1;
      return { id: atual, signal: controle?.signal };
    },
    vale(id: number): boolean {
      return id === atual;
    },
    /** Retirada escolhida, tela fechada: nenhuma resposta em voo vale mais. */
    cancelar(): void {
      controle?.abort();
      controle = null;
      atual += 1;
    },
  };
}

// ── BALCÃO ──────────────────────────────────────────────────────────────────

const PARECE_COMPLEMENTO =
  /^(ap|apt|apto|apartamento|bl|bloco|casa|cs|fundos|frente|lote|lt|quadra|qd|sala|sl|loja|lj|comp|complemento|cond|condominio|condomínio|edificio|edifício|ed|torre|andar|kitnet|km|cep)\b/i;

/**
 * A casa descrita ("sobrado verde", "portão azul", "muro alto"): não é bairro,
 * é o que o motoboy procura na porta. Testado sobre o texto limpo (sem acento).
 */
const DESCRICAO_DA_CASA =
  /^(sobrado|portao|muro|grade|predio|terreo|kitnete?|barraco|galpao|garagem|cor)( |$)/;

/**
 * Referência ("perto do Shopping Park Lagos", "próximo ao mercado", "em
 * frente à igreja"): é a MESMA lista de semReferencias em lib/geocoding.ts
 * (que não dá para importar aqui: ele traz o Prisma), sobre o texto limpo, e
 * mais as aberturas que só são referência no começo ("entre a rua X e Y").
 */
const PARECE_REFERENCIA =
  /(^| )(proximo|proxima|prox|perto|ao lado|do lado|em frente|na frente|defronte|atras|esquina|ponto de referencia|referencia|ref)( |$)|^(entre|depois|antes|junto|apos|pegado|vizinho|vizinha)( |$)/;

/**
 * O segmento é a CIDADE ("Cabo Frio", "Cabo Frio/RJ")? `cidade` vem do
 * cadastro da loja, no formato "Cabo Frio - RJ" ou só "Cabo Frio".
 */
function ehACidade(segmento: string, cidade: string | null | undefined): boolean {
  const c = textoLimpo(String(cidade ?? "").split(/\s+[-–]\s+|\s*[/,]\s*/)[0]);
  if (!c) return false;
  const s = textoLimpo(segmento);
  return s === c || s.replace(/ [a-z]{2}$/, "") === c;
}

/**
 * O endereço de UMA linha do balcão ("Travessa Canaã, 6 - Boca do Mato") em
 * rua, número e bairro — só quando o formato não deixa dúvida.
 *
 * O balcão cotava só o texto livre. Em km/rota, o último recurso do mapa
 * quando a rua não existe no OpenStreetMap (os becos da Divinos, em Cabo
 * Frio) é o centro do BAIRRO — e ele só roda com o bairro em separado. Sem
 * as partes, o balcão caía em "não localizado" onde o site achava o bairro.
 *
 * Conservador de propósito: sem vírgula depois da rua, sem número, ou sem um
 * pedaço que pareça bairro (e não "apto 201"), devolve null e vale o texto
 * livre, como antes. A mesma separação vai na cotação e no POST — é o que faz
 * a chave da cotação assinada casar dos dois lados.
 *
 * Bairro errado é pior que bairro nenhum: o mapa filtra a rua por ele e, sem
 * a rua, geocodifica o "bairro" como último recurso. Por isso a busca PARA
 * (e devolve null, o texto livre de antes) em dois casos:
 *  - REFERÊNCIA: "Rua Beira Alta, 100 - perto do Shopping Park Lagos" virava
 *    bairro "perto do Shopping..."; o mapa não achava a rua "nesse bairro",
 *    pedia confirmação e, achando o shopping, cobrava R$ 15 no lugar de R$ 5;
 *  - a CIDADE da loja: "Rua X, 10 - Cabo Frio" virava bairro "Cabo Frio", e o
 *    "centro do bairro" era o centro da cidade (na Divinos, a faixa de R$ 20).
 *    Depois da cidade só vem UF e CEP.
 * Descrição da casa ("sobrado verde") e complemento ("apto 201") são pulados.
 */
export function partesDoEnderecoDigitado(texto: unknown, cidade?: string | null): { street: string; number: string; neighborhood: string } | null {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  const m = t.match(/^([^,]*[^\d\s,][^,]*?)\s*,\s*(?:n[º°o.]?\s*)?(\d{1,6}[a-z]?|s\/?n)(?![\w/])\s*(.*)$/i);
  if (!m) return null;
  const street = m[1].trim();
  const number = m[2].trim();
  if (street.length < 3 || PARECE_REFERENCIA.test(textoLimpo(street))) return null;
  const segmentos = m[3]
    .replace(/^[\s,–-]+/, "")
    .split(/\s*,\s*|\s+[-–]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of segmentos) {
    const limpo = textoLimpo(s);
    if (PARECE_REFERENCIA.test(limpo) || ehACidade(s, cidade)) return null;
    if (PARECE_COMPLEMENTO.test(s) || DESCRICAO_DA_CASA.test(limpo) || /^\d/.test(s) || s.length < 3) continue;
    return { street, number, neighborhood: s };
  }
  return null;
}

/**
 * A query de /api/delivery-fee do balcão (sem franchiseeId: no painel a loja é
 * a sessão). `cidade` é a da loja — a mesma tem de ir em `entregaNoPedidoDoBalcao`.
 */
export function consultaDoBalcao(endereco: string, cidade?: string | null): string {
  const texto = String(endereco ?? "").trim();
  const partes = partesDoEnderecoDigitado(texto, cidade);
  return new URLSearchParams({ address: texto, ...(partes || {}) }).toString();
}

/**
 * A parte de entrega do corpo de POST /api/store/orders/presencial: a cotação
 * (só se for do MESMO texto de endereço), se a taxa foi digitada na mão, e as
 * MESMAS partes que a cotação usou — é com elas que o servidor confere a
 * chave da cotação e, sem cotação, mede o endereço. `cidade`: a mesma da
 * cotação (consultaDoBalcao).
 */
export function entregaNoPedidoDoBalcao(endereco: string, cotacao: { token: string; endereco: string } | null, taxaDigitada: boolean, cidade?: string | null) {
  const texto = String(endereco ?? "").trim();
  const partes = partesDoEnderecoDigitado(texto, cidade);
  return {
    ...(cotacao && cotacao.endereco === texto ? { cotacao: cotacao.token } : {}),
    taxaDigitadaNoBalcao: taxaDigitada,
    ...(partes ? { customerStreet: partes.street, customerNumber: partes.number, customerNeighborhood: partes.neighborhood } : {}),
  };
}

export type CotacaoNoBalcao = {
  /** O valor para o campo da taxa ("5.00"), ou null = o atendente digita. */
  taxa: string | null;
  tom: "ok" | "alerta" | "erro";
  texto: string;
  /** O token que vai no POST do balcão (R1). */
  cotacao: string | null;
};

/**
 * A resposta de /api/delivery-fee lida para o balcão. O balcão não bloqueia
 * venda — o atendente está com o cliente na linha e pode combinar outra taxa
 * (R2) —, mas tem de SABER quando a taxa é chute: ponto aproximado, distância
 * estimada ou endereço que o mapa não achou. Nesse último caso o campo fica
 * vazio: taxa de "não sei" é decisão dele, não do sistema.
 */
export function lerCotacaoNoBalcao(bruto: unknown, mensagemDoErro?: unknown): CotacaoNoBalcao {
  if (!bruto || typeof bruto !== "object") {
    // "Muitas consultas seguidas" (429) e afins: o motivo ajuda o atendente.
    const motivo = typeof mensagemDoErro === "string" && mensagemDoErro.trim() ? `${mensagemDoErro.trim()} ` : "Não consegui calcular a taxa. ";
    return { taxa: null, tom: "erro", texto: `${motivo}Digite o valor na mão.`, cotacao: null };
  }
  const c = lerRespostaDaCotacao(bruto, 0);
  if (c.precisaConfirmarNoMapa) {
    return {
      taxa: null, tom: "alerta", cotacao: null,
      texto: c.pontoAproximado
        ? "O mapa achou esse endereço só de forma aproximada. Confira rua, número e bairro com o cliente e digite a taxa (0 se for grátis)."
        : "Endereço não localizado no mapa. Confira rua, número e bairro com o cliente e digite a taxa (0 se for grátis).",
    };
  }
  if (!c.disponivel) {
    return { taxa: null, tom: "alerta", cotacao: null, texto: `${c.mensagem || "Endereço fora da área de entrega."} Se for entregar, digite a taxa na mão.` };
  }
  if (c.naoLocalizado) {
    // "Não localizado, a loja confirma" (loja por km SEM pino no mapa, loja
    // sem área): o servidor manda a faixa MAIS CARA como taxa provisória do
    // cardápio. No balcão isso ia para o campo, o atendente apertava Enviar e
    // o cliente a 300 m pagava R$ 20. Não sei não é faixa (R2): campo vazio.
    return {
      taxa: null, tom: "alerta", cotacao: null,
      texto: "Endereço não localizado no mapa. Confira rua, número e bairro com o cliente e digite a taxa (0 se for grátis).",
    };
  }
  const partes = [
    detalheDaEntrega({ ...c, tempoMin: null }),
    c.faixaKm != null ? `faixa até ${km(c.faixaKm)} km` : "",
    c.tempoMin != null ? `~${c.tempoMin} min` : "",
  ].filter(Boolean).join(" · ");
  const taxa = (c.taxa ?? 0).toFixed(2);
  if (c.pedeConfirmacao) {
    return {
      taxa, tom: "alerta", cotacao: c.cotacao,
      texto: `Taxa ESTIMADA: o mapa achou só um ponto aproximado (centro do bairro ou rua de mesmo nome em outro lugar). Confirme o endereço com o cliente.${partes ? ` (${partes})` : ""}`,
    };
  }
  if (c.medida === "estimada") {
    return {
      taxa, tom: "alerta", cotacao: c.cotacao,
      texto: `Distância ESTIMADA: o mapa de ruas não respondeu. Confira a taxa.${partes ? ` (${partes})` : ""}`,
    };
  }
  return { taxa, tom: "ok", cotacao: c.cotacao, texto: partes || c.mensagem || "Taxa calculada pela área de entrega da loja." };
}
