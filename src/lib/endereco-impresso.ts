/**
 * O endereço de entrega como ele sai NO PAPEL: uma linha por informação.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Pedido do Douglas a partir da Delícia de Casa (02/10/2026): "configurar na
 * nota o endereço não sair todo embolado, separado por vírgulas, mas por rua,
 * bairro, número da casa". O pedido guarda o endereço como UM texto
 * (`customerAddress`), cada canal no seu formato, e a comanda imprimia esse
 * texto corrido depois de "Endereco:". O motoboy tinha de achar o bairro no
 * meio de "Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ, portão branco".
 *
 * Nenhum canal grava as peças separadas — o iFood, a Brendi e o JotaJá
 * recebem rua, número e bairro em campos próprios e o webhook junta tudo num
 * texto (lib/ifood-eventos.ts, processBrendiEvent, processJotajaEvent). Então
 * o texto é lido aqui, nos formatos que cada tradutor monta:
 *
 *   iFood   "R. Itaperu, 107 - Comp: casa 1 - Ref: perto do colégio - Centro - Rio das Ostras"
 *   Brendi  "Rua Caravelas, 59 - Sobrado - Trindade - São Gonçalo"
 *   JotaJá  "Rua da Fonte 512 Portão marrom - Nova Cidade - Rio das Ostras"
 *   Wabiz   "Quadra 16 conjunto G, Sn - Casa 10 - QUADRA 16 - Brasília/DF - CEP 73050167"
 *   99Food  "Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ, portão branco"
 *   Site    "Rua das Casuarinas, 20 - Âncora (Apartamento 201)"
 *   Robô    "Rua Paranaíba, 470, Operário, Rio das Ostras"
 *   Balcão  "Rua X, 35 - Centro" (ou texto solto: "quadra 05")
 *
 * O BAIRRO sai da régua que já existe (lib/bairro-do-endereco.ts — a mesma do
 * relatório de áreas): é a última parte antes da cidade. Aqui só se acha ONDE
 * ele está no texto para tirá-lo do resto.
 *
 * ── Nunca perder, nunca inventar ────────────────────────────────────────────
 *
 * O texto separado só vale se cada palavra do original estiver em alguma
 * linha, e nenhuma linha tiver palavra que o original não tinha (conferência
 * no fim de `enderecoImpresso`). Não fechou — formato que ninguém previu,
 * endereço digitado à mão sem vírgula — e o papel imprime o texto ORIGINAL,
 * como sempre imprimiu. Número que não está escrito não vira "S/N"; cidade que
 * não está escrita não vem do cadastro da loja. (A NFC-e tem régua própria em
 * lib/documento-do-cliente.ts, que preenche o que a SEFAZ exige — aqui não.)
 */
import { bairroDoEndereco, PEDACO_DA_CASA_RE } from "@/lib/bairro-do-endereco";
import { chaveDoCanal } from "@/lib/canal-do-pedido";

export type RotuloDoEndereco =
  | "Rua"
  | "Número"
  | "Complemento"
  | "Bairro"
  | "Referência"
  | "Cidade"
  | "CEP"
  | "Localização"
  /** O lugar que o WhatsApp deu à localização, quando ele não se separa em rua/bairro. */
  | "Endereço";

export type LinhaDoEndereco = { rotulo: RotuloDoEndereco; valor: string };

export type EnderecoImpresso = {
  /** true = deu para separar com segurança e `linhas` tem o endereço inteiro. */
  separado: boolean;
  /** Uma linha por informação, já na ordem do papel. Vazio quando não separou. */
  linhas: LinhaDoEndereco[];
  /**
   * O mesmo endereço numa linha só, com as peças rotuladas e separadas por
   * " | " — é o que vai no `customerAddress` para o Assistente que ainda não
   * sabe imprimir `linhas` (todo Assistente quebra o endereço como um
   * parágrafo só). Quando não separou, é o texto original.
   */
  emUmaLinha: string;
  original: string;
};

export type PedidoParaEndereco = {
  customerAddress?: string | null;
  deliveryType?: string | null;
  source?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | number | null;
  status?: string | null;
  tableNumber?: string | number | null;
  [k: string]: unknown;
};

/** Os canais em que o webhook põe a cidade do cliente SEMPRE por último. */
const CANAIS_COM_CIDADE_NO_FIM = new Set(["IFOOD", "BRENDI", "JOTAJA"]);

const UFS = new Set([
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]);

const espacos = (s: string) => s.replace(/\s+/g, " ").trim();
/** Tira separador sobrando nas pontas ("- Centro,", ", casa 2"). */
const aparar = (s: string) => s.replace(/^[\s,;|\-–—]+|[\s,;|\-–—]+$/g, "").trim();
const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Para comparar pedaços: sem acento, sem pontuação, sem o "Bairro:" na frente. */
const chave = (s: string) =>
  semAcento(s).replace(/^bairro\s*[:.]?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
const mesmo = (a: string, b: string) => Boolean(a) && Boolean(b) && chave(a) === chave(b);

/** "107", "54B", "1.234", "nº 30", "S/N", "Sn", "sem número". */
const NUMERO_RE = /^(?:(?:n[º°o]?\.?|num(?:ero)?\.?|número)\s*)?(?:\d{1,5}(?:\.\d{3})?\s*-?\s*[a-z]?|s\s*\/?\s*n[º°o]?|sem n[uú]mero)$/i;

const COMP_RE = /^comp(?:lemento)?\s*[:.]\s*/i;
const REF_RE = /^(?:ponto de )?ref(?:er[eê]ncia)?\s*[:.]\s*/i;

/** As palavras de um texto, para a conferência de "nada sumiu, nada apareceu". */
function palavras(texto: string): Set<string> {
  const t = semAcento(texto)
    // Rótulos que o canal escreveu e o papel troca pelo seu próprio.
    .replace(/\b(?:ponto de referencia|referencia|ref|complemento|comp|cep|bairro)\s*[:.]/g, " ")
    .replace(/\bcep\b/g, " ")
    // O país não é informação para o motoboy (JotaJá escreve "- Brasil -").
    .replace(/\bbrasil\b/g, " ")
    // "28890-000" e "28890000" são o mesmo CEP.
    .replace(/(\d)-(\d)/g, "$1$2");
  return new Set(t.split(/[^a-z0-9]+/).filter(Boolean));
}

type Pedaco = { texto: string; pos: number };

type Separacao = {
  rua: string;
  numero: string | null;
  complementos: string[];
  bairro: string | null;
  referencias: string[];
  cidade: string | null;
  cep: string | null;
};

/**
 * Lê o texto e devolve as peças, ou null quando nem a rua dá para achar.
 * Não confere nada — quem confere é `enderecoImpresso`.
 */
function separar(texto: string, opcoes: { cidadeNoFim: boolean; cidadeDaLoja: string }): Separacao | null {
  let t = espacos(texto);
  if (!t) return null;

  const complementos: Pedaco[] = [];
  const referencias: Pedaco[] = [];
  /** De que tipo era o trecho rotulado em cada posição ("Comp:" ou "Ref:"). */
  const rotuloDoTrecho = new Map<number, "comp" | "ref">();

  // CEP em qualquer lugar ("CEP 73053030", "28890-000").
  let cep: string | null = null;
  const mCep = t.match(/\bCEP[:\s]*(\d{5})-?(\d{3})\b/i) ?? t.match(/\b(\d{5})-(\d{3})\b/);
  if (mCep) {
    cep = `${mCep[1]}-${mCep[2]}`;
    t = espacos(t.replace(mCep[0], " "));
  }

  // O site põe o complemento entre parênteses, às vezes com " - " dentro
  // ("(BL A AP 203 - Cond. Caravelas)"): sai antes de quebrar por " - ".
  t = espacos(
    t.replace(/\(([^)]*)\)?/g, (_, dentro: string) => {
      const d = aparar(espacos(dentro || ""));
      if (REF_RE.test(d)) referencias.push({ texto: aparar(d.replace(REF_RE, "")), pos: 1000 });
      else if (d) complementos.push({ texto: d, pos: 1000 });
      return " ";
    }),
  );

  // Rodovia escrita com o hífen espaçado ("DF - 425", "BR - 101") não é duas partes.
  t = t.replace(/\b([A-Za-z]{2})\s+-\s+(\d{2,3})\b/g, (m, uf: string, n: string) =>
    UFS.has(uf.toUpperCase()) || uf.toUpperCase() === "BR" ? `${uf}-${n}` : m,
  );

  const trechos = t.split(/\s+[-–—]\s+/).map(aparar).filter(Boolean);
  if (trechos.length === 0) return null;

  const restantes: Pedaco[] = [];
  let cidade: string | null = null;
  let uf: string | null = null;
  /** O que veio depois da UF no 99Food ("RJ, portão branco"). */
  let depoisDaUf: string[] = [];
  /** Posição em `restantes` do trecho logo antes da UF solta. */
  let antesDaUf: number | null = null;
  let ufLogoDepoisDaRua = false;

  for (let i = 1; i < trechos.length; i++) {
    const s = trechos[i];
    if (COMP_RE.test(s)) {
      const c = aparar(s.replace(COMP_RE, ""));
      if (c) complementos.push({ texto: c, pos: i });
      rotuloDoTrecho.set(i, "comp");
      continue;
    }
    if (REF_RE.test(s)) {
      const r = aparar(s.replace(REF_RE, ""));
      if (r) referencias.push({ texto: r, pos: i });
      rotuloDoTrecho.set(i, "ref");
      continue;
    }
    if (semAcento(s) === "brasil") continue;
    // "Brasília/DF" (Wabiz): a cidade como foi escrita.
    const cidadeUf = s.match(/^(.+?)\s*\/\s*([A-Za-z]{2})$/);
    if (cidadeUf && UFS.has(cidadeUf[2].toUpperCase())) {
      cidade = s;
      continue;
    }
    // "RJ" ou "RJ, portão branco" (99Food, formato do Google).
    const ufSolta = s.match(/^([A-Z]{2})(?:\s*,\s*(.+))?$/);
    if (ufSolta && UFS.has(ufSolta[1])) {
      uf = ufSolta[1];
      depoisDaUf = (ufSolta[2] || "").split(",").map(aparar).filter((p) => p && semAcento(p) !== "brasil");
      const anterior = restantes[restantes.length - 1];
      if (anterior && anterior.pos === i - 1) antesDaUf = restantes.length - 1;
      else if (i === 1) ufLogoDepoisDaRua = true;
      continue;
    }
    restantes.push({ texto: s, pos: i });
  }

  // "Liberdade, Rio das Ostras - RJ" (99Food): o trecho antes da UF é
  // "bairro, cidade"; sem vírgula ("Rua 17 - Casimiro de Abreu - RJ") é só a cidade.
  let bairroAntesDaCidade: string | null = null;
  if (!cidade && antesDaUf !== null) {
    const [anterior] = restantes.splice(antesDaUf, 1);
    const v = anterior.texto.lastIndexOf(",");
    cidade = aparar(v > 0 ? anterior.texto.slice(v + 1) : anterior.texto);
    if (v > 0) bairroAntesDaCidade = aparar(anterior.texto.slice(0, v)) || null;
  }

  // iFood, Brendi e JotaJá terminam SEMPRE na cidade do cliente — que pode não
  // ser a da loja (Hakim Unamar entrega em Cabo Frio). O JotaJá a repete.
  if (!cidade && opcoes.cidadeNoFim && restantes.length > 0) {
    cidade = restantes.pop()!.texto;
    while (restantes.length > 0 && mesmo(restantes[restantes.length - 1].texto, cidade)) restantes.pop();
  }

  // Nos outros canais, a cidade só é reconhecida quando é a da loja.
  if (!cidade && opcoes.cidadeDaLoja) {
    for (let k = restantes.length - 1; k >= 0; k--) {
      const r = restantes[k].texto;
      if (mesmo(r, opcoes.cidadeDaLoja)) {
        cidade = r;
        restantes.splice(k, 1);
        break;
      }
      // "Sobradinho, Brasília": bairro e cidade no mesmo trecho.
      const v = r.lastIndexOf(",");
      if (v > 0 && mesmo(r.slice(v + 1), opcoes.cidadeDaLoja)) {
        cidade = aparar(r.slice(v + 1));
        restantes[k] = { texto: aparar(r.slice(0, v)), pos: restantes[k].pos };
        break;
      }
    }
  }

  // Primeiro trecho: "rua, número[, complemento..., bairro[, cidade]]".
  const pedacos = trechos[0].split(",").map(aparar).filter(Boolean);
  // O nome da rua com vírgula: "R. Ágatha,Lto Recanto Dos Paratis, 54B" (iFood,
  // que escreve "rua, número"). O que vem antes do número é rua, e não bairro.
  const ondeEstaONumero = pedacos.findIndex((p, k) => k > 0 && NUMERO_RE.test(p));
  const ateONumero = ondeEstaONumero > 1 && pedacos.slice(1, ondeEstaONumero).every((p) => !PEDACO_DA_CASA_RE.test(p))
    ? ondeEstaONumero
    : 1;
  const rua = pedacos.slice(0, ateONumero).join(", ");
  const extras = pedacos.slice(ateONumero);
  let numero: string | null = null;
  if (extras.length > 0 && NUMERO_RE.test(extras[0])) numero = extras.shift()!;
  // 99Food sem o número no poi_address: ele vem logo depois da UF.
  if (!numero && depoisDaUf.length > 0 && NUMERO_RE.test(depoisDaUf[0])) numero = depoisDaUf.shift()!;

  // O robô escreve "rua, nº, Bairro, Cidade" tudo com vírgula.
  if (!cidade && extras.length > 1 && opcoes.cidadeDaLoja && mesmo(extras[extras.length - 1], opcoes.cidadeDaLoja)) {
    cidade = extras.pop()!;
  }
  // "Rua X, 470, Operário, Rio das Ostras - RJ": a UF logo depois da rua diz
  // que a última peça com vírgula é a cidade.
  if (!cidade && ufLogoDepoisDaRua && extras.length > 0 && !PEDACO_DA_CASA_RE.test(extras[extras.length - 1])) {
    cidade = extras.pop()!;
  }
  if (cidade && uf && !/\/\s*[A-Za-z]{2}$/.test(cidade)) cidade = `${cidade} - ${uf}`;
  else if (!cidade && uf) cidade = uf;

  // ── O BAIRRO: a régua do relatório, e aqui só o lugar dele no texto ──
  let bairro: string | null = bairroAntesDaCidade;
  if (!bairro) {
    const cidadeSemUf = cidade ? cidade.replace(/\s*(?:\/|\s-\s)\s*[A-Za-z]{2}$/, "") : null;
    const achado = bairroDoEndereco(texto, {
      cidades: [opcoes.cidadeDaLoja, cidadeSemUf],
      ultimaParteEhCidade: opcoes.cidadeNoFim,
    });
    if (achado) {
      const k = [...restantes].reverse().findIndex((r) => mesmo(r.texto, achado));
      if (k >= 0) {
        bairro = restantes.splice(restantes.length - 1 - k, 1)[0].texto;
      } else {
        const j = [...extras].reverse().findIndex((e) => mesmo(e, achado));
        if (j >= 0) bairro = extras.splice(extras.length - 1 - j, 1)[0];
      }
    }
  }
  if (bairro) bairro = aparar(bairro.replace(/^bairro\s*[:.]?\s*/i, ""));

  // ── QUANDO A ÚLTIMA PARTE PODE SER BAIRRO OU CIDADE ──
  //
  // "Rua Paranaíba, 470, Operário, Rio das Ostras" (robô): sem nada que diga
  // qual peça é a cidade — UF, "Cidade/UF", o formato do canal ou a cidade da
  // loja —, a régua do bairro pega a ÚLTIMA ("Rio das Ostras") e o bairro de
  // verdade iria parar no complemento. O mesmo vale para a cidade vizinha que
  // não é a da loja ("…, Centro, Cabo Frio" numa loja de Rio das Ostras).
  // Sobrando ao lado do bairro uma peça com cara de lugar (não "casa 2",
  // "apto 3"), o papel imprime o texto original.
  if (bairro && !cidade) {
    const soltas = [...extras, ...restantes.map((r) => r.texto)];
    if (soltas.some((p) => !PEDACO_DA_CASA_RE.test(p) && !NUMERO_RE.test(p))) return null;
  }

  // O iFood não escapa o " - " de dentro da referência nem do complemento:
  // "Ref: casa azul - portão preto" chega em dois trechos. O que sobrou logo
  // depois de um trecho rotulado é continuação dele.
  for (const r of [...restantes].sort((a, b) => a.pos - b.pos)) {
    const tipo = rotuloDoTrecho.get(r.pos - 1);
    const lista = tipo === "ref" ? referencias : tipo === "comp" ? complementos : null;
    const dono = lista?.find((p) => p.pos === r.pos - 1);
    if (!tipo || !dono) continue;
    dono.texto = `${dono.texto} - ${r.texto}`;
    dono.pos = r.pos;
    rotuloDoTrecho.set(r.pos, tipo);
    restantes.splice(restantes.indexOf(r), 1);
  }

  // O resto é complemento, na ordem em que estava escrito.
  const todos: Pedaco[] = [
    ...extras.map((e, k) => ({ texto: e, pos: k / 100 })),
    ...restantes,
    ...complementos,
    ...depoisDaUf.map((d, k) => ({ texto: d, pos: 2000 + k })),
  ].sort((a, b) => a.pos - b.pos);

  return {
    rua,
    numero,
    complementos: todos.map((p) => p.texto).filter(Boolean),
    bairro,
    referencias: referencias.sort((a, b) => a.pos - b.pos).map((p) => p.texto).filter(Boolean),
    cidade,
    cep,
  };
}

/** "📍 Localização enviada pelo WhatsApp: <lugar> (-22.517000, -41.945000)" (lib/entrega-do-robo.ts). */
const LOCALIZACAO_DO_WHATSAPP_RE =
  /^📍\s*Localiza[çc][ãa]o enviada pelo WhatsApp(?::\s*(.*?))?\s*\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)\s*$/u;

function semSeparar(original: string): EnderecoImpresso {
  return { separado: false, linhas: [], emUmaLinha: original, original };
}

/**
 * As linhas do endereço deste pedido para o papel.
 *
 * `cidadeDaLoja` (User.city) é o que diz que "Rio das Ostras" no fim de
 * "Rua Paranaíba, 470, Operário, Rio das Ostras" é a cidade, e não o bairro.
 * Sem ela, esses formatos caem no texto original.
 */
export function enderecoImpresso(
  pedido: PedidoParaEndereco | null | undefined,
  opcoes: { cidadeDaLoja?: string | null } = {},
): EnderecoImpresso {
  const original = espacos(String(pedido?.customerAddress ?? ""));
  if (!original) return semSeparar(original);
  const cidadeDaLoja = espacos(String(opcoes.cidadeDaLoja ?? ""));
  const cidadeNoFim = CANAIS_COM_CIDADE_NO_FIM.has(chaveDoCanal(pedido as any));

  // O cliente do robô que só mandou a localização: o lugar que o WhatsApp
  // deu, e o ponto. O "📍" sumiria no papel (o Assistente só imprime ASCII).
  let texto = original;
  let localizacao: string | null = null;
  const loc = original.match(LOCALIZACAO_DO_WHATSAPP_RE);
  if (loc) {
    localizacao = `pelo WhatsApp (${loc[2]}, ${loc[3]})`;
    texto = espacos(loc[1] || "");
  }

  const s = texto ? separar(texto, { cidadeNoFim: loc ? false : cidadeNoFim, cidadeDaLoja }) : null;
  const linhas: LinhaDoEndereco[] = [];
  if (localizacao) linhas.push({ rotulo: "Localização", valor: localizacao });
  // Só a "rua" e mais nada: é um nome de lugar ("Suporte Técnico…"), não uma rua.
  const soARua = Boolean(s && s.rua && !s.numero && !s.complementos.length && !s.bairro && !s.referencias.length && !s.cidade && !s.cep);
  if (s && s.rua && !soARua) {
    linhas.push({ rotulo: "Rua", valor: s.rua });
    if (s.numero) linhas.push({ rotulo: "Número", valor: s.numero });
    if (s.complementos.length) linhas.push({ rotulo: "Complemento", valor: s.complementos.join(", ") });
    if (s.bairro) linhas.push({ rotulo: "Bairro", valor: s.bairro });
    if (s.referencias.length) linhas.push({ rotulo: "Referência", valor: s.referencias.join(", ") });
    if (s.cidade) linhas.push({ rotulo: "Cidade", valor: s.cidade });
    if (s.cep) linhas.push({ rotulo: "CEP", valor: s.cep });
  } else if (texto) {
    // Localização com um nome de lugar que não é endereço ("Suporte Técnico…").
    if (!localizacao) return semSeparar(original);
    linhas.push({ rotulo: "Endereço", valor: texto });
  }

  // Só a rua (texto solto do balcão, "quadra 05"): separar não ajuda ninguém.
  if (linhas.length < 2) return semSeparar(original);

  // ── A CONFERÊNCIA: nada sumiu, nada apareceu ──
  const antes = palavras(texto + (localizacao ? ` ${localizacao}` : ""));
  const depois = palavras(linhas.map((l) => l.valor).join(" "));
  for (const p of antes) if (!depois.has(p)) return semSeparar(original);
  for (const p of depois) if (!antes.has(p)) return semSeparar(original);

  return { separado: true, linhas, emUmaLinha: emUmaLinha(linhas), original };
}

/** "Rua Dez, 59 | Comp: Apto 4 | Bairro: Costazul | Ref: ... | Cidade: Rio das Ostras". */
function emUmaLinha(linhas: LinhaDoEndereco[]): string {
  const de = (r: RotuloDoEndereco) => linhas.find((l) => l.rotulo === r)?.valor;
  const rua = de("Rua");
  const numero = de("Número");
  const partes: string[] = [];
  const loc = de("Localização");
  if (loc) partes.push(`Localização ${loc}`);
  const lugar = de("Endereço");
  if (lugar) partes.push(lugar);
  if (rua) partes.push(numero ? `${rua}, ${numero}` : rua);
  const comp = de("Complemento");
  if (comp) partes.push(`Comp: ${comp}`);
  const bairro = de("Bairro");
  if (bairro) partes.push(`Bairro: ${bairro}`);
  const ref = de("Referência");
  if (ref) partes.push(`Ref: ${ref}`);
  const cidade = de("Cidade");
  if (cidade) partes.push(`Cidade: ${cidade}`);
  const cep = de("CEP");
  if (cep) partes.push(`CEP ${cep}`);
  return partes.join(" | ");
}

/**
 * Os campos do endereço para o pedido que vai ao Assistente — os DOIS trilhos
 * (fila da nuvem em api/store/print-queue e navegador em lib/print.ts) passam
 * por aqui, e a via do entregador e a reimpressão herdam do mesmo pedido.
 *
 *  - `enderecoImpresso`: as linhas. Assistente 1.2.31+ imprime uma por linha
 *    na seção ENTREGA; o antigo ignora o campo.
 *  - `customerAddress`: a mesma coisa numa linha só, rotulada. É o que TODA
 *    versão instalada imprime (o `wrap` do Assistente junta qualquer quebra de
 *    linha num parágrafo só, então não há como forçar linha nova pelo texto),
 *    e é o que melhora o papel hoje, sem esperar atualização.
 *
 * Só para entrega: o `customerAddress` da mesa é "Mesa 4", e o Assistente lê
 * o número da mesa dele.
 */
export function camposDoEnderecoParaImpressao(
  pedido: PedidoParaEndereco | null | undefined,
  cidadeDaLoja?: string | null,
): { customerAddress?: string; enderecoImpresso?: LinhaDoEndereco[] } {
  if (!pedido || String(pedido.deliveryType || "").toUpperCase() !== "DELIVERY") return {};
  // Já separado (a reimpressão guarda o pedido como saiu): ler de novo a
  // linha rotulada não acrescenta nada e poderia desfazer a separação.
  if (Array.isArray(pedido.enderecoImpresso) && pedido.enderecoImpresso.length > 0) return {};
  const e = enderecoImpresso(pedido, { cidadeDaLoja });
  if (!e.separado) return {};
  return { customerAddress: e.emUmaLinha, enderecoImpresso: e.linhas };
}
