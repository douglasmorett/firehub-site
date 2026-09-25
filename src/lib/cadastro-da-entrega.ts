/**
 * O CADASTRO DA ENTREGA — faixas de km, bairros e áreas desenhadas —
 * validado e normalizado num lugar só, para a tela e para o servidor.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Até 25/09/2026 o /api/store-settings gravava `deliveryZones` do jeito que
 * chegasse: km repetido, km zero, taxa negativa, tempo zero, JSON qualquer. E
 * a tela só perguntava sobre taxa zero no modo "Desenhar no mapa" — a R&D
 * Pizzaria entregou de graça a 10 km com as três faixas de KM a R$ 0,00.
 *
 * O caso que fechou a conta foi a Divinos Burger: para cadastrar as 9 faixas
 * reais dela (1 km R$ 5 • motoboy R$ 4 … 5 km R$ 20 • R$ 19) a tela precisa
 * aceitar meio quilômetro, o repasse do motoboy por faixa, e dizer NA HORA
 * quando uma faixa ficou sem o valor do motoboy — porque faixa sem valor não
 * pega o da seguinte: cai no acerto do entregador (R6), e a loja só
 * descobriria no fechamento.
 *
 * É PURO de propósito (sem banco, sem rede): a tela roda a mesma validação
 * antes de mandar, e o servidor roda de novo antes de gravar. Uma regra, dois
 * lugares que a aplicam — nunca duas regras.
 *
 * Teste: scripts/teste-cadastro-da-entrega.ts
 */

/** Uma faixa de distância (modos KM e ROTA). `km` é o limite INCLUSIVO: "até X km". */
export type FaixaDeKm = {
  km: number;
  time: number;
  fee: number;
  /** Quanto o motoboy recebe nesta faixa. Ausente = a faixa não tem valor (≠ zero). */
  motoboyFee?: number;
  /** A loja confirmou que o motoboy recebe MAIS do que o cliente paga (ex.: entrega grátis com motoboy pago). */
  repasseAcimaDaTaxa?: true;
};

export type BairroDoCadastro = {
  name: string;
  time: number;
  fee: number;
  motoboyFee?: number;
  repasseAcimaDaTaxa?: true;
};

/** Área desenhada: `repasse` é o nome que lib/area-de-entrega.ts lê. */
export type AreaDoCadastro = {
  nome: string;
  pontos: [number, number][];
  time: number;
  fee: number;
  repasse?: number;
  repasseAcimaDaTaxa?: true;
};

/** Os tipos que a tela grava hoje (KM, ROTA, NEIGHBORHOOD, POLIGONO) e os nomes antigos ainda no banco. */
export type TipoDeCobranca = "KM" | "RADIUS" | "DISTANCE" | "ROTA" | "NEIGHBORHOOD" | "POLIGONO";

const TIPOS: TipoDeCobranca[] = ["KM", "RADIUS", "DISTANCE", "ROTA", "NEIGHBORHOOD", "POLIGONO"];

export type CampoDoCadastro = "km" | "time" | "fee" | "motoboyFee" | "name" | "pontos" | "cadastro";

export type Problema = {
  /** Posição do item na lista que ENTROU (antes de ordenar). -1 = a lista inteira. */
  indice: number;
  campo: CampoDoCadastro;
  nivel: "erro" | "aviso";
  /** Para a tela transformar o erro em pergunta (ex.: repasse acima da taxa). */
  codigo?: "REPASSE_ACIMA_DA_TAXA" | "REPASSE_FALTANDO" | "TAXA_MENOR_QUE_A_ANTERIOR" | "REPASSE_MENOR_QUE_O_ANTERIOR" | "SEM_NOME_IGNORADO";
  mensagem: string;
};

export type ResultadoDoCadastro<T> = {
  ok: boolean;
  zonas: T[];
  problemas: Problema[];
  erros: string[];
  avisos: string[];
};

/**
 * Tetos contra erro de digitação, não regra de negócio. 100 km não é faixa de
 * moto (e acima de 60 km o mapa já trata como rua homônima em outra cidade);
 * R$ 500 de entrega é "5,00" digitado sem a vírgula.
 */
export const LIMITES_DO_CADASTRO = {
  kmMax: 100,
  taxaMax: 500,
  tempoMax: 600,
  faixasMax: 50,
  bairrosMax: 400,
  areasMax: 50,
  pontosMax: 500,
  nomeMax: 80,
} as const;

/** Folga só na ÚLTIMA faixa: 5,05 km ainda atende na faixa de 5 km (R5). Em centésimos de km. */
const FOLGA_DA_ULTIMA_CENT = 5;

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * O número que a pessoa digitou, do jeito que ela digita: "1,5", "1.5",
 * "R$ 5,00", "1.234,50". Vazio (ou lixo) vira null — e null NÃO é zero: é
 * "não preencheu", que para o repasse do motoboy muda a regra (R6).
 */
export function lerValorDigitado(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let t = v.replace(/r\$/gi, "").replace(/\s+/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) {
    // "1.234,50": ponto de milhar, vírgula decimal.
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    t = t.replace(",", ".");
  }
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** O tipo de cobrança, se for um que existe. */
export function tipoDeCobranca(t: unknown): TipoDeCobranca | null {
  const s = String(t ?? "").trim().toUpperCase();
  return (TIPOS as string[]).includes(s) ? (s as TipoDeCobranca) : null;
}

/** Faixa de km: raio (KM, e os nomes antigos RADIUS/DISTANCE) ou km percorrido (ROTA). */
export function ehCobrancaPorDistancia(t: unknown): boolean {
  const tipo = tipoDeCobranca(t);
  return tipo === "KM" || tipo === "RADIUS" || tipo === "DISTANCE" || tipo === "ROTA";
}

export function formatarKm(km: number): string {
  return String(centavos(km)).replace(".", ",");
}

export function formatarReais(v: number): string {
  return `R$ ${centavos(v).toFixed(2).replace(".", ",")}`;
}

/** Nome para comparar bairro com bairro: sem acento, sem caixa, sem espaço duplo. */
function chaveDoNome(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function montarResultado<T>(zonas: T[], problemas: Problema[]): ResultadoDoCadastro<T> {
  const erros = problemas.filter((p) => p.nivel === "erro").map((p) => p.mensagem);
  const avisos = problemas.filter((p) => p.nivel === "aviso").map((p) => p.mensagem);
  return { ok: erros.length === 0, zonas, problemas, erros, avisos };
}

type Valores = { fee: number | null; time: number | null; repasse: number | null };

/**
 * Taxa, tempo e repasse — as três coisas que faixa, bairro e área têm em comum.
 * `rotulo` é como a pessoa reconhece o item na mensagem ("Faixa até 2 km").
 */
function lerValores(z: any, i: number, rotulo: string, campoDoRepasse: "motoboyFee" | "repasse", problemas: Problema[]): Valores {
  const L = LIMITES_DO_CADASTRO;
  const erro = (campo: CampoDoCadastro, mensagem: string, codigo?: Problema["codigo"]) =>
    problemas.push({ indice: i, campo, nivel: "erro", mensagem, ...(codigo ? { codigo } : {}) });

  let fee = lerValorDigitado(z?.fee);
  if (fee == null) { erro("fee", `${rotulo}: falta a taxa que o cliente paga (use 0 para entrega grátis).`); }
  else if (fee < 0) { erro("fee", `${rotulo}: a taxa não pode ser negativa.`); fee = null; }
  else if (fee > L.taxaMax) { erro("fee", `${rotulo}: taxa de ${formatarReais(fee)} — confira a vírgula (máximo ${formatarReais(L.taxaMax)}).`); fee = null; }
  else fee = centavos(fee);

  let time = lerValorDigitado(z?.time);
  if (time == null) { erro("time", `${rotulo}: falta o tempo de entrega (em minutos).`); }
  else if (Math.round(time) <= 0) { erro("time", `${rotulo}: o tempo de entrega tem que ser maior que zero.`); time = null; }
  else if (time > L.tempoMax) { erro("time", `${rotulo}: ${Math.round(time)} minutos de entrega — confira o número (máximo ${L.tempoMax}).`); time = null; }
  else time = Math.round(time);

  // O repasse aceita o nome do outro cadastro: área desenhada guarda
  // `repasse`, faixa e bairro guardam `motoboyFee`. Quem manda um no lugar do
  // outro não perde o valor.
  const bruto = campoDoRepasse === "repasse" ? (z?.repasse ?? z?.motoboyFee) : (z?.motoboyFee ?? z?.repasse);
  let repasse = lerValorDigitado(bruto);
  if (repasse != null) {
    if (repasse < 0) { erro("motoboyFee", `${rotulo}: o valor do motoboy não pode ser negativo.`); repasse = null; }
    else if (repasse > L.taxaMax) { erro("motoboyFee", `${rotulo}: motoboy recebe ${formatarReais(repasse)} — confira a vírgula (máximo ${formatarReais(L.taxaMax)}).`); repasse = null; }
    else repasse = centavos(repasse);
  }

  // Motoboy recebendo MAIS que o cliente paga é legítimo (entrega grátis com
  // motoboy pago é o caso comum), mas tem que ser dito: é a loja que cobre a
  // diferença de cada entrega, e um "14" digitado no lugar de "4" também cai
  // aqui.
  if (repasse != null && fee != null && repasse > fee && z?.repasseAcimaDaTaxa !== true) {
    erro(
      "motoboyFee",
      `${rotulo}: o motoboy recebe ${formatarReais(repasse)} e o cliente paga ${formatarReais(fee)} — a loja cobre a diferença. Confirme para salvar assim.`,
      "REPASSE_ACIMA_DA_TAXA",
    );
  }
  return { fee, time, repasse };
}

/**
 * Faixa sem valor do motoboy NÃO pega o valor da faixa seguinte (R6): devolve
 * nulo e o acerto cai na regra de cada entregador. Numa tabela em que umas
 * faixas têm valor e outras não, o motoboy recebe por duas regras diferentes
 * conforme a distância — e ninguém percebe até o fechamento. Por isso é tudo
 * ou nada.
 */
function exigirRepasseEmTodas(itens: { indice: number; tem: boolean; rotulo: string }[], problemas: Problema[]) {
  const com = itens.filter((x) => x.tem).length;
  if (com === 0 || com === itens.length) return;
  for (const x of itens) {
    if (x.tem) continue;
    problemas.push({
      indice: x.indice, campo: "motoboyFee", nivel: "erro", codigo: "REPASSE_FALTANDO",
      mensagem: `${x.rotulo}: falta quanto o motoboy recebe. Preencha em todas (use 0 se ele não recebe nada) ou deixe todas vazias.`,
    });
  }
}

/**
 * As faixas de km, validadas e em ordem crescente.
 *
 * Aceita `km`, `maxKm` e `radius` (nomes antigos) e grava só `km`. Campos que
 * nenhuma leitura usa ficam de fora: o cadastro é JSON livre no banco, e a
 * rota não pode ser porta para gravar qualquer coisa nele.
 */
export function normalizarFaixasDeKm(bruto: unknown): ResultadoDoCadastro<FaixaDeKm> {
  const problemas: Problema[] = [];
  const L = LIMITES_DO_CADASTRO;
  if (!Array.isArray(bruto) || bruto.length === 0) {
    // Sem faixa nenhuma, a loja que cobra por distância cai em "sem área" —
    // e "sem área" atende qualquer endereço do mundo.
    problemas.push({ indice: -1, campo: "cadastro", nivel: "erro", mensagem: "Cadastre pelo menos uma faixa de distância." });
    return montarResultado([], problemas);
  }
  if (bruto.length > L.faixasMax) {
    problemas.push({ indice: -1, campo: "cadastro", nivel: "erro", mensagem: `São ${bruto.length} faixas — o máximo é ${L.faixasMax}.` });
    return montarResultado([], problemas);
  }

  const lidas = bruto.map((z: any, i: number) => {
    let km = lerValorDigitado(z?.km ?? z?.maxKm ?? z?.radius);
    const rotuloKm = km != null && km > 0 ? `Faixa até ${formatarKm(km)} km` : `Faixa ${i + 1}`;
    if (!z || typeof z !== "object" || Array.isArray(z)) {
      problemas.push({ indice: i, campo: "cadastro", nivel: "erro", mensagem: `Faixa ${i + 1}: cadastro ilegível.` });
      return { i, km: null, v: { fee: null, time: null, repasse: null } as Valores, confirmado: false, rotulo: rotuloKm };
    }
    if (km == null) { problemas.push({ indice: i, campo: "km", nivel: "erro", mensagem: `${rotuloKm}: falta até quantos km ela vai.` }); }
    else if (centavos(km) <= 0) { problemas.push({ indice: i, campo: "km", nivel: "erro", mensagem: `${rotuloKm}: a distância tem que ser maior que zero.` }); km = null; }
    else if (km > L.kmMax) { problemas.push({ indice: i, campo: "km", nivel: "erro", mensagem: `${rotuloKm}: ${formatarKm(km)} km não é faixa de entrega — confira o número (máximo ${L.kmMax} km).` }); km = null; }
    else km = centavos(km);
    const v = lerValores(z, i, rotuloKm, "motoboyFee", problemas);
    return { i, km, v, confirmado: z.repasseAcimaDaTaxa === true, rotulo: rotuloKm };
  });

  // Km repetido: duas faixas "até 2 km" — qual taxa vale? A primeira que o
  // `find` achar, que depende da ordem em que a tela mandou. Não se grava.
  const vistos = new Map<number, number>();
  for (const f of lidas) {
    if (f.km == null) continue;
    const cent = Math.round(f.km * 100);
    if (vistos.has(cent)) {
      problemas.push({ indice: f.i, campo: "km", nivel: "erro", mensagem: `Duas faixas com ${formatarKm(f.km)} km. Cada faixa precisa de uma distância diferente.` });
    } else vistos.set(cent, f.i);
  }

  exigirRepasseEmTodas(lidas.map((f) => ({ indice: f.i, tem: f.v.repasse != null, rotulo: f.rotulo })), problemas);

  const zonas: FaixaDeKm[] = lidas
    .filter((f) => f.km != null && f.v.fee != null && f.v.time != null)
    .map((f) => ({
      km: f.km as number,
      time: f.v.time as number,
      fee: f.v.fee as number,
      ...(f.v.repasse != null ? { motoboyFee: f.v.repasse } : {}),
      ...(f.v.repasse != null && f.v.repasse > (f.v.fee as number) && f.confirmado ? { repasseAcimaDaTaxa: true as const } : {}),
    }))
    .sort((a, b) => a.km - b.km);

  // Faixa mais longe cobrando MENOS que a mais perto quase sempre é engano (o
  // "adicionar faixa" antigo criava +1 km a R$ 10 depois de uma de R$ 12). Não
  // bloqueia — promoção de bairro distante existe —, mas a tela pergunta.
  const ordenadas = lidas
    .filter((f) => f.km != null)
    .sort((a, b) => (a.km as number) - (b.km as number));
  for (let k = 1; k < ordenadas.length; k++) {
    const antes = ordenadas[k - 1], agora = ordenadas[k];
    if (antes.v.fee != null && agora.v.fee != null && agora.v.fee < antes.v.fee) {
      problemas.push({
        indice: agora.i, campo: "fee", nivel: "aviso", codigo: "TAXA_MENOR_QUE_A_ANTERIOR",
        mensagem: `A faixa até ${formatarKm(agora.km as number)} km cobra ${formatarReais(agora.v.fee)}, menos que a de até ${formatarKm(antes.km as number)} km (${formatarReais(antes.v.fee)}).`,
      });
    }
    if (antes.v.repasse != null && agora.v.repasse != null && agora.v.repasse < antes.v.repasse) {
      problemas.push({
        indice: agora.i, campo: "motoboyFee", nivel: "aviso", codigo: "REPASSE_MENOR_QUE_O_ANTERIOR",
        mensagem: `Na faixa até ${formatarKm(agora.km as number)} km o motoboy recebe ${formatarReais(agora.v.repasse)}, menos que na de até ${formatarKm(antes.km as number)} km (${formatarReais(antes.v.repasse)}).`,
      });
    }
  }

  return montarResultado(zonas, problemas);
}

/**
 * Os bairros atendidos, validados, na ordem em que a loja cadastrou.
 *
 * Linha sem nome é a do "Adicionar bairro" que ficou em branco: não é bairro,
 * sai com aviso em vez de travar o salvar.
 */
export function normalizarBairros(bruto: unknown): ResultadoDoCadastro<BairroDoCadastro> {
  const problemas: Problema[] = [];
  const L = LIMITES_DO_CADASTRO;
  if (!Array.isArray(bruto)) {
    problemas.push({ indice: -1, campo: "cadastro", nivel: "erro", mensagem: "Cadastre pelo menos um bairro." });
    return montarResultado([], problemas);
  }
  if (bruto.length > L.bairrosMax) {
    problemas.push({ indice: -1, campo: "cadastro", nivel: "erro", mensagem: `São ${bruto.length} bairros — o máximo é ${L.bairrosMax}.` });
    return montarResultado([], problemas);
  }

  const vistos = new Map<string, number>();
  const lidos: { i: number; name: string; v: Valores; confirmado: boolean }[] = [];
  bruto.forEach((z: any, i: number) => {
    const name = String(z?.name ?? z?.nome ?? "").replace(/\s+/g, " ").trim();
    if (!name) {
      problemas.push({ indice: i, campo: "name", nivel: "aviso", codigo: "SEM_NOME_IGNORADO", mensagem: `A linha ${i + 1} da lista de bairros está sem nome e não será salva.` });
      return;
    }
    const rotulo = `Bairro ${name}`;
    if (name.length > L.nomeMax) {
      problemas.push({ indice: i, campo: "name", nivel: "erro", mensagem: `${rotulo.slice(0, 40)}…: nome longo demais (máximo ${L.nomeMax} letras).` });
    }
    const chave = chaveDoNome(name);
    if (vistos.has(chave)) {
      problemas.push({ indice: i, campo: "name", nivel: "erro", mensagem: `O bairro ${name} aparece duas vezes. Deixe um só, com a taxa certa.` });
    } else vistos.set(chave, i);
    const v = lerValores(z, i, rotulo, "motoboyFee", problemas);
    lidos.push({ i, name, v, confirmado: z?.repasseAcimaDaTaxa === true });
  });

  if (lidos.length === 0) {
    problemas.push({ indice: -1, campo: "cadastro", nivel: "erro", mensagem: "Cadastre pelo menos um bairro." });
  }
  exigirRepasseEmTodas(lidos.map((b) => ({ indice: b.i, tem: b.v.repasse != null, rotulo: `Bairro ${b.name}` })), problemas);

  const zonas: BairroDoCadastro[] = lidos
    .filter((b) => b.v.fee != null && b.v.time != null && b.name.length <= L.nomeMax)
    .map((b) => ({
      name: b.name,
      time: b.v.time as number,
      fee: b.v.fee as number,
      ...(b.v.repasse != null ? { motoboyFee: b.v.repasse } : {}),
      ...(b.v.repasse != null && b.v.repasse > (b.v.fee as number) && b.confirmado ? { repasseAcimaDaTaxa: true as const } : {}),
    }));
  return montarResultado(zonas, problemas);
}

/** As áreas desenhadas: contorno com pelo menos 3 pontos válidos, taxa, tempo e repasse. */
export function normalizarAreas(bruto: unknown): ResultadoDoCadastro<AreaDoCadastro> {
  const problemas: Problema[] = [];
  const L = LIMITES_DO_CADASTRO;
  if (!Array.isArray(bruto) || bruto.length === 0) {
    problemas.push({ indice: -1, campo: "cadastro", nivel: "erro", mensagem: "Desenhe pelo menos uma área de entrega no mapa." });
    return montarResultado([], problemas);
  }
  if (bruto.length > L.areasMax) {
    problemas.push({ indice: -1, campo: "cadastro", nivel: "erro", mensagem: `São ${bruto.length} áreas — o máximo é ${L.areasMax}.` });
    return montarResultado([], problemas);
  }

  const lidas = bruto.map((z: any, i: number) => {
    const nome = (String(z?.nome ?? z?.name ?? "").replace(/\s+/g, " ").trim() || `Área ${i + 1}`).slice(0, L.nomeMax);
    const rotulo = `Área ${nome}`;
    let pontosBrutos: unknown = z?.pontos;
    if (typeof pontosBrutos === "string") {
      try { pontosBrutos = JSON.parse(pontosBrutos); } catch { pontosBrutos = []; }
    }
    const pontos = (Array.isArray(pontosBrutos) ? pontosBrutos : [])
      .map((p: any) => [Number(p?.[0] ?? p?.lat), Number(p?.[1] ?? p?.lng)] as [number, number])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
    if (pontos.length < 3) {
      problemas.push({ indice: i, campo: "pontos", nivel: "erro", mensagem: `${rotulo}: o contorno precisa de pelo menos 3 pontos no mapa.` });
    } else if (pontos.length > L.pontosMax) {
      problemas.push({ indice: i, campo: "pontos", nivel: "erro", mensagem: `${rotulo}: ${pontos.length} pontos — o máximo é ${L.pontosMax}.` });
    }
    const v = lerValores(z, i, rotulo, "repasse", problemas);
    return { i, nome, pontos, v, rotulo, confirmado: z?.repasseAcimaDaTaxa === true };
  });

  exigirRepasseEmTodas(lidas.map((a) => ({ indice: a.i, tem: a.v.repasse != null, rotulo: a.rotulo })), problemas);

  const zonas: AreaDoCadastro[] = lidas
    .filter((a) => a.pontos.length >= 3 && a.pontos.length <= L.pontosMax && a.v.fee != null && a.v.time != null)
    .map((a) => ({
      nome: a.nome,
      pontos: a.pontos,
      time: a.v.time as number,
      fee: a.v.fee as number,
      ...(a.v.repasse != null ? { repasse: a.v.repasse } : {}),
      ...(a.v.repasse != null && a.v.repasse > (a.v.fee as number) && a.confirmado ? { repasseAcimaDaTaxa: true as const } : {}),
    }));
  return montarResultado(zonas, problemas);
}

/**
 * O cadastro inteiro, pelo tipo de cobrança. É o que o servidor chama antes de
 * gravar `deliveryZoneType` + `deliveryZones`.
 */
export function normalizarCadastroDeEntrega(
  tipo: unknown,
  zonas: unknown,
): ResultadoDoCadastro<FaixaDeKm | BairroDoCadastro | AreaDoCadastro> & { tipo: TipoDeCobranca | null } {
  const t = tipoDeCobranca(tipo);
  if (!t) {
    return {
      ...montarResultado<FaixaDeKm>([], [{ indice: -1, campo: "cadastro", nivel: "erro", mensagem: `Método de cobrança desconhecido: "${String(tipo ?? "")}".` }]),
      tipo: null,
    };
  }
  // O cadastro pode chegar em TEXTO (JSON serializado duas vezes por um import
  // ou integração) — lido aqui, gravado como lista.
  let lista: unknown = zonas;
  if (typeof lista === "string") {
    try { lista = JSON.parse(lista); } catch { lista = null; }
  }
  if (t === "NEIGHBORHOOD") return { ...normalizarBairros(lista), tipo: t };
  if (t === "POLIGONO") return { ...normalizarAreas(lista), tipo: t };
  return { ...normalizarFaixasDeKm(lista), tipo: t };
}

/**
 * Em que faixa cai esta distância — a regra R5, em centésimos de km para não
 * depender de ponto flutuante na borda (5 + 0,05 não é 5,05 em double):
 *
 *   - a distância é arredondada a 0,01 km;
 *   - o limite é INCLUSIVO ("até 2 km" inclui 2,00);
 *   - folga de 0,05 km só na ÚLTIMA faixa (5,05 atende na de 5 km; 5,06 é FORA);
 *   - sem km mínimo: 0 km cai na primeira faixa.
 *
 * O repasse é o DA FAIXA, e nulo quando ela não tem valor — nunca o da faixa
 * seguinte (R6).
 *
 * Usado pelo simulador da tela de Entrega para mostrar a faixa da tabela que
 * a loja está editando, antes de salvar. A cobrança de verdade é a do servidor
 * (lib/geocoding.ts), com a mesma regra.
 */
export function faixaDaDistancia(
  faixas: { km: number; fee: number; time?: number; motoboyFee?: number | null }[],
  distanciaKm: number,
): { resultado: "ATENDE" | "FORA" | "SEM_FAIXA"; km: number; faixa: { km: number; fee: number; time: number | null; motoboyFee: number | null } | null; naFolga: boolean } {
  const cent = Math.round(Math.max(0, Number(distanciaKm) || 0) * 100);
  const km = cent / 100;
  const validas = (Array.isArray(faixas) ? faixas : [])
    .map((f) => ({
      cent: Math.round((Number(f?.km) || 0) * 100),
      km: Number(f?.km) || 0,
      fee: Number(f?.fee) || 0,
      time: f?.time == null || !Number.isFinite(Number(f.time)) ? null : Number(f.time),
      motoboyFee: f?.motoboyFee == null || !Number.isFinite(Number(f.motoboyFee)) ? null : Number(f.motoboyFee),
    }))
    .filter((f) => f.cent > 0)
    .sort((a, b) => a.cent - b.cent);
  if (validas.length === 0) return { resultado: "SEM_FAIXA", km, faixa: null, naFolga: false };
  const semCent = ({ cent: _c, ...f }: (typeof validas)[number]) => { void _c; return f; };
  const achada = validas.find((f) => cent <= f.cent);
  if (achada) return { resultado: "ATENDE", km, faixa: semCent(achada), naFolga: false };
  const ultima = validas[validas.length - 1];
  if (cent <= ultima.cent + FOLGA_DA_ULTIMA_CENT) return { resultado: "ATENDE", km, faixa: semCent(ultima), naFolga: true };
  return { resultado: "FORA", km, faixa: null, naFolga: false };
}

/**
 * O que a prévia "com a tabela desta tela (ainda não salva)" do simulador pode
 * dizer, a partir de UMA resposta de /api/delivery-fee dada com a tabela SALVA.
 *
 * A distância que voltou só serve para outra tabela quando foi medida de um
 * jeito que não depende da tabela salva:
 *
 *   - ROTA: o servidor só pergunta ao roteador quando a linha reta cabe na
 *     tabela SALVA (até a última faixa + 0,05 km — lib/geocoding.ts). Acima
 *     disso devolve a linha reta, com `medida: "linha-reta"`. A loja que
 *     estendia a tabela 1/3/5 km para 6 km R$ 14 e 7 km R$ 16 simulava um
 *     endereço a 5,5 km em linha reta (≈ 7,7 km pela rua) e a prévia dizia
 *     "faixa até 6 km — R$ 14"; ela salvava achando que atendia, e o cliente
 *     recebia "fora da área". Com a linha reta só dá para afirmar o FORA (pela
 *     rua é ainda mais longe); o resto pede salvar para medir pela rua.
 *   - Ponto que não decide (não achado, aproximado, "confirme no mapa"): a
 *     faixa de um palpite não é resposta — nem com a tabela salva, nem com a
 *     da tela.
 *   - Área de risco: fica fora com qualquer tabela.
 *
 * `null`: não há o que mostrar (sem distância, ou tabela da tela sem faixa).
 */
export type PreviaDaTabelaDaTela =
  | {
      tipo: "faixa";
      resultado: "ATENDE" | "FORA";
      km: number;
      faixa: { km: number; fee: number; time: number | null; motoboyFee: number | null } | null;
      naFolga: boolean;
      /** FORA já em linha reta, num cadastro por rota: pela rua só aumenta. */
      foraJaEmLinhaReta: boolean;
    }
  | { tipo: "sem-previa"; motivo: "PONTO_INCERTO" | "AREA_DE_RISCO" | "SEM_MEDIDA_PELA_RUA" };

export function previaDaTabelaDaTela(
  metodo: unknown,
  resposta: {
    distanceKm?: number | null;
    medida?: string | null;
    unknown?: boolean;
    precisaConfirmarNoMapa?: boolean;
    pedeConfirmacao?: boolean;
  },
  faixas: { km: number; fee: number; time?: number; motoboyFee?: number | null }[],
  naAreaDeRisco: boolean,
): PreviaDaTabelaDaTela | null {
  const d = resposta?.distanceKm;
  if (d == null || !Number.isFinite(Number(d))) return null;
  if (resposta.precisaConfirmarNoMapa === true || resposta.unknown === true || resposta.pedeConfirmacao === true) {
    return { tipo: "sem-previa", motivo: "PONTO_INCERTO" };
  }
  if (naAreaDeRisco) return { tipo: "sem-previa", motivo: "AREA_DE_RISCO" };
  const r = faixaDaDistancia(faixas, Number(d));
  if (r.resultado === "SEM_FAIXA") return null;
  const medidaPelaRua = resposta.medida === "rota" || resposta.medida === "estimada";
  if (tipoDeCobranca(metodo) === "ROTA" && !medidaPelaRua) {
    if (r.resultado === "FORA") return { tipo: "faixa", resultado: "FORA", km: r.km, faixa: null, naFolga: false, foraJaEmLinhaReta: true };
    return { tipo: "sem-previa", motivo: "SEM_MEDIDA_PELA_RUA" };
  }
  return { tipo: "faixa", resultado: r.resultado, km: r.km, faixa: r.faixa, naFolga: r.naFolga, foraJaEmLinhaReta: false };
}

/**
 * As zonas gravadas em `deliveryZones`, lidas do MESMO jeito que o motor
 * (lib/area-de-entrega.ts: `zonas()` e `pontosDaZona()`): lista, ou TEXTO com
 * a lista (JSON serializado duas vezes por um import ou uma integração), e o
 * contorno da área também em texto.
 *
 * A tela de Entrega lia só lista. Com o cadastro em texto ela abria com as
 * faixas (ou os bairros) de FÁBRICA como se fossem da loja — e o primeiro
 * Salvar, mesmo só para arrastar o pino, gravava os 2 bairros de exemplo por
 * cima dos 44 que o cardápio estava usando, sem aviso.
 *
 * `ilegivel`: havia ALGO gravado que não se lê como lista (texto que não é
 * JSON, objeto solto, contorno em texto quebrado). A tela não pode pôr os
 * valores de exemplo no lugar sem perguntar.
 */
export function lerZonasGravadas(bruto: unknown): { zonas: any[]; ilegivel: boolean } {
  let lista: unknown = bruto;
  if (lista === null || lista === undefined) return { zonas: [], ilegivel: false };
  if (typeof lista === "string") {
    if (!lista.trim()) return { zonas: [], ilegivel: false };
    try { lista = JSON.parse(lista); } catch { return { zonas: [], ilegivel: true }; }
    if (lista === null) return { zonas: [], ilegivel: false };
  }
  if (!Array.isArray(lista)) {
    // `{}` é "nada cadastrado" (o padrão de uma coluna JSON), não cadastro quebrado.
    const vazio = typeof lista === "object" && lista !== null && Object.keys(lista).length === 0;
    return { zonas: [], ilegivel: !vazio };
  }
  let ilegivel = false;
  const zonas = lista.map((z: any) => {
    if (!z || typeof z !== "object" || typeof z.pontos !== "string") return z;
    try {
      const pontos = JSON.parse(z.pontos);
      if (Array.isArray(pontos)) return { ...z, pontos };
    } catch {}
    ilegivel = true;
    return { ...z, pontos: [] };
  });
  return { zonas, ilegivel };
}

/**
 * A escolha "o motoboy recebe um valor por faixa" (`separado`) depois do
 * Salvar da tela de Entrega: mandar ou não, e o que a tela passa a mostrar.
 *
 * A tela abre com um PALPITE (ligada quando o cadastro tem valores de
 * motoboy) e o GET do carregamento corrige para o gravado. Se esse GET falhava,
 * o Salvar mandava o palpite como se fosse escolha da loja: a loja com
 * `separado: false` e valores antigos nas faixas só arrastava o pino, e o
 * repasse por faixa ligava sozinho — pedidos do site, balcão e robô passavam a
 * pagar o motoboy pelos valores velhos.
 *
 * Agora só se grava o que a loja ESCOLHEU (clicou numa das opções). Sem
 * clique, o que a tela mostra é espelho do servidor ou palpite — e nenhum dos
 * dois é decisão: nem liga o repasse por um palpite, nem desfaz o que outra
 * aba acabou de gravar. A leitura de conferência depois do Salvar
 * (`lidaAgora`) é a mais recente e vence a do carregamento; com ela
 * desligada, a tela passa a mostrar desligado.
 */
export function escolhaDoRepasseParaGravar(p: {
  /** O `separado` lido no carregamento da tela (null = a leitura falhou ou não voltou ainda). */
  lidaAoAbrir: boolean | null;
  /** O lido na conferência depois de salvar (null = não leu). */
  lidaAgora: boolean | null;
  /** O que a tela mostra. */
  naTela: boolean;
  /** A loja clicou numa das opções. */
  lojaEscolheu: boolean;
}): { mandar: boolean | null; gravada: boolean | null; telaPassaA: boolean; naoLida: boolean } {
  const gravada = p.lidaAgora ?? p.lidaAoAbrir;
  if (!p.lojaEscolheu) {
    // Sem escolha, não grava. A tela passa a mostrar o gravado do mesmo jeito
    // que o carregamento faria: desligado desliga; ligado mantém o que a tela
    // mostra (ligado com as faixas em branco dá no mesmo que desligado).
    return { mandar: null, gravada, telaPassaA: gravada === false ? false : p.naTela, naoLida: gravada === null };
  }
  return { mandar: gravada === p.naTela ? null : p.naTela, gravada, telaPassaA: p.naTela, naoLida: false };
}

/** O atalho "motoboy recebe a taxa − R$ X": nunca negativo. */
export function repasseDescontado(taxa: number, desconto: number): number {
  return Math.max(0, centavos((Number(taxa) || 0) - (Number(desconto) || 0)));
}

/** JSON com as chaves em ordem: o Postgres devolve jsonb com as chaves reordenadas. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * O cadastro que chegou é o mesmo que já está gravado? O "Salvar" de outras
 * seções manda as zonas junto, sem mexer nelas; revalidar aí travaria o
 * salvar do nome da loja por causa de uma faixa antiga — a correção acontece
 * quando a loja abrir a tela de Entrega, que valida tudo antes de mandar.
 */
export function mesmoCadastro(a: unknown, b: unknown): boolean {
  const ler = (x: unknown) => {
    if (typeof x === "string") { try { return JSON.parse(x); } catch { return x; } }
    return x;
  };
  return canonico(ler(a)) === canonico(ler(b));
}

/**
 * O que o /api/store-settings faz com `deliveryZoneType` + `deliveryZones`
 * que chegaram no corpo, diante do que está gravado.
 *
 *   - "manter": nada veio, ou veio exatamente o que já está gravado (o
 *     "Salvar Tudo" de outras seções manda as zonas junto sem mexer nelas —
 *     revalidar ali travaria o salvar do nome da loja por uma faixa antiga).
 *   - "gravar": o cadastro novo, já normalizado.
 *   - "recusar": o cadastro novo tem erro; nada é gravado.
 *
 * Nulo NÃO apaga: `deliveryZones` nulo é loja "sem área", e sem área a loja
 * atende qualquer endereço do mundo (lib/area-de-entrega.ts). Apagar o
 * cadastro de entrega não acontece por um campo vazio no corpo.
 */
export function cadastroParaGravar(
  gravado: { tipo: unknown; zonas: unknown },
  corpo: { deliveryZoneType?: unknown; deliveryZones?: unknown },
):
  | { acao: "manter" }
  | { acao: "gravar"; tipo: TipoDeCobranca; zonas: (FaixaDeKm | BairroDoCadastro | AreaDoCadastro)[]; avisos: string[] }
  | { acao: "recusar"; erro: string; erros: string[] } {
  const tipoVeio = corpo.deliveryZoneType !== undefined && corpo.deliveryZoneType !== null && corpo.deliveryZoneType !== "";
  const zonasVieram = corpo.deliveryZones !== undefined && corpo.deliveryZones !== null;
  if (!tipoVeio && !zonasVieram) return { acao: "manter" };
  const tipoFinal = tipoVeio ? corpo.deliveryZoneType : gravado.tipo;
  const zonasFinais = zonasVieram ? corpo.deliveryZones : gravado.zonas;
  const semMudanca =
    String(tipoFinal ?? "").toUpperCase() === String(gravado.tipo ?? "").toUpperCase() &&
    mesmoCadastro(zonasFinais, gravado.zonas ?? null);
  if (semMudanca) return { acao: "manter" };
  const cadastro = normalizarCadastroDeEntrega(tipoFinal, zonasFinais);
  if (!cadastro.ok || !cadastro.tipo) {
    return { acao: "recusar", erro: `Não salvei a área de entrega: ${cadastro.erros[0] || "cadastro inválido."}`, erros: cadastro.erros };
  }
  return { acao: "gravar", tipo: cadastro.tipo, zonas: cadastro.zonas, avisos: cadastro.avisos };
}

/**
 * A regra de repasse depois do salvar de UMA tela.
 *
 * `separado` ("o motoboy recebe um valor por faixa") é decidido na tela de
 * Entrega; `marketplace` e `valorFixoApp`, na aba Motoboys. A aba Motoboys
 * mandava `separado: true` em todo clique e ligava o repasse por faixa de lojas
 * que nunca preencheram "Motoboy recebe". Agora campo AUSENTE no corpo mantém
 * o que está gravado, e campos que outra versão da regra tenha guardado
 * continuam lá.
 */
export function mesclarRegraDeRepasse(gravada: unknown, corpo: unknown): Record<string, unknown> & {
  separado: boolean;
  marketplace: "APP" | "TABELA" | "FIXO";
  valorFixoApp: number | null;
} {
  const anterior = gravada && typeof gravada === "object" && !Array.isArray(gravada) ? (gravada as Record<string, unknown>) : {};
  const r = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : {};
  const marketplaceDe = (v: unknown): "APP" | "TABELA" | "FIXO" => (v === "APP" ? "APP" : v === "FIXO" ? "FIXO" : "TABELA");
  const valorDe = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  };
  return {
    ...anterior,
    separado: typeof r.separado === "boolean" ? r.separado : anterior.separado === true,
    marketplace: r.marketplace !== undefined ? marketplaceDe(r.marketplace) : marketplaceDe(anterior.marketplace),
    valorFixoApp: "valorFixoApp" in r ? valorDe(r.valorFixoApp) : valorDe(anterior.valorFixoApp),
  };
}
