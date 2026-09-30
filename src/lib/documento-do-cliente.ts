/**
 * O CPF/CNPJ que o cliente pede "na nota".
 *
 * ── O que é ─────────────────────────────────────────────────────────────────
 *
 * No balcão o cliente pede o CPF na nota. Até aqui o lançamento de venda não
 * tinha onde guardar isso: o atendente escrevia na observação do pedido — que
 * nem sai impressa em pedido de balcão (o Assistente só imprime `notes` dentro
 * do bloco ENTREGA) — ou não escrevia em lugar nenhum.
 *
 * O documento vai para `CustomerOrder.customerCpfCnpj`, a MESMA coluna que a
 * emissão fiscal já lê (lib/fiscal-automatico.ts e a rota store/fiscal/emitir).
 * Ou seja: além de sair na comanda, o balcão passa a chegar na NFC-e com o
 * destinatário preenchido, sem ninguém redigitar.
 *
 * ── Por que ele entra pelo NOME DO CLIENTE na comanda ───────────────────────
 *
 * Mesmo motivo do pager (lib/pager.ts, leia o cabeçalho de lá): quem imprime é
 * o Assistente instalado no PC da loja, e cada loja está na versão do dia em
 * que instalou. Campo novo no papel só apareceria nas lojas atualizadas — o
 * lojista digitaria o CPF e não sairia nada na maioria delas.
 *
 * Pelo nome funciona em TODA versão hoje, sem ninguém atualizar nada. O
 * documento vai TAMBÉM em campo próprio no payload (`customerCpfCnpj`), então
 * no dia em que o Assistente passar a imprimir a linha dedicada é só ele ler
 * dali — e `nomeComDocumento` sai de cena sem mexer em mais nada.
 *
 * ── Por que valida ──────────────────────────────────────────────────────────
 *
 * Porque este mesmo valor é o destinatário da nota fiscal. Um número digitado
 * errado não dá erro nenhum na hora da venda: dá REJEIÇÃO da SEFAZ depois, com
 * a fila esperando o cupom. Melhor recusar na tela, onde o cliente ainda está
 * na frente do atendente para repetir o número.
 */

import { documentoValido } from "@/lib/fiscal-validacao";

/** Como o número é escrito em qualquer lugar que o mostre. */
export const ETIQUETA_CPF = "CPF";
export const ETIQUETA_CNPJ = "CNPJ";

/**
 * Tira máscara e espaço. NÃO valida — é só a forma de guardar.
 *
 * Mantém letras porque o CNPJ alfanumérico (vigente desde julho/2026) tem 12
 * posições de letras/números antes dos dois dígitos verificadores; jogar fora
 * as letras transformaria um CNPJ válido num número de 2 dígitos.
 */
export function normalizarDocumento(bruto: unknown): string {
  return String(bruto ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * O documento que o cliente de fato informou, ou null quando não há.
 *
 * Existe por causa do JotaJá: quando o cliente não dá CPF, o parceiro manda
 * "00000000000" no `documentNumber`, e ele é gravado como veio. Em 30 dias
 * (24/09/2026) foram 138 de 150 pedidos JotaJá, 15 deles de RETIRADA. Lido
 * como documento, esse zero-zero é "CPF inválido": a nota de retirada, que
 * sairia sem destinatário, era recusada inteira, e a de entrega mandava
 * "corrigir ou tirar o documento", que o lojista não consegue tirar (com o
 * campo do modal em branco, a emissão volta ao valor gravado).
 *
 * Só zeros ou o mesmo caractere repetido em 11/14 posições é preenchimento de
 * campo obrigatório, não documento: vira "sem documento". Um número digitado
 * errado continua passando daqui e é recusado como inválido: esse o lojista
 * tem de corrigir.
 */
export function documentoDeVerdade(bruto: unknown): string | null {
  const d = normalizarDocumento(bruto);
  if (!d || /^0+$/.test(d)) return null;
  if ((d.length === 11 || d.length === 14) && /^(.)\1+$/.test(d)) return null;
  return d;
}

/** Já dá para saber o que o lojista está digitando? 11 = CPF, 14 = CNPJ. */
export function tipoDoDocumento(bruto: unknown): "CPF" | "CNPJ" | null {
  const d = normalizarDocumento(bruto);
  if (d.length === 11) return "CPF";
  if (d.length === 14) return "CNPJ";
  return null;
}

/**
 * O documento pronto para gravar, ou null quando não há.
 *
 * Devolve `null` tanto para campo vazio quanto para número inválido: quem
 * precisa diferenciar os dois casos (a tela e a API) usa `problemaDoDocumento`.
 */
export function lerDocumentoDoCliente(bruto: unknown): string | null {
  const d = normalizarDocumento(bruto);
  if (!d) return null;
  return documentoValido(d) ? d : null;
}

/**
 * O que está errado com o que foi digitado, em português, ou null se está bom.
 *
 * Campo vazio é `null`: o CPF na nota é OPCIONAL, e a venda de quem não pediu
 * não pode travar por causa de um campo que ninguém preencheu.
 */
export function problemaDoDocumento(bruto: unknown): string | null {
  const d = normalizarDocumento(bruto);
  if (!d) return null;
  if (d.length !== 11 && d.length !== 14) {
    return "CPF tem 11 dígitos e CNPJ tem 14. Confira o número digitado.";
  }
  if (!documentoValido(d)) {
    return d.length === 11
      ? "Este CPF não existe: os dígitos verificadores não batem."
      : "Este CNPJ não existe: os dígitos verificadores não batem.";
  }
  return null;
}

/** "12345678900" → "123.456.789-00". Número fora do padrão volta como veio. */
export function formatarDocumento(bruto: unknown): string {
  const d = normalizarDocumento(bruto);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

/**
 * A máscara enquanto o lojista DIGITA, sem atrapalhar quem ainda não terminou.
 *
 * Aplica o desenho de CPF até 11 caracteres e o de CNPJ daí em diante — é a
 * única forma de mascarar um campo que aceita os dois sem exigir que a pessoa
 * escolha antes qual vai digitar.
 */
export function mascararDocumentoDigitado(bruto: unknown): string {
  const d = normalizarDocumento(bruto).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}${d.length > 12 ? "-" + d.slice(12) : ""}`;
}

/** "CPF 123.456.789-00" — o jeito como o documento aparece no papel. */
export function etiquetaDoDocumento(bruto: unknown): string {
  const d = lerDocumentoDoCliente(bruto);
  if (!d) return "";
  return `${d.length === 11 ? ETIQUETA_CPF : ETIQUETA_CNPJ} ${formatarDocumento(d)}`;
}

/**
 * O nome que vai para a COMANDA, com o documento embutido.
 *
 * "João" + CPF          → "João · CPF 123.456.789-00"
 * "PAGER 12" + CPF      → "PAGER 12 · CPF 123.456.789-00"
 * "Balcão" + CPF        → "CPF 123.456.789-00"   (o rótulo genérico dá lugar)
 * sem documento         → o nome, intacto
 *
 * Recebe o nome JÁ passado por `nomeComPager`: os dois moram na mesma linha do
 * papel e a ordem importa — primeiro quem a loja chama (nome/pager), depois o
 * documento, que é para o cliente conferir.
 */
export function nomeComDocumento(nome: string | null | undefined, documento: unknown): string {
  const etiqueta = etiquetaDoDocumento(documento);
  const base = (nome || "").trim();
  if (!etiqueta) return base;
  if (!base || ehRotuloGenerico(base)) return etiqueta;
  return `${base} · ${etiqueta}`;
}

/** Os nomes que o sistema inventa quando ninguém digitou um de verdade. */
function ehRotuloGenerico(nome: string): boolean {
  const n = nome.toLowerCase();
  return n === "balcão" || n === "balcao" || n === "cliente" || n === "consumidor";
}

/**
 * O nome do cliente serve de destinatário da nota? "Cliente iFood", "Balcão",
 * "Mesa 3" são rótulos que o sistema ou o parceiro inventaram — na NFC-e o
 * destinatário sem nome é melhor que um destinatário chamado "Cliente iFood".
 */
export function nomeServeDeDestinatario(nome: string | null | undefined): boolean {
  const n = String(nome ?? "").trim().toLowerCase();
  if (n.length < 2) return false;
  if (ehRotuloGenerico(n)) return false;
  return !/^(cliente( ifood| 99food| jotaj[aá]| brendi| wabiz)?|mesa\s*\d*|balc[aã]o.*|pager\s*\d*)$/.test(n);
}

// ─── Endereço de entrega ────────────────────────────────────────────────────

/**
 * O endereço do cliente no formato que a NFC-e de entrega exige.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * NFC-e de entrega a domicílio (presença 4) sem endereço do destinatário é
 * rejeição 788 da SEFAZ ("NFC-e de entrega a domicílio sem o endereço do
 * destinatário"), e o endereço vai em campos separados: rua, número, bairro,
 * município, UF. O pedido só guarda `customerAddress` como TEXTO livre — nem
 * o site (que recebe rua, número e bairro separados no checkout e grava tudo
 * junto) nem o webhook do iFood (que recebe o endereço estruturado e grava
 * `formattedAddress - Comp - Ref - bairro - cidade`) guardam as peças.
 *
 * Então o texto é lido aqui, com os formatos que existem no banco (medidos em
 * 24/09/2026 nos pedidos da Hakim e da NIK):
 *
 *   iFood   "R. Itaperu, 107 - Comp: casa 1 - Ref: perto do colégio - Centro - Rio das Ostras"
 *   Site    "Rua Nova Iguaçu, 668 - Atlântica (BL A AP 203 - Cond. Caravelas)"
 *   JotaJá  "Rua Recife, 506, Casa 3 , Jardim Bela Vista - Rio das Ostras - Brasil - Rio das Ostras"
 *   Wabiz   "QD 5, Conjunto C - casa 14 - QUADRA 5 - Brasília/DF - CEP 73053030"
 *   99Food  "Rua Recife, 335 - Trindade, São Gonçalo - RJ, sobrado em cima da serralheria"
 *   Robô    "Rua Machado da Silva, 160, Recanto"
 *
 * O que não dá para ler com segurança NÃO é inventado: faltando bairro, a
 * leitura devolve o que falta e a emissão recusa com esse motivo. Mandar
 * "NÃO INFORMADO" no bairro passaria na SEFAZ (ela só confere o tamanho) e
 * seria documento fiscal com dado falso.
 *
 * Município e UF: a NFC-e só existe em operação interna (idDest = 1; fora
 * disso é rejeição), então a UF é sempre a da loja. O município é o da loja
 * quando o texto não diz outro — entrega de bairro é na cidade da loja.
 *
 * ── Onde o texto diz a cidade ───────────────────────────────────────────────
 *
 * Só dá para reconhecer uma cidade que NÃO é a da loja pela POSIÇÃO, porque
 * não há lista de municípios aqui. E ler a posição errado é o pior erro: a
 * cidade vizinha vira bairro e a nota sai com o município e o código IBGE da
 * loja, um destinatário que não existe. Foi o que aconteceu com as entregas
 * da Brazza (Rio das Ostras) para Casimiro de Abreu: 9 de 258 pelo 99Food em
 * 30 dias saíam com bairro "Barra de São João, Casimiro de Abreu".
 *
 *  - 99Food (formato do Google): "rua, nº - BAIRRO, CIDADE - UF[, complemento]".
 *    O trecho logo antes da UF termina na cidade, seja ela qual for.
 *  - iFood, Brendi e JotaJá (`cidadeNoFim`): o webhook põe a cidade por
 *    último, sempre. Quando o iFood omite o bairro (ele o apaga se já está no
 *    nome da rua), sobra UM trecho, e esse trecho é a cidade: vira município,
 *    e a falta de bairro recusa. O JotaJá repete a cidade ("... - Casimiro de
 *    Abreu - Brasil - Casimiro de Abreu"): a repetição não é bairro.
 *  - DF: o Distrito Federal tem um município só, Brasília. O Google chama a
 *    região administrativa de cidade ("Sobradinho II, Sobradinho - DF"), e
 *    ela é o que o iFood chama de bairro. Na NFC-e o município é Brasília.
 */
export type EnderecoDoCliente = {
  logradouro: string;
  /** "S/N" quando o texto não traz número — é o que a SEFAZ aceita. */
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string | null;
  /** O município não estava no texto: veio da loja. */
  municipioDaLoja: boolean;
};

export type LeituraDoEndereco =
  | { ok: true; endereco: EnderecoDoCliente }
  | { ok: false; falta: string[]; parcial: Partial<EnderecoDoCliente> };

const UFS = new Set([
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]);

const semAcento = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Os campos de endereço da NF-e têm no máximo 60 caracteres. */
const ate60 = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, 60).trim();

export function lerEnderecoDeEntrega(
  texto: string | null | undefined,
  daLoja: { municipio?: string | null; uf?: string | null },
  opcoes: { cidadeNoFim?: boolean } = {}
): LeituraDoEndereco {
  let t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, falta: ["endereço"], parcial: {} };

  const municipioDaLoja = String(daLoja.municipio ?? "").trim();
  const ufDaLoja = String(daLoja.uf ?? "").trim().toUpperCase();
  const ehACidadeDaLoja = (s: string) => Boolean(municipioDaLoja) && semAcento(s) === semAcento(municipioDaLoja);

  const complementos: string[] = [];
  let cep: string | null = null;
  let municipio: string | null = null;
  let uf: string | null = null;

  // CEP em qualquer lugar ("CEP 73053030", "28890-000").
  const mCep = t.match(/\bCEP[:\s]*(\d{5})-?(\d{3})\b/i) ?? t.match(/\b(\d{5})-(\d{3})\b/);
  if (mCep) {
    cep = mCep[1] + mCep[2];
    t = t.replace(mCep[0], " ").replace(/\s+/g, " ").trim();
  }

  // O site põe o complemento entre parênteses, com " - " dentro às vezes
  // ("(BL A AP 203 - Cond. Caravelas)"): sai antes de quebrar por " - ".
  // Referência não é complemento (é "perto da padaria") e fica de fora.
  t = t.replace(/\(([^)]*)\)/g, (_, dentro: string) => {
    const d = dentro.trim();
    if (d && !/^ref(er[eê]ncia)?\s*:/i.test(d)) complementos.push(d);
    return " ";
  }).replace(/\s+/g, " ").trim();

  // Sobra de separador nas pontas (o CEP saiu do fim e deixou o " -").
  const trechos = t
    .split(/\s+-\s+/)
    .map((s) => s.replace(/^[\s,\-–]+|[\s,\-–]+$/g, "").trim())
    .filter(Boolean);
  if (trechos.length === 0) return { ok: false, falta: ["endereço"], parcial: {} };

  const restantes: string[] = [];
  // De qual trecho veio o último item de `restantes`: a cidade do 99Food só é
  // lida no trecho IMEDIATAMENTE antes da UF.
  let origemDoUltimo = -1;
  // Posição, em `restantes`, do trecho logo antes da UF solta. Só é usada
  // depois do laço, se nada mais forte (a cidade da loja, "Cidade/UF") disse
  // a cidade: na Wabiz "... - Módulo X casa 01 - DF - 425 - Brasília/DF" o
  // "DF" é a rodovia DF-425, e o trecho antes dele não é cidade nenhuma.
  let antesDaUf: number | null = null;
  for (let i = 1; i < trechos.length; i++) {
    const s = trechos[i];
    if (/^comp(lemento)?\s*:/i.test(s)) {
      const c = s.replace(/^comp(lemento)?\s*:\s*/i, "").trim();
      if (c) complementos.push(c);
      continue;
    }
    if (/^ref(er[eê]ncia)?\s*:/i.test(s)) continue;
    if (semAcento(s) === "brasil") continue;

    // "Brasília/DF" (Wabiz)
    const cidadeUf = s.match(/^(.+?)\s*\/\s*([A-Za-z]{2})$/);
    if (cidadeUf && UFS.has(cidadeUf[2].toUpperCase())) {
      municipio = cidadeUf[1].trim();
      uf = cidadeUf[2].toUpperCase();
      continue;
    }
    // "DF" ou "DF, apartamento em cima da conveniência" (99Food)
    const ufSolta = s.match(/^([A-Za-z]{2})(?:\s*,\s*(.+))?$/);
    if (ufSolta && UFS.has(ufSolta[1].toUpperCase()) && ufSolta[1] === ufSolta[1].toUpperCase()) {
      uf = ufSolta[1].toUpperCase();
      if (ufSolta[2]) complementos.push(ufSolta[2].trim());
      if (restantes.length > 0 && origemDoUltimo === i - 1) antesDaUf = restantes.length - 1;
      continue;
    }
    if (ehACidadeDaLoja(s)) {
      municipio = municipio ?? s;
      continue;
    }
    // "Sobradinho, Brasília": bairro e cidade no mesmo trecho.
    const virgula = s.lastIndexOf(",");
    if (virgula > 0 && ehACidadeDaLoja(s.slice(virgula + 1))) {
      municipio = municipio ?? s.slice(virgula + 1).trim();
      restantes.push(s.slice(0, virgula).trim());
      origemDoUltimo = i;
      continue;
    }
    restantes.push(s);
    origemDoUltimo = i;
  }

  // "Barra de São João, Casimiro de Abreu - RJ" (99Food): o trecho antes da
  // UF é "bairro, cidade", e a parte da esquerda é o bairro, venha o que vier
  // depois. Sem vírgula ("Rua 17 - Casimiro de Abreu - RJ") é só a cidade.
  let bairroAntesDaCidade: string | null = null;
  if (!municipio && antesDaUf !== null) {
    const [anterior] = restantes.splice(antesDaUf, 1);
    const v = anterior.lastIndexOf(",");
    municipio = (v > 0 ? anterior.slice(v + 1) : anterior).trim();
    if (v > 0) bairroAntesDaCidade = anterior.slice(0, v).trim() || null;
  }

  // iFood, Brendi e JotaJá terminam SEMPRE na cidade. Quando ela não é a da
  // loja (entrega na cidade vizinha), o último trecho é a cidade, não o bairro
  // — mesmo quando é o ÚNICO trecho que sobrou ("R. Alagoas, 574 - Comp: Casa
  // - Casimiro de Abreu", iFood sem bairro). A repetição da cidade logo antes
  // (JotaJá) sai junto.
  if (opcoes.cidadeNoFim && !municipio && restantes.length >= 1) {
    municipio = restantes.pop()!;
    while (restantes.length > 0 && semAcento(restantes[restantes.length - 1]) === semAcento(municipio)) restantes.pop();
  }

  // DF: a "cidade" do texto que não é Brasília é região administrativa.
  let regiaoAdministrativa: string | null = null;
  if ((uf || ufDaLoja) === "DF" && municipio && semAcento(municipio) !== "brasilia") {
    regiaoAdministrativa = municipio;
    municipio = ufDaLoja === "DF" ? null : "Brasília";
  }

  // Primeiro trecho: "rua, número[, complemento..., bairro]".
  const partes = trechos[0].split(",").map((s) => s.trim()).filter(Boolean);
  const logradouro = partes[0] ?? "";
  let numero: string | null = null;
  const extras = partes.slice(1);
  // Segunda parte sem algarismo não é número ("Rua X, Centro"): é bairro ou
  // complemento, e o número fica "S/N".
  if (extras.length > 0 && (/\d/.test(extras[0]) || /^s\s*\/?\s*n$/i.test(extras[0]))) {
    numero = extras.shift()!;
  }
  // O robô do WhatsApp escreve "rua, nº, Bairro, Cidade" tudo com vírgula: a
  // cidade no fim da lista não é o bairro.
  while (extras.length > 1 && ehACidadeDaLoja(extras[extras.length - 1])) {
    const cidade = extras.pop()!;
    municipio = municipio ?? cidade;
  }

  let bairro: string | null = null;
  if (bairroAntesDaCidade) {
    bairro = bairroAntesDaCidade;
    complementos.unshift(...extras, ...restantes);
  } else if (restantes.length > 0) {
    bairro = restantes.pop()!;
    complementos.unshift(...extras, ...restantes);
  } else if (extras.length > 0) {
    bairro = extras.pop()!;
    complementos.unshift(...extras);
  } else if (regiaoAdministrativa) {
    // "Rua X - Sobradinho - DF": a região administrativa faz as vezes de bairro.
    bairro = regiaoAdministrativa;
  }
  // Número não é bairro. "R. Ágatha,Lto Recanto Dos Paratis, 54B" (iFood, o
  // nome da rua com vírgula) deixava "54B" como bairro, e a SEFAZ só confere o
  // tamanho. Adivinhar o bairro nas outras partes da rua daria "bloco H" ou
  // "Condomínio Fibral" (medido nos endereços da NIK): sem bairro, recusa.
  if (bairro && /^(\d+\s*[a-z]?|s\s*\/?\s*n)$/i.test(bairro.trim())) {
    numero = numero ?? bairro;
    bairro = null;
  }

  const parcial: Partial<EnderecoDoCliente> = {
    logradouro: ate60(logradouro),
    numero: ate60(numero || "S/N"),
    complemento: complementos.length ? ate60(complementos.join(", ")) : null,
    bairro: bairro ? ate60(bairro) : undefined,
    municipio: ate60(municipio || municipioDaLoja),
    uf: uf || ufDaLoja,
    cep,
    municipioDaLoja: !municipio || ehACidadeDaLoja(municipio),
  };

  const falta: string[] = [];
  if (!parcial.logradouro || parcial.logradouro.length < 2) falta.push("rua");
  if (!parcial.bairro || parcial.bairro.length < 2) falta.push("bairro");
  if (!parcial.municipio || parcial.municipio.length < 2) falta.push("município");
  if (!parcial.uf || !UFS.has(parcial.uf)) falta.push("UF");
  if (falta.length > 0) return { ok: false, falta, parcial };

  return { ok: true, endereco: parcial as EnderecoDoCliente };
}
