// @ts-nocheck
/* eslint-disable */
/**
 * GERADO por scripts/gerar-comanda-do-assistente.mjs — NÃO EDITE AQUI.
 *
 * É o código que monta a comanda no Assistente de Impressão
 * (firehub-print-assistant/server.js, versão 1.2.25), copiado para a prévia
 * de "Personalizar impressão" desenhar o papel com o MESMO código que imprime.
 * Mudou o server.js? Rode o script de novo; `--conferir` falha enquanto esta
 * cópia estiver velha.
 */

// No navegador não há Buffer: o buildEscPos devolve o texto "binário" (um
// caractere por byte) em vez do Buffer que ele manda para a impressora.
const Buffer = { from: (texto) => texto };

function cleanAscii(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/º/g, ".")
    .replace(/ª/g, ".")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "c")
    // Remove o que sobrou fora do ASCII imprimivel (emoji, simbolos).
    // Sem isto um emoji no nome do item vira byte alto e sai lixo na bobina.
    .replace(/[^\x20-\x7E\n]/g, "");
}

function documentoDoCliente(bruto) {
  const d = String(bruto == null ? "" : bruto).toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return "";
}

function nomeSemDocumento(nome) {
  const limpo = String(nome == null ? "" : nome).trim();
  if (!limpo) return "";
  const semSufixo = limpo.replace(/[^0-9A-Za-z]*\b(?:CPF|CNPJ)\b[\s.:/-]*[0-9A-Za-z.\/-]*\s*$/i, "").trim();
  // Sobrou so pontuacao (o nome era o proprio documento): nada a imprimir.
  return /[0-9A-Za-z]/.test(semSufixo) ? semSufixo : "";
}

function normalizarCombo(raw) {
  if (!raw) return [];

  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }

  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    const achatado = [];
    for (const grupo of Object.values(parsed)) {
      if (!grupo || typeof grupo !== "object" || Array.isArray(grupo)) continue;
      for (const [nome, qtd] of Object.entries(grupo)) {
        const n = Number(qtd);
        if (nome && Number.isFinite(n) && n > 0) achatado.push({ name: nome, quantity: n });
      }
    }
    parsed = achatado;
  }

  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((s) => (typeof s === "string" ? { name: s, quantity: 1 } : s))
    .filter((s) => s && s.name);
}

function buildEscPos(order, storeName, columns = 48, profile = "safe") {
  // Largura saneada AQUI, e nao so no site: o assistente e alcancavel por
  // qualquer pagina em localhost e pela fila da nuvem, entao o site nunca e a
  // unica fonte. Sem isto um valor invalido viraria bytes arbitrarios no GS W
  // (NaN & 0xFF = 0, ou seja GS W 0 0 = area de impressao ZERO).
  const colsRaw = Number(columns);
  columns = Number.isFinite(colsRaw) ? Math.max(24, Math.min(64, Math.floor(colsRaw))) : 48;

  const ESC = "\x1B", GS = "\x1D", LF = "\x0A";
  const INIT = ESC + "@";
  const BOLD_ON = ESC + "E\x01";
  const BOLD_OFF = ESC + "E\x00";
  const CENTER = ESC + "a\x01", LEFT = ESC + "a\x00";
  const DOUBLE_HEIGHT = GS + "!\x01";
  const DOUBLE_SIZE = GS + "!\x11";
  const DOUBLE_OFF = GS + "!\x00";
  const CUT = GS + "V\x00", FEED = ESC + "d\x04";

  const divider = "-".repeat(columns) + LF;

  // Quebra por palavra. `indent` e a indentacao das linhas de continuacao.
  // Palavra unica maior que a linha e cortada no limite (nao ha alternativa).
  // Sem isto o texto sai numa linha unica e quem quebra e a IMPRESSORA, no
  // ponto que ela quiser -- foi assim que "Endereco: ... Ma / cae" apareceu.
  const wrap = (text, width, indent = 0) => {
    const t = cleanAscii(text).replace(/\s+/g, " ").trim();
    if (!t) return [];
    const w = Math.max(4, width);
    const out = [];
    let cur = "";
    const capacity = () => (out.length === 0 ? w : Math.max(1, w - indent));
    const flush = () => { if (cur) { out.push(cur); cur = ""; } };

    for (const rawWord of t.split(" ")) {
      let word = rawWord;
      while (word.length > capacity()) {
        if (cur) { flush(); continue; }   // fecha a linha em curso antes de cortar
        out.push(word.slice(0, capacity()));
        word = word.slice(capacity());
      }
      if (!word) continue;
      const cand = cur ? cur + " " + word : word;
      if (cand.length > capacity()) { flush(); cur = word; }
      else cur = cand;
    }
    flush();

    const pad = " ".repeat(indent);
    return out.map((l, i) => (i === 0 ? l : pad + l));
  };

  const wrapLines = (text, indent = 0) =>
    wrap(text, columns, indent).map(l => l + LF).join("");

  // Centralizacao NO CODIGO. Antes o titulo era centralizado pela IMPRESSORA
  // (ESC a 1) sobre a largura FISICA dela, enquanto o corpo era preenchido pelo
  // codigo ate `columns`: duas larguras de referencia no mesmo cupom. Agora o
  // layout inteiro e determinado por `columns`, seja qual for o perfil ESC/POS.
  const centerLine = (text) => {
    const t = cleanAscii(text).trim();
    // Se ja cabe, preserva o espacamento interno original: o cabecalho usa
    // espaco duplo como separador visual entre numero, tipo e referencia.
    if (t.length <= columns) {
      return " ".repeat(Math.max(0, Math.floor((columns - t.length) / 2))) + t + LF;
    }
    return wrap(t, columns)
      .map(l => " ".repeat(Math.max(0, Math.floor((columns - l.length) / 2))) + l + LF)
      .join("");
  };

  const makeHeaderTitle = (title) => centerLine(cleanAscii(title).toUpperCase());

  // ── AS PALAVRAS QUE A LOJA REESCREVEU ─────────────────────────────────
  //
  // "Nome:", "Subtotal:", "Forma de pagamento:" eram literais aqui dentro, e
  // trocar qualquer uma exigia versao nova do Assistente em todas as lojas.
  // Agora cada bloco pode trazer `rotulos` (src/lib/comanda-modelo.ts no
  // site), e o catalogo ROTULOS_DO_BLOCO de la e o contrato: cada chave tem um
  // R() aqui. Chave sem par de um dos lados e pior que chave nenhuma — a
  // previa mostra a palavra nova e o papel sai com a antiga.
  //
  // Vale tambem para o layout EMBUTIDO (este, abaixo), nao so para
  // aplicarModelo(): a loja que so reescreveu uma palavra, sem reordenar nada,
  // continua sem mandar modelo personalizado — e ela tem que ver a palavra
  // dela no papel do mesmo jeito.
  const rotulosPorTipo = {};
  for (const bl of (Array.isArray(order.blocos) ? order.blocos : [])) {
    if (bl && bl.tipo && bl.rotulos && typeof bl.rotulos === "object") rotulosPorTipo[bl.tipo] = bl.rotulos;
  }
  const R = (tipo, chave, padrao) => {
    const v = rotulosPorTipo[tipo] && rotulosPorTipo[tipo][chave];
    return typeof v === "string" && v.trim() ? cleanAscii(v.trim()) : padrao;
  };

  // ── O NEGRITO QUE A LOJA MARCOU ───────────────────────────────────────
  //
  // Mesmo contrato dos rotulos, chave por chave. Tres estados: `true` liga,
  // `false` desliga e ausente mantem o de fabrica — sem o `false` explicito
  // nao haveria como TIRAR o negrito de "Forma de Pagamento:" ou de "Total:",
  // que ja nascem marcados aqui.
  //
  // So negrito, e nao corpo: negrito nao muda quantas letras cabem na linha,
  // entao pode ser ligado em cima de uma secao ja montada sem reformatar nada.
  const negritosPorTipo = {};
  for (const bl of (Array.isArray(order.blocos) ? order.blocos : [])) {
    if (bl && bl.tipo && bl.negritos && typeof bl.negritos === "object") negritosPorTipo[bl.tipo] = bl.negritos;
  }
  const N = (tipo, chave, padrao) => {
    const v = negritosPorTipo[tipo] && negritosPorTipo[tipo][chave];
    return typeof v === "boolean" ? v : !!padrao;
  };
  /** Liga/desliga o negrito de um trecho ja montado, conforme a marcacao. */
  const comNegrito = (texto, tipo, chave, padrao) =>
    N(tipo, chave, padrao) ? BOLD_ON + texto + BOLD_OFF : texto;

  // ── O CORPO QUE A LOJA ESCOLHEU (Bloco.corpos) ────────────────────────
  //
  // Mesmo contrato dos rotulos e dos negritos. A lista de chaves e CURTA de
  // proposito: corpo por linha muda quantas letras cabem, e secao ja quebrada
  // na largura da bobina nao pode ser reformatada por fora (ver o comentario
  // de `Bloco.negritos` em src/lib/comanda-modelo.ts). So entra a linha que e
  // frase FIXA, sozinha na linha, e cuja largura e calculada por quem a amplia.
  // Hoje: a faixa de bebida.
  const TAMANHOS_OK = [1, 1.5, 2, 3];
  const corposPorTipo = {};
  for (const bl of (Array.isArray(order.blocos) ? order.blocos : [])) {
    if (bl && bl.tipo && bl.corpos && typeof bl.corpos === "object") corposPorTipo[bl.tipo] = bl.corpos;
  }
  const C = (tipo, chave, padrao) => {
    const v = Number(corposPorTipo[tipo] && corposPorTipo[tipo][chave]);
    return TAMANHOS_OK.includes(v) ? v : padrao;
  };

  // ── OS AVISOS QUE A LOJA DESLIGOU (Personalizar impressao > Avisos) ────
  //
  // Pedido do dono (23/09/2026): "nao quero aviso de cobrar o cliente na
  // entrega, por exemplo — ai o cara desmarca la". O servidor so manda a
  // chave que a loja DESLIGOU (`false`); ausente e ligado, entao Assistente
  // antigo e loja que nunca abriu a aba imprimem como sempre. A lista de
  // chaves e a de AVISOS_DA_COMANDA em src/lib/comanda-modelo.ts.
  //
  // A entrega parceira ("NAO USAR MOTOBOY DA LOJA") nao tem chave de
  // proposito: desligada, a loja manda o proprio motoboy num pedido que ja
  // tem entregador do app a caminho.
  const avisosDesligados = (order && order.avisos && typeof order.avisos === "object") ? order.avisos : {};
  const avisoLigado = (chave) => avisosDesligados[chave] !== false;

  // ── TEXTO AMPLIADO FORA DO aplicarModelo ──────────────────────────────
  //
  // O layout embutido so tinha DOUBLE_HEIGHT (altura dobrada, largura igual).
  // Para o numero do pedido e a observacao saírem como saem na comanda do
  // iFood, o texto precisa ser ampliado NA LARGURA tambem — e aí a conta de
  // quantas letras cabem muda, e o recuo tem que sair em colunas NORMAIS,
  // antes do comando de tamanho. E a mesma regra de `linha()` em
  // aplicarModelo(); as duas existem porque uma vale para o modelo da loja e
  // outra para o papel de fabrica, e nenhuma pode divergir da previa do site.
  const ampliado = (texto, mult, opcoes = {}) => {
    const n = Number(mult) || 1;
    const fonteB = n > 1 && n < 2 && profile !== "legacy";
    const cmd = ESC + "M" + String.fromCharCode(fonteB ? 1 : 0)
              + GS + "!" + String.fromCharCode(n >= 3 ? 0x22 : n >= 1.5 ? 0x11 : 0x00);
    const reset = ESC + "M" + String.fromCharCode(0) + GS + "!" + String.fromCharCode(0);
    const partes = wrap(texto, Math.max(4, Math.floor(columns / n)));
    let s = "";
    for (const p of partes) {
      const sobra = Math.max(0, columns - Math.round(p.length * n));
      const recuo = opcoes.centro ? Math.floor(sobra / 2) : 0;
      s += " ".repeat(recuo) + cmd + (opcoes.negrito ? BOLD_ON : "") + p
         + (opcoes.negrito ? BOLD_OFF : "") + reset + LF;
    }
    return s;
  };

  /**
   * O corpo do numero do pedido no app e o da observacao do cliente.
   *
   * Os mesmos valores de DESTAQUE_DO_NUMERO_NO_APP e DESTAQUE_DA_OBSERVACAO
   * em src/lib/comanda-modelo.ts. Decisao do dono (19/09/2026): o numero e o
   * que a loja procura no app com o cliente no telefone, e a observacao e o
   * que a cozinha erra — os dois tinham o mesmo corpo do resto do papel.
   */
  const CORPO_DO_NUMERO_NO_APP = 2;
  const CORPO_DA_OBSERVACAO = 1.5;

  /**
   * Como o canal se ESCREVE no papel.
   *
   * `order.source` e a chave do banco ("99FOOD", "JOTAJA"); o que a loja le no
   * telefone e outra coisa. Sem este mapa o papel saia "99FOOD" e "JOTAJA",
   * e o pedido pago da Wabiz saia "(Pago via Online)" — que nao diz onde
   * procurar o pedido. O par disto e canalDoPedido() em src/lib.
   */
  const NOME_DO_CANAL = {
    IFOOD: "iFood",
    "99FOOD": "99Food",
    JOTAJA: "JotaJa",
    BRENDI: "Brendi",
    WABIZ: "Wabiz",
  };

  // rightAlign e makeBoxLine eram byte-a-byte identicas: viram uma so.
  // Em vez de TRUNCAR o rotulo (o que comia o fim do nome do produto), quebra
  // em linhas e alinha o valor a direita na ultima.
  const padLine = (leftStr, rightStr) => {
    const r = cleanAscii(rightStr);
    const room = Math.max(4, columns - r.length - 1); // pelo menos 1 espaco antes do valor
    const parts = wrap(leftStr, room, 2);
    if (!parts.length) return " ".repeat(Math.max(0, columns - r.length)) + r + LF;
    let out = "";
    for (let i = 0; i < parts.length - 1; i++) out += parts[i] + LF;
    const last = parts[parts.length - 1];
    out += last + " ".repeat(Math.max(1, columns - last.length - r.length)) + r + LF;
    return out;
  };
  const rightAlign = padLine;
  const makeBoxLine = padLine;

  // QR code em ESC/POS: GS ( k, o comando do padrao Epson que as POS-58/80
  // genericas seguem. Impressora que NAO conhece o comando simplesmente o
  // ignora (os dados de funcao ficam fora do fluxo de texto). Quem decide se
  // tenta e o perfil: o "legacy" e o das impressoras que imprimem lixo com
  // comando desconhecido, e nele o QR nem e montado.
  const qrEscPos = (dados, modulo = 6) => {
    const d = String(dados);
    const len = d.length + 3;
    const pL = String.fromCharCode(len & 0xff);
    const pH = String.fromCharCode((len >> 8) & 0xff);
    return GS + "(k" + "\x04\x00" + "\x31\x41" + "\x32\x00"                        // modelo 2
      + GS + "(k" + "\x03\x00" + "\x31\x43" + String.fromCharCode(modulo)         // tamanho do modulo
      + GS + "(k" + "\x03\x00" + "\x31\x45" + "\x31"                              // correcao M
      + GS + "(k" + pL + pH + "\x31\x50\x30" + d                                  // dados
      + GS + "(k" + "\x03\x00" + "\x31\x51\x30";                                  // imprime
  };

  // Nao trunca mais: sub-item de combo e observacao passam a quebrar com
  // indentacao, mantendo a margem de 2 espacos do modelo da Hakim.
  const makeBoxText = (text) =>
    wrap(text, Math.max(6, columns - 2), 2).map(l => "  " + l + LF).join("");

  // Tarja invertida ocupa a largura inteira; usa o texto curto quando o longo
  // nao couber (o literal fixo de 45 chars estourava em 42 e explodia em 32).
  const banner = (long, short) => {
    const t = (long.length + 4 <= columns) ? long : short;
    const total = Math.max(0, columns - t.length);
    const left = Math.floor(total / 2);
    return " ".repeat(left) + t + " ".repeat(total - left);
  };

  /**
   * A mesma faixa, no corpo pedido, JA com o fundo preto e a quebra de linha.
   *
   * A largura vira `columns / n` porque em corpo ampliado cabem menos letras:
   * com a largura cheia a faixa transborda, a impressora quebra sozinha e a
   * segunda linha sai preta e vazia — pior que a faixa pequena.
   *
   * Em 1x devolve exatamente o que `banner()` devolvia, para a loja que
   * diminuir o aviso receber o papel de sempre, byte a byte.
   */
  const bannerNoCorpo = (long, short, mult) => {
    // Os bytes do preto invertido vao repetidos aqui de proposito: INVERSE_ON
    // so e declarado la embaixo, junto do desenho dos itens, e depender dele
    // daqui seria uma armadilha de ordem de declaracao para quem mover a
    // funcao um dia.
    const ON = "\x1d\x42\x01", OFF = "\x1d\x42\x00";
    // ── O CORPO QUE CABE ────────────────────────────────────────────────
    //
    // Em 58 mm (32 colunas) a faixa de fabrica em 2x nao cabia nem na forma
    // curta: "!! CONTEM BEBIDA !!" tem 19 letras, 38 colunas em 2x. A
    // impressora quebrava onde queria e a segunda linha saia preta pela
    // metade. Agora o corpo desce (3 → 2 → 1,5 → 1) ate a forma curta caber.
    // O 1,5 e a fonte B dobrada, igual ao resto da comanda (`formatoDe`); no
    // perfil legacy nao ha fonte B, e 1,5 ocupa o mesmo que 2.
    const pedido = Number(mult) || 1;
    const larguraDe = (n) => (n > 1 && n < 2 ? (profile === "legacy" ? 2 : 1.5) : n);
    let n = pedido;
    for (const tentativa of [3, 2, 1.5, 1]) {
      if (tentativa > pedido) continue;
      n = tentativa;
      if (short.length * larguraDe(n) <= columns) break;
    }
    const larg = Math.max(8, Math.floor(columns / larguraDe(n)));
    const t = (long.length + 4 <= larg) ? long : short;
    const total = Math.max(0, larg - t.length);
    const left = Math.floor(total / 2);
    const linha = " ".repeat(left) + t + " ".repeat(total - left);
    if (n <= 1) return ON + linha + OFF + LF;
    const fonteB = n > 1 && n < 2 && profile !== "legacy";
    const cmd = ESC + "M" + String.fromCharCode(fonteB ? 1 : 0)
              + GS + "!" + String.fromCharCode(n >= 3 ? 0x22 : 0x11);
    const reset = ESC + "M" + String.fromCharCode(0) + GS + "!" + String.fromCharCode(0);
    return cmd + ON + linha + OFF + reset + LF;
  };

  // Separador horizontal sólido entre itens
  const boxBorder = "_".repeat(columns) + LF;

  // Estado explicito da impressora. Sem isto, depois do ESC @ cada marca volta ao
  // default de fabrica/NVRAM dela: a Bematech rende 42 colunas em 80mm onde a
  // impressora da Hakim rende 48, e o texto montado para 48 quebra no meio do preco.
  // Como o envio e RAW (pDataType="RAW"), o driver do Windows nao corrige nada --
  // so estes bytes garantem o mesmo estado em qualquer marca.
  //
  // PERFIS (escposProfile, por impressora):
  //   safe   (PADRAO) so comandos de 1 parametro, universais desde a TM-T88.
  //          Numa impressora que ja esta em Fonte A sao no-op: nao mudam nada
  //          onde ja funciona, e firmware que os ignore nao tem parametro
  //          sobrando para cuspir como texto.
  //   full   safe + charset USA + entrelinha padrao + GEOMETRIA (GS L / GS W).
  //          GS L e GS W tem 2 parametros: firmware que nao os conhece imprime
  //          "L" + 2 NUL / "W@" + STX na PRIMEIRA linha. Alem disso GS W so
  //          ENCOLHE a area (a spec manda clampar ao maximo imprimivel), entao
  //          ele e endurecimento contra deriva -- nao e o que conserta uma
  //          impressora estreita. Quem conserta e o "columns" calibrado.
  //          So habilite depois que a regua provar que AQUELE modelo obedece.
  //   legacy exatamente os bytes das versoes antigas. Valvula de escape se
  //          alguma loja que ja funciona regredir.
  //
  // areaDots = columns * 12 assume Fonte A (celula 12x24 a 203dpi) E unidade de
  // movimento horizontal = 1 dot (que o ESC @ restaura da NVRAM do modelo).
  // E mais um motivo para "full" so ir para impressora calibrada.
  const areaDots = Math.max(192, Math.min(576, columns * 12));
  const PREAMBLE = {
    legacy: INIT + ESC + "t\x03",
    safe:
      INIT +                     // 1B 40       reset
      ESC + "t\x03" +            // 1B 74 03    codepage 860 (ESC @ restaura da NVRAM)
      ESC + "M\x00" +            // 1B 4D 00    Fonte A (celula 12x24)
      ESC + "!\x00" +            // 1B 21 00    zera negrito/dupla/sublinhado residual
      ESC + " \x00",             // 1B 20 00    espacamento lateral do caractere = 0
    full:
      INIT +
      ESC + "t\x03" +
      ESC + "R\x00" +            // 1B 52 00    charset internacional USA ("#" e "$" literais)
      ESC + "M\x00" +
      ESC + "!\x00" +
      ESC + " \x00" +
      ESC + "2" +                // 1B 32       entrelinha padrao 1/6"
      GS + "L\x00\x00" +         // 1D 4C 00 00 margem esquerda = 0 (antes do GS W: a
                                 //             spec valida margem+area no GS W)
      GS + "W" + String.fromCharCode(areaDots & 0xFF, (areaDots >> 8) & 0xFF),
  };

  let res = PREAMBLE[profile] || PREAMBLE.safe;

  /* ── MODELO DA COMANDA: onde cada secao comeca e acaba ────────────────

     A loja pode escolher a ORDEM das secoes, quais aparecem e o tamanho
     dos titulos (src/lib/comanda-modelo.ts no site monta a lista e manda
     em `order.blocos`). O CONTEUDO de cada secao continua sendo montado
     pelo mesmo codigo de sempre, algumas linhas abaixo — o que muda e so
     a ordem em que ele e colado no fim.

     Por isso aqui so se anota a POSICAO: `marcas.x = res.length` antes de
     cada secao. No fim, `res.slice(marcas.a, marcas.b)` devolve a secao ja
     pronta, byte a byte igual a de hoje. Nada de reimplementar preco
     efetivo, combo, tarja de bebida nem rateio de mesa num segundo lugar
     que ia divergir do primeiro na primeira mudanca.

     Pedido sem `order.blocos` (loja que nunca abriu a tela, ou versao
     antiga do site) nao entra nesse caminho: as marcas ficam anotadas e
     ninguem as le. */
  const marcas = {};
  marcas.corpo = res.length;

  /**
   * Cola as secoes na ordem que a loja escolheu.
   *
   * Devolve o cupom inteiro (preambulo + corpo remontado). Sem `order.blocos`
   * devolve `res` como esta — que e o caminho de toda loja que nunca abriu a
   * tela de modelo, e de todo pedido vindo de uma versao do site que ainda nao
   * manda o campo.
   *
   * As secoes pesadas (itens, totais, pagamento, QRs, aviso de entrega
   * parceira) vem FATIADAS de `res`: os bytes sao exatamente os que o codigo
   * de sempre produziu logo acima. As leves (numero, canal, loja, data, texto
   * livre) sao remontadas aqui, e so essas aceitam tamanho e alinhamento —
   * mudar o corpo de fonte de uma secao ja quebrada em `columns` faria a
   * IMPRESSORA quebrar a linha onde ela quisesse.
   */
  function aplicarModelo() {
    const blocos = Array.isArray(order.blocos) ? order.blocos : null;
    if (!blocos || !blocos.length) return res;

    const fatia = (de, ate) => {
      const a = marcas[de];
      if (a == null) return "";
      const b = marcas[ate] == null ? res.length : marcas[ate];
      return b > a ? res.slice(a, b) : "";
    };

    // Fonte A ocupa 12 pontos de largura, Fonte B ocupa 9. O multiplicador do
    // GS ! e INTEIRO, entao 1,5x nao sai dele: sai da Fonte B dobrada, que da
    // 64/2 = 32 colunas em 80 mm — exatamente 48/1,5. No perfil "legacy" a
    // troca de fonte nao e tentada e o 1,5x sai como 2x: maior do que foi
    // pedido, nunca ilegivel.
    const formatoDe = (t) => {
      const n = Number(t) || 1;
      const fonteB = n > 1 && n < 2 && profile !== "legacy";
      const mult = n >= 3 ? 0x22 : n >= 1.5 ? 0x11 : 0x00;
      return ESC + "M" + String.fromCharCode(fonteB ? 1 : 0) + GS + "!" + String.fromCharCode(mult);
    };
    const RESET = ESC + "M" + String.fromCharCode(0) + GS + "!" + String.fromCharCode(0) + LEFT;
    const larguraDe = (t) => {
      const n = Number(t) || 1;
      return Math.max(4, Math.floor(columns / (n < 1 ? 1 : n)));
    };

    // Alinhamento no CODIGO, nunca no ESC a: o ESC a centraliza sobre a largura
    // FISICA da impressora enquanto o resto do cupom e montado sobre
    // `columns`. Misturar as duas referencias ja desalinhou cabecalho e corpo
    // no mesmo papel.
    // O RECUO SAI EM COLUNAS NORMAIS, O TEXTO EM CORPO AMPLIADO
    //
    // Letra em 2x ocupa o lugar de duas letras normais — inclusive o ESPACO.
    // Centralizando com os espacos no mesmo tamanho do texto, o ajuste so anda
    // de dois em dois: "(79) DELIVERY #3523" tem 19 caracteres, cabem 24 em
    // 2x, sobram 5 e a conta da 2 de um lado e 3 do outro — que no papel viram
    // 4 e 6 colunas. O lojista pede centro e ve o texto encostado a esquerda,
    // com razao (relatado em 12/09/2026).
    //
    // Emitindo os espacos ANTES do comando de tamanho, sobram 10 colunas e da
    // 5 de cada lado: centro exato. Mesma conta de lib/comanda-modelo.ts.
    /* ── DESTAQUE MARCADO DE PRETO ──────────────────────────────────────
     *
     * Fundo preto com letra branca (GS B 1). É o recurso que a notinha da
     * Saipos usa para as três linhas que a loja precisa achar de relance no
     * meio do papel: o tipo do pedido, o nome do cliente e o "PAGO ONLINE".
     * Negrito sozinho não faz esse trabalho — num papel térmico cheio de
     * texto ele se perde.
     *
     * A tarja ocupa a LARGURA INTEIRA: invertido só no tamanho do texto vira
     * um retângulo torto no meio da linha. E o recuo entra DENTRO da tarja,
     * senão o alinhamento centraliza o texto e deixa a faixa deslocada. */
    const INV_ON = "\x1d\x42\x01";
    const INV_OFF = "\x1d\x42\x00";

    const linha = (texto, f) => {
      const n = Math.min(3, Math.max(1, Number(f.tamanho) || 1));
      const partes = wrap(texto, larguraDe(f.tamanho));
      if (!partes.length) return LF;
      let s = "";
      for (const p of partes) {
        const largura = larguraDe(f.tamanho);
        const sobra = Math.max(0, columns - Math.round(p.length * n));
        const recuo = f.alinhamento === "centro" ? Math.floor(sobra / 2)
                    : f.alinhamento === "direita" ? sobra
                    : 0;
        if (f.invertido) {
          // Em corpo ampliado o recuo é contado em colunas do PRÓPRIO corpo,
          // porque a tarja inteira sai ampliada — diferente do caminho normal,
          // em que os espaços saem antes do comando de tamanho.
          const vaos = Math.max(0, largura - p.length);
          const antes = f.alinhamento === "centro" ? Math.floor(vaos / 2)
                      : f.alinhamento === "direita" ? vaos
                      : 0;
          const faixa = " ".repeat(antes) + p + " ".repeat(Math.max(0, vaos - antes));
          s += formatoDe(f.tamanho) + (f.negrito ? BOLD_ON : "") + INV_ON
             + faixa + INV_OFF + (f.negrito ? BOLD_OFF : "") + RESET + LF;
          continue;
        }
        s += " ".repeat(recuo) + formatoDe(f.tamanho) + (f.negrito ? BOLD_ON : "")
           + p + (f.negrito ? BOLD_OFF : "") + RESET + LF;
      }
      return s;
    };

    // Secao sem conteudo nao ganha titulo: pedido de retirada nao tem endereco,
    // e um "ENTREGA" sozinho so gasta bobina e confunde quem monta o saco.
    const comTitulo = (corpo, padrao, bl) => {
      if (!corpo) return "";
      const t = String(bl.titulo == null ? padrao : bl.titulo).trim();
      const cabeca = t ? linha(t.toUpperCase(), { alinhamento: "centro", tamanho: bl.tamanho || 1.5 }) : "";
      return LF + cabeca + RESET + corpo;
    };

    const campos = {
      numero: String(seqNumStr || ""),
      canal: srcStr || "",
      codigoCanal: refTag || "",
      loja: cleanAscii(lojaOrigem || storeName || ""),
      cliente: ehPedidoDeMesa ? semMesaNoNome(cleanAscii(order.customerName || "")) : cleanAscii(order.customerName || ""),
      telefone: String(order.customerPhone || ""),
      endereco: cleanAscii(order.customerAddress || ""),
      data: dateStr || "",
      hora: timeStr || "",
      total: "R$ " + Number(order.totalAmount || 0).toFixed(2).replace(".", ","),
      taxaEntrega: "R$ " + Number(order.deliveryFee || 0).toFixed(2).replace(".", ","),
      pagamento: cleanAscii(order.paymentMethod || ""),
      entregador: cleanAscii(order.motoboyName || order.entregador || ""),
      // Campos que o texto rico oferece na tela. O GEMEO e mapaDeCampos em
      // src/lib/comanda-modelo.ts: variavel que existe so aqui nao aparece
      // na previa, e variavel que existe so la imprime vazio no papel.
      observacao: cleanAscii(order.notes || ""),
      subtotal: order.subtotal != null ? "R$ " + Number(order.subtotal).toFixed(2).replace(".", ",") : "",
      desconto: Number(order.discountTotal || 0) > 0 ? "R$ " + Number(order.discountTotal).toFixed(2).replace(".", ",") : "",
      troco: Number(order.changeAmount || 0) > 0 ? "R$ " + Number(order.changeAmount).toFixed(2).replace(".", ",") : "",
      // ── Campos da notinha do Frangoso (o layout que ele usava na Saipos) ──
      //
      // O GEMEO e mapaDeCampos em src/lib/comanda-modelo.ts: campo que exista
      // so aqui nao aparece na previa, e campo que exista so la imprime vazio
      // no papel. Os nomes tem varias grafias porque cada integracao batiza o
      // seu de um jeito — a ordem e da mais especifica para a mais generica.
      localizador: cleanAscii(
        order.localizador || order.ifoodLocalizer || order.ifoodOrderId ||
        order.openDeliveryReference || order.ifoodReference || ""
      ),
      previsao: cleanAscii(order.previsao || order.deliveryWindow || ""),
      taxaServico: Number(order.serviceFee || 0) > 0
        ? "R$ " + Number(order.serviceFee).toFixed(2).replace(".", ",") : "",
      bandeira: cleanAscii(order.bandeira || order.cardBrand || ""),
      quantidadeDeItens: String(
        (order.items || []).reduce((s, it) => s + (Number(it.qty || it.quantity || 1) || 1), 0)
      ),
      impressoEm: new Date().toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }),
    };
    const preencher = (t) => String(t || "").replace(/\{(\w+)\}/g, (_, c) => campos[c] || "");

    let out = "";
    for (const bl of blocos) {
      if (!bl || bl.ligado === false) continue;
      const f = { negrito: bl.negrito, tamanho: bl.tamanho, alinhamento: bl.alinhamento, invertido: bl.invertido };
      switch (bl.tipo) {
        case "numeroPedido": {
          // A linha "N. no iFood" mora no bloco dataHora. Desligado ele, o
          // numero do app sobe para o topo — senao sumiria do papel.
          const temLinhaDoApp = blocos.some((b) => b && b.tipo === "dataHora" && b.ligado !== false);
          const topo = temLinhaDoApp ? headerLine : headerLineComRef;
          if (topo) out += linha(topo, f);
          // O garcom anda com o numero da mesa, no mesmo corpo da linha do
          // canal no layout padrao — nao some porque a loja montou modelo.
          if (linhaDoGarcom) out += linha(linhaDoGarcom, { alinhamento: f.alinhamento || "centro", tamanho: 1.5, negrito: true });
          break;
        }
        // A MARCA quando a conta tem varias no mesmo painel (Ragnar Pizza x
        // Ragnar Burguer); senao o nome do marketplace, e so dele. Pedido do
        // proprio site nao ganha linha nenhuma aqui: "SITE" em corpo dobrado
        // no topo do papel e ruido em toda comanda da loja que so vende pelo
        // site — que e a maioria.
        case "canal": {
          const c = cleanAscii(lojaOrigem || (NOME_DO_CANAL[srcStr] ? NOME_DO_CANAL[srcStr] : ""));
          if (c) out += linha(c.toUpperCase(), f);
          break;
        }
        case "loja":
          out += linha(R("loja", "estabelecimento", "Estabelecimento:") + " " + cleanAscii(storeName || "FIREHUB").toUpperCase(), { ...f, negrito: f.negrito || N("loja", "estabelecimento", false) });
          break;
        case "dataHora":
          // O numero no app sai no corpo do destaque, nao no do bloco: e o que
          // a loja procura dentro do iFood/99 com o cliente no telefone. A
          // data segue o bloco, porque e conferencia. Mesma regra da previa do
          // site (DESTAQUE_DO_NUMERO_NO_APP em lib/comanda-modelo.ts).
          if (orderRef) {
            out += linha(rotuloDoNumeroNoApp + " " + cleanAscii(orderRef),
              { ...f, negrito: N("dataHora", "numeroNoParceiro", true), tamanho: CORPO_DO_NUMERO_NO_APP });
          }
          if (dateStr) out += linha(R("dataHora", "data", "Data:") + " " + dateStr + " " + timeStr, { ...f, negrito: f.negrito || N("dataHora", "data", false) });
          break;
        // Nao desligavel no site: e o aviso de que o pedido tem motoboy do
        // parceiro e o codigo de coleta. Some daqui e a loja manda o proprio
        // motoboy num pedido que ja tem entregador a caminho.
        case "avisoEntrega":
          out += fatia("avisoEntrega", "fimAvisoEntrega");
          break;
        case "cliente":
          out += comTitulo(fatia("cliente", "fimCliente"), "CLIENTE", bl);
          break;
        case "entrega":
          out += comTitulo(fatia("entrega", "fimEntrega"), "ENTREGA", bl);
          break;
        case "itens":
          out += comTitulo(fatia("itens", "fimItens"), ehConta ? "CONTA DA MESA" : "RESUMO DO PEDIDO", bl);
          break;
        case "totais":
          // Em tres pedacos para dar conta de omitir SO a linha da taxa.
          out += RESET + fatia("totais", "taxaEntrega");
          if (!bl.ocultarTaxaEntrega) out += fatia("taxaEntrega", "fimTaxaEntrega");
          out += fatia("fimTaxaEntrega", "fimTotais");
          break;
        case "pagamento":
          out += RESET + fatia("pagamento", "fimPagamento");
          break;
        case "qrMotoboy":
          out += RESET + fatia("qrMotoboy", "fimQrMotoboy");
          break;
        case "qrCliente":
          out += RESET + fatia("qrCliente", "fimQrCliente");
          break;
        case "textoLivre": {
          const t = preencher(bl.texto).trim();
          if (t) out += linha(t, f);
          break;
        }
        // ── TEXTO COM VARIAVEL NO MEIO DA FRASE ──────────────────────────
        //
        // A diferenca para o textoLivre acima: la a variavel e trocada dentro
        // de uma string, entao "Ref: {referencia}" num pedido sem referencia
        // imprime "Ref:" sozinho — uma palavra orfa no papel.
        //
        // Aqui o ROTULO viaja colado a variavel ({texto, campo}) e, quando a
        // variavel nao tem valor, o pedaco inteiro some, rotulo junto. Linha
        // que resolveu vazia nao vira linha em branco: sai do papel.
        //
        // GEMEO em src/lib/comanda-modelo.ts (resolverLinhaRica), que desenha
        // a previa da tela. Mudou aqui, mude la — senao a tela passa a mentir
        // sobre o que vai sair no papel.
        case "textoRico": {
          for (const ln of Array.isArray(bl.linhas) ? bl.linhas : []) {
            let textoDaLinha = "";
            for (const parte of Array.isArray(ln && ln.partes) ? ln.partes : []) {
              if (!parte) continue;
              if (parte.campo) {
                const v = String(campos[parte.campo] || "").trim();
                if (!v) continue; // o rotulo some junto
                textoDaLinha += String(parte.texto || "") + v;
              } else if (parte.texto) {
                textoDaLinha += String(parte.texto);
              }
            }
            textoDaLinha = cleanAscii(textoDaLinha).trim();
            if (textoDaLinha) {
              out += linha(textoDaLinha, {
                negrito: ln.negrito,
                tamanho: ln.tamanho,
                alinhamento: ln.alinhamento,
                invertido: ln.invertido,
              });
            }
          }
          break;
        }
        case "separador":
          out += RESET + divider;
          break;
        case "espaco":
          out += LF;
          break;
      }
    }

    // Bloco nenhum produziu byte (modelo salvo so com secoes que este pedido
    // nao tem): melhor o cupom de sempre do que um papel em branco.
    if (!out.trim()) return res;
    return res.slice(0, marcas.corpo) + RESET + out;
  }


  // 1. TOP HEADER (Número + Tipo + Tag) — Usando DOUBLE_HEIGHT para não quebrar linha
  // Conta da mesa (src/lib/conta-da-mesa.ts no site): nao e pedido. Nada de
  // numero de pedido, "Qtd Pedidos", taxa de entrega nem etiqueta de bebida —
  // e papel que vai para a mao do cliente.
  const ehConta = order.kind === "CONTA_DA_MESA";

  /* ── O PAPEL DO CAIXA NAO E UM PEDIDO ──────────────────────────────────
   *
   * Abertura e fechamento de caixa vinham montados COMO pedido (titulo no
   * lugar do numero, cada linha da conferencia como item), porque era o unico
   * formato que toda versao instalada sabia imprimir. O contorno funcionou,
   * mas cobrou caro:
   *
   *   - o rodape do fechamento (TOTAL ESPERADO, DIFERENCA, justificativa)
   *     viajava em `order.notes`, e `notes` so e impresso dentro da secao
   *     ENTREGA — que exige deliveryType DELIVERY e endereco. Num cupom de
   *     caixa (BALCAO, sem endereco) ele era descartado em silencio: a linha
   *     mais importante do fechamento nunca chegou ao papel;
   *   - o rodape de pedido imprimia "Subtotal", "Desconto" e "Taxa de
   *     Entrega" num relatorio de caixa, com numeros que nao significam nada
   *     ali;
   *   - "CLIENTE / Nome: 19/09/2026 14:32 — Fulano" e "Qtd Pedidos: 1" saiam
   *     em todo fechamento.
   *
   * Agora o servidor manda `relatorio`: uma lista de linhas ja decidida la
   * (src/lib/cupom-do-caixa.ts), que este bloco imprime como relatorio, sem
   * passar por nada de pedido. Assistente antigo ignora o campo e continua
   * imprimindo o formato de pedido de sempre — ninguem fica sem papel por
   * estar atrasado na versao. */
  const ehCaixa = String(order.kind || "").startsWith("CAIXA_");
  if (ehCaixa && Array.isArray(order.relatorio) && order.relatorio.length) {
    const titulo = cleanAscii(order.dailyOrderNumber || "CAIXA");
    res += DOUBLE_HEIGHT + BOLD_ON + centerLine(titulo) + BOLD_OFF + DOUBLE_OFF;
    res += LEFT + divider;
    if (storeName) res += wrapLines("Estabelecimento: " + cleanAscii(storeName).toUpperCase(), 2);
    if (order.caixaQuando) res += wrapLines("Emitido em: " + cleanAscii(order.caixaQuando), 2);
    if (order.caixaOperador) res += wrapLines("Operador: " + cleanAscii(order.caixaOperador), 2);
    res += divider;

    for (const bruta of order.relatorio) {
      // String solta vale como linha de texto: e o formato mais simples de o
      // servidor mandar, e nao quero um cupom em branco se um dia vier assim.
      const l = typeof bruta === "string" ? { tipo: "texto", texto: bruta } : (bruta || {});
      const texto = cleanAscii(l.texto == null ? "" : String(l.texto));
      const valor = l.valor == null ? "" : cleanAscii(String(l.valor));

      if (l.tipo === "separador") { res += divider; continue; }
      if (l.tipo === "titulo") {
        res += LF + BOLD_ON + makeHeaderTitle(texto) + BOLD_OFF;
        res += divider;
        continue;
      }
      if (l.tipo === "destaque") {
        // Dobrada e em negrito: e a linha que a pessoa procura no papel
        // (DIFERENCA, TOTAL CONTADO). Em 58 mm o dobrado nao cabe com valor,
        // entao ali ela sai so em negrito, mas ainda destacada.
        if (columns >= 42) res += DOUBLE_HEIGHT + BOLD_ON + padLine(texto, valor) + BOLD_OFF + DOUBLE_OFF;
        else res += BOLD_ON + padLine(texto, valor) + BOLD_OFF;
        if (l.nota) res += makeBoxText(String(l.nota));
        continue;
      }
      if (l.tipo === "linha") {
        res += padLine(texto, valor);
        if (l.nota) res += makeBoxText(cleanAscii(String(l.nota)));
        continue;
      }
      res += wrapLines(texto, 2);
    }

    res += divider;
    res += LEFT + FEED + CUT;
    return Buffer.from(res, "binary");
  }

  const seqNumStr = order.dailyOrderNumber || order.orderSeqNumber || (order.id ? order.id.slice(-4) : "");
  // A palavra ao lado do numero. A loja pode troca-la (bloco numeroPedido,
  // chave "delivery"); trocada, vale para os tres tipos — quem escreve
  // "PEDIDO" ali quer "PEDIDO" no papel inteiro, nao so na entrega.
  const deliveryTypeTag = R("numeroPedido", "delivery",
    order.deliveryType === "DELIVERY" ? "DELIVERY" : order.deliveryType === "MESA" ? "MESA" : "RETIRADA");

  // ── A MESA E O GARCOM ────────────────────────────────────────────────
  //
  // O topo do pedido de mesa saia "(3) MESA": o numero do PEDIDO, e de mesa
  // nenhuma. O numero da mesa so viajava no endereco ("Mesa 4"), que o papel
  // imprime apenas na entrega, e o garcom nem viajava. O dono, com a comanda
  // da Ragnar Burger na mao (24/09/2026): "tem que sair pedido (3), o numero
  // da MESA — era a 4 — e o nome do garcom".
  //
  // O servidor manda `mesa` e `garcom` (src/lib/mesa-na-comanda.ts no site).
  // Quem nao manda `mesa` (servidor antigo, reimpressao guardada) ainda tem o
  // rotulo "Mesa 4" no endereco, que todo pedido de mesa carrega. A conta da
  // mesa (ehConta) tem topo proprio e fica como estava.
  const ehPedidoDeMesa = !ehConta && order.deliveryType === "MESA";
  const mesaDoPedido = (() => {
    if (!ehPedidoDeMesa) return "";
    const doCampo = cleanAscii(order.mesa == null ? "" : String(order.mesa)).replace(/\s+/g, " ").trim();
    if (doCampo) return doCampo.slice(0, 12);
    const m = cleanAscii(order.customerAddress || "").match(/^\s*mesa\s*[:#.\-]*\s*(\d{1,4}[A-Za-z]?)(?![0-9A-Za-z])/i);
    return m ? m[1] : "";
  })();
  const garcomDaMesa = ehPedidoDeMesa ? cleanAscii(order.garcom || "").replace(/\s+/g, " ").trim().slice(0, 40) : "";
  const linhaDoGarcom = garcomDaMesa ? ("GARCOM: " + garcomDaMesa).toUpperCase() : "";
  // "(3) MESA 4". A loja que trocou a palavra do topo ("PEDIDO") ganha a mesa
  // por extenso depois dela — "(3) PEDIDO 4" nao diria que o 4 e a mesa.
  const tagDoTopo = !mesaDoPedido
    ? deliveryTypeTag
    : /(^|\s)MESA$/i.test(deliveryTypeTag)
      ? `${deliveryTypeTag} ${mesaDoPedido}`
      : `${deliveryTypeTag} MESA ${mesaDoPedido}`;
  // O site embute a mesa e o garcom no NOME do cliente, para o Assistente
  // antigo imprimi-los na linha "Nome:" (o mesmo caminho do pager e do CPF —
  // nomeComMesa em src/lib/mesa-na-comanda.ts). Aqui eles ja estao no topo:
  // no "Nome:" sairiam duas vezes. O nome que ERA so a mesa ("Mesa 4", mesa
  // aberta sem nome) volta vazio, e a linha nem sai.
  const semMesaNoNome = (nome) => {
    let s = String(nome == null ? "" : nome);
    const literal = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (garcomDaMesa) {
      s = s.replace(new RegExp("[^0-9A-Za-z]*\\bGarcom:?\\s+" + literal(garcomDaMesa) + "(?![0-9A-Za-z])", "i"), "");
    }
    if (mesaDoPedido) {
      s = s.replace(new RegExp("[^0-9A-Za-z]*\\bMesa\\s*[:#.\\-]*\\s*" + literal(mesaDoPedido) + "(?![0-9A-Za-z])", "i"), "");
    }
    s = s.trim();
    return /[0-9A-Za-z]/.test(s) ? s : "";
  };
  // ── O NUMERO DO PARCEIRO, E SO DO PARCEIRO ──────────────────────────
  //
  // Era `ifoodReference || openDeliveryReference || id.slice(-6)`: no pedido
  // do site, do robo e do balcao — que nao existe em app nenhum — o papel
  // imprimia o fim do id interno ("#7XBQ7U"), em corpo triplo no topo e de
  // novo, dobrado, em "N. do Pedido". O dono, com a comanda da Pizzaria do
  // Costa na mao (23/09/2026): "isso nao serve pra nada, nem sei o que e".
  const orderRef = ehConta ? "" : String(order.ifoodReference || order.openDeliveryReference || "").trim();
  const refTag = orderRef ? `#${orderRef}` : "";

  // ── EM CIMA O NOSSO, EMBAIXO O DELES ─────────────────────────────────
  //
  // O numero do parceiro saia duas vezes: no topo, colado ao nosso, e na
  // linha "N. do Pedido". Decisao do dono (23/09/2026): o topo e so o nosso
  // numero; o do app sai uma vez, na linha propria. `headerLineComRef` so
  // existe para o modelo que DESLIGOU essa linha (bloco dataHora): ali o
  // numero do app volta para o topo, senao some do papel.
  const headerLine = seqNumStr
    ? `(${seqNumStr}) ${tagDoTopo}`
    : tagDoTopo;
  const headerLineComRef = `${headerLine}  ${refTag}`.trim();
  // "N. no iFood:" / "N. no 99Food:" — "N. do Pedido:" ao lado do nosso numero
  // grande no topo deixava a duvida de qual dos dois era o pedido.
  const nomeDoApp = NOME_DO_CANAL[String(order.source || "").toUpperCase()]
    || NOME_DO_CANAL[String(order.openDeliveryChannel || "").toUpperCase()]
    || "app";
  const rotuloDoNumeroNoApp = R("dataHora", "numeroNoParceiro", "N. no {canal}:").replace("{canal}", nomeDoApp);

  // DE QUAL loja iFood veio, quando a conta tem mais de uma no mesmo painel.
  // O servidor so manda `ifoodStoreName` nesse caso — numa loja so o campo vem
  // vazio e a comanda sai exatamente como sempre saiu. Sem isto, a comanda da
  // Ragnar Pizza e a da Ragnar Burguer sao identicas e o atendente nao sabe em
  // qual saco vai.
  const lojaOrigem = (order.ifoodStoreName || "").toString().trim();

  const dByStr = (order.deliveryBy || order.deliveredBy || "").toString().toUpperCase();
  const srcStr = (order.source || "").toString().toUpperCase();
  const odChannelStr = (order.openDeliveryChannel || "").toString().toUpperCase();

  // ── QUEM VAI ENTREGAR ────────────────────────────────────────────────
  //
  // A regra aqui aceitava o CODIGO DE COLETA como prova de entrega parceira.
  // O iFood emite codigo tambem em entrega propria (e o numero que o cliente
  // informa ao receber): medido na Hakim em 23/08/2026, 73 dos 80 pedidos do
  // dia tinham codigo e 70 eram entrega da loja. Resultado: a comanda saia
  // com "NAO USAR MOTOBOY DA LOJA!" em pedido que era da loja, enquanto o
  // painel mostrava a coisa certa.
  //
  // Agora quem decide e o servidor, que manda `entregaParceira` pronto
  // (src/lib/entrega-parceira.ts). O resto abaixo e so para o caso de vir um
  // pedido de versao antiga do servidor, sem esse campo -- e mesmo ai o
  // codigo de coleta nao entra na conta: prova de entrega parceira e quem
  // entrega, nunca a existencia de um numero.
  const decididoNoServidor = typeof order.entregaParceira === "boolean";
  const dModeStr = (order.deliveryMode || "").toString().toUpperCase();
  const ehLogistica = dByStr === "LOGISTICS" || dByStr === "PARTNER"
    || dModeStr === "LOGISTIC" || dModeStr === "PARTNER";
  const ehEntregaPropria = dByStr === "MERCHANT" || dByStr === "LOJA"
    || dByStr === "PROPRIO" || dByStr === "MERCHANT_DELIVERY";

  const is99FoodDriver = !ehEntregaPropria && (
    srcStr === "99FOOD" || odChannelStr === "99FOOD" || dByStr.includes("99")
  ) && (dByStr.includes("99") || ehLogistica);

  const isIfoodDriver = !ehEntregaPropria && (
    srcStr === "IFOOD" || dByStr.includes("IFOOD")
  ) && (
    dByStr.includes("IFOOD") || ehLogistica ||
    Boolean(order.ifoodDriverName) ||
    Boolean(order.ifoodDriverStatus && order.ifoodDriverStatus !== "UNASSIGNED")
  );

  const isPartnerDriver = decididoNoServidor
    ? order.entregaParceira === true
    : (is99FoodDriver || isIfoodDriver || (!ehEntregaPropria && ehLogistica));

  const partnerLabel = (decididoNoServidor && order.parceiroDaEntrega)
    ? String(order.parceiroDaEntrega).toUpperCase()
    : (is99FoodDriver ? "99FOOD" : (isIfoodDriver ? "IFOOD" : (srcStr || "PARCEIRO")));
  const pCode = order.ifoodPickupCode || order.openDeliveryPickupCode || "";

  // ── O NUMERO DO PEDIDO EM CORPO TRIPLO ───────────────────────────────
  //
  // Era altura dobrada com largura normal, e dividia o topo com o nome do
  // canal em pe de igualdade. Decisao do dono (19/09/2026), com a comanda do
  // proprio iFood na mao: o numero e o que a cozinha, o balcao e o entregador
  // leem de longe, em papel amassado e sob luz ruim — sai grande. Cabem 16
  // colunas em 3x, entao "(79) DELIVERY #3523" quebra em duas linhas, que e o
  // que o iFood tambem faz. O par disto esta em modeloPadrao() no site.
  res += ampliado(headerLine, 3, { centro: true, negrito: N("numeroPedido", "delivery", true) });
  // O garcom logo abaixo da mesa: e a quem a cozinha entrega o prato pronto.
  if (linhaDoGarcom) {
    res += DOUBLE_HEIGHT + BOLD_ON + centerLine(linhaDoGarcom) + BOLD_OFF + DOUBLE_OFF;
  }
  // ── DE ONDE VEIO ESTE PEDIDO ─────────────────────────────────────────
  //
  // A MARCA quando a conta tem varias no mesmo iFood (Ragnar Pizza x Ragnar
  // Burguer) — e, na falta dela, o NOME DO MARKETPLACE. E a primeira coisa
  // que a cozinha precisa saber quando a mesma impressora recebe tres
  // origens: a loja pega o papel e ja sabe em qual app procurar o pedido.
  //
  // O modelo padrao da comanda ja tem esse bloco ("canal", em modeloPadrao()
  // no site) e a previa da tela "Personalizar notinha" ja o desenhava — mas
  // ele so chegava ao papel na loja que PERSONALIZOU o modelo, porque so ai
  // o servidor manda `order.blocos`. Na loja de modelo padrao o papel saia
  // sem origem nenhuma. Medido na NIK Esfihas em 22/09/2026, ligando a
  // Wabiz: a previa mostrava "WABIZ", o papel nao. Agora as duas vias
  // imprimem a mesma coisa. Pedido do proprio site nao ganha linha aqui:
  // "SITE" em corpo dobrado e ruido em toda comanda de quem so vende pelo
  // site, que e a maioria.
  const origemDoPedido = cleanAscii(lojaOrigem || NOME_DO_CANAL[srcStr] || "");
  if (origemDoPedido) {
    res += DOUBLE_HEIGHT + BOLD_ON + centerLine(origemDoPedido.toUpperCase()) + BOLD_OFF + DOUBLE_OFF;
  }
  marcas.avisoEntrega = res.length;
  if (isPartnerDriver) {
    const rMotoboy = R("avisoEntrega", "motoboy", "MOTOBOY");
    const rParceira = R("avisoEntrega", "entregaParceira", "(ENTREGA PARCEIRA)");
    res += DOUBLE_HEIGHT + comNegrito(centerLine(`*** ${rMotoboy} ${partnerLabel} ${rParceira} ***`), "avisoEntrega", "motoboy", false)
         + comNegrito(centerLine(R("avisoEntrega", "naoUsar", "NAO USAR MOTOBOY DA LOJA!")), "avisoEntrega", "naoUsar", false) + DOUBLE_OFF;
    if (pCode) {
      res += DOUBLE_HEIGHT + comNegrito(centerLine(`${R("avisoEntrega", "codigoDeColeta", "CODIGO DE COLETA:")} #${pCode}`), "avisoEntrega", "codigoDeColeta", false) + DOUBLE_OFF;
    }
  }
  marcas.fimAvisoEntrega = res.length;
  res += LEFT + divider;
  marcas.loja = res.length;
  res += comNegrito(wrapLines(R("loja", "estabelecimento", "Estabelecimento:") + " " + cleanAscii(storeName || "FIREHUB").toUpperCase(), 2), "loja", "estabelecimento", false);
  // O NUMERO NO APP SAI GRANDE. E por ele que a loja acha o pedido dentro do
  // iFood/99 quando o cliente liga reclamando, e era a unica linha miuda no
  // meio de um cabecalho de numeros grandes: para ler, alguem pegava o papel e
  // aproximava do rosto. A DATA continua pequena — ela e conferencia, ninguem
  // a procura com o telefone na mao.
  if (orderRef) {
    res += ampliado(rotuloDoNumeroNoApp + " " + cleanAscii(orderRef), CORPO_DO_NUMERO_NO_APP, { negrito: N("dataHora", "numeroNoParceiro", true) });
  }
  const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  const timeStr = order.createdAt ? new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  if (dateStr) res += comNegrito(R("dataHora", "data", "Data:") + " " + dateStr + " " + timeStr, "dataHora", "data", false) + LF;
  marcas.fimCabecalho = res.length;

  // 2. CLIENTE SECTION
  // O corpo e montado antes do titulo: secao vazia nao ganha "CLIENTE"
  // sozinho no papel (a mesa aberta sem nome ja diz a mesa no topo). Mesma
  // regra do comTitulo no modelo.
  let corpoDoCliente = "";
  // ── "CPF NA NOTA" ──────────────────────────────────────────────────────
  //
  // Linha propria a partir da 1.2.20. Quando o campo vem, ele manda: o sufixo
  // que o site embutiu no nome (para as versoes antigas) e retirado, senao o
  // documento sairia duas vezes. Ver nomeSemDocumento().
  const docDoCliente = documentoDoCliente(order.customerCpfCnpj);
  const nomeComSufixos = docDoCliente
    ? nomeSemDocumento(cleanAscii(order.customerName))
    : cleanAscii(order.customerName || "");
  const nomeDoCliente = ehPedidoDeMesa ? semMesaNoNome(nomeComSufixos) : nomeComSufixos;
  if (nomeDoCliente) corpoDoCliente += comNegrito(wrapLines(R("cliente", "nome", "Nome:") + " " + nomeDoCliente, 2), "cliente", "nome", false);
  if (docDoCliente) {
    corpoDoCliente += comNegrito(wrapLines(R("cliente", "documento", "CPF/CNPJ:") + " " + docDoCliente, 2), "cliente", "documento", false);
  }
  // Pedido de mesa nasce com telefone "00000000000" (campo obrigatorio no
  // banco): imprimir isso e ruido no papel.
  if (order.customerPhone && !/^0+$/.test(String(order.customerPhone).trim())) {
    corpoDoCliente += comNegrito(wrapLines(R("cliente", "telefone", "Telefone:") + " " + cleanAscii(order.customerPhone), 2), "cliente", "telefone", false);
  }
  // "Qtd Pedidos: 1" na rodada da mesa nao conta nada a ninguem.
  if (!ehConta && !ehPedidoDeMesa) corpoDoCliente += comNegrito(R("cliente", "qtdPedidos", "Qtd Pedidos:") + " 1", "cliente", "qtdPedidos", false) + LF;
  marcas.tituloCliente = res.length;
  if (corpoDoCliente) res += LF + DOUBLE_HEIGHT + makeHeaderTitle("CLIENTE") + DOUBLE_OFF + LF;
  marcas.cliente = res.length;
  res += corpoDoCliente;

  // 3. ENTREGA SECTION
  marcas.fimCliente = res.length;
  marcas.tituloEntrega = res.length;
  if (order.deliveryType === "DELIVERY" && order.customerAddress) {
    res += LF + DOUBLE_HEIGHT + makeHeaderTitle("ENTREGA") + DOUBLE_OFF + LF;
    marcas.entrega = res.length;
    res += comNegrito(wrapLines(R("entrega", "endereco", "Endereco:") + " " + cleanAscii(order.customerAddress), 2), "entrega", "endereco", false);
  }

  /* ── O RECADO DO CLIENTE ────────────────────────────────────────────────
   *
   * "Sem queijo por favor", "tirar cebola e pimentao", "bem passado". Ele
   * viaja em `order.notes`, e ATÉ 20/09/2026 era impresso DENTRO do bloco
   * acima — o que exigia `deliveryType === "DELIVERY"` E endereço. Em pedido
   * de RETIRADA, o recado simplesmente não saía: ficava no banco, aparecia no
   * painel, e a cozinha nunca via.
   *
   * Foi a queixa do Frangoso (Salzburg, 19-20/09/2026), que é loja de balcão:
   * medido no banco, 4 dos 4 pedidos de retirada com recado nos últimos 15
   * dias imprimiram sem ele — "OBS: Trocar o molho barbecue por molho de
   * bacon" e "OBS: Tirar cebola e pimentao" entre eles. Não era a Brendi que
   * deixava de mandar: era o papel que deixava de imprimir.
   *
   * Agora sai sempre, em tarja invertida logo antes dos itens, que é onde a
   * cozinha lê. Fica preso ao bloco ITENS de propósito: é o único bloco que
   * não pode ser desligado no editor de modelo, então nenhuma loja consegue
   * ficar sem o recado por causa de um modelo personalizado antigo. */
  function recadoDoCliente() {
    if (!order.notes) return "";
    const linhas = String(order.notes).split("\n");

    // O servidor marca o recado do cliente com 📝 (processBrendiEvent e os
    // outros tradutores). Quando a marca existe, ela é a resposta exata —
    // nada de adivinhar por formato. A filtragem acontece ANTES do
    // cleanAscii, que é quem apaga o emoji.
    const marcadas = linhas.filter((l) => l.includes("📝"));

    const uteis = (marcadas.length ? marcadas : linhas).filter((l) => {
      const t = l.trim();
      if (!t) return false;
      // Desconto e cupom já saem no bloco de valores; repetir como "recado do
      // cliente" é confundir a cozinha com contabilidade.
      if (/-\s*R\$\s*[\d.,]/.test(t)) return false;
      if (/^🏷️?\s*(Desconto|Cupom)\b/i.test(t)) return false;
      // "Pedido Brendi #6011" sozinho numa linha é referência interna. Era
      // por isso que a observação da Brendi começava com o número dela.
      if (/^Pedido\s+\S+\s*#\S+\s*$/i.test(t)) return false;
      return true;
    });

    return cleanAscii(uteis.join(" | "))
      .replace(/Pedido\s+(iFood|Brendi|99Food|Jotaja|JotaJá|Wabiz)\s*#\S+/gi, "")
      .replace(/\|\s*\|/g, "|")
      .replace(/^[\s|]+|[\s|]+$/g, "")
      .trim();
  }

  function getItemEffectivePrice(item, allItems, orderTotalAmount, deliveryFee = 0, discountTotal = 0) {
    let unitPrice = typeof item.price === "number" ? item.price : 0;
    if (unitPrice > 0) return unitPrice;

    if (item.comboSelections) {
      const parsed = normalizarCombo(item.comboSelections);
      if (parsed.length > 0) {
        const comboSum = parsed.reduce((acc, s) => acc + ((s.price || s.unitPrice || s.addition || 0) * (s.quantity || 1)), 0);
        if (comboSum > 0) return comboSum;
      }
    }

    const otherItemsSum = (allItems || []).reduce((sum, it) => {
      if (it === item || (it.id && item.id && it.id === item.id)) return sum;
      const p = typeof it.price === "number" ? it.price : 0;
      const q = it.qty || it.quantity || 1;
      return sum + p * q;
    }, 0);

    const expectedSubtotal = (orderTotalAmount || 0) - (deliveryFee || 0) + (discountTotal || 0);
    const diff = expectedSubtotal - otherItemsSum;
    const zeroPriceItems = (allItems || []).filter(it => !it.price || it.price === 0);
    const q = item.qty || item.quantity || 1;

    if (zeroPriceItems.length === 1 && diff > 0 && q > 0) {
      return diff / q;
    }

    return unitPrice;
  }

  const customKeywords = order.customBeverageKeywords || order.printerConfig?.customBeverageKeywords || "";
  const autoBeverageTag = order.printerConfig?.autoBeverageTag !== false; // Padrão: true

  const isBeverageName = (name) => {
    if (!name || !autoBeverageTag) return false;
    const cleanName = cleanAscii(name);
    const defaultPattern = "bebida|bebidas|refrigerante|refrigerantes|suco|sucos|cerveja|cervejas|agua|guarana|guaravita|coca|fanta|sprite|pepsi|soda|h2oh|monster|red bull|redbull|energetico|cha|mate|lata|2l|600ml|350ml|long neck|heineken|stella|budweiser|skol|brahma|antarctica|amstel|eisenbahn|sol|corona|smirnoff|ice|tonica|schweppes|del valle|tampico|kapo|suffresh|feel good|kombucha|vibe|tnt|bravus|skol beats|51|pitu|velho barreiro|corote|vodka|gin|whisky|whiskey|licor|vinho|espumante|champagne|chopp";

    let customPattern = "";
    if (customKeywords) {
      const list = typeof customKeywords === "string" ? customKeywords.split(",") : customKeywords;
      const cleanList = (Array.isArray(list) ? list : []).map(k => cleanAscii(String(k).trim())).filter(Boolean);
      if (cleanList.length > 0) {
        customPattern = "|" + cleanList.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      }
    }

    const bevRegex = new RegExp(`\\b(${defaultPattern}${customPattern})\\b`, "i");
    return bevRegex.test(cleanName);
  };

  const isBeverageItem = (item) => {
    if (!item) return false;
    if (item.isBeverage === true || item.isBeverage === "true") return true;
    if (!autoBeverageTag) return false;
    const cat = String(item.category || item.menuProduct?.category || "");
    const name = String(item.name || item.menuProduct?.name || "");
    return isBeverageName(cat) || isBeverageName(name);
  };

  const hasBeverages = (order.items || []).some(item => {
    if (isBeverageItem(item)) return true;
    if (normalizarCombo(item.comboSelections).some(s => isBeverageName(s.name))) return true;
    return false;
  });

  // ── IMPRESSORA SO DE BEBIDA ──────────────────────────────────────────
  //
  // Filtrar por CATEGORIA nao resolve a bebida que vem dentro de um combo: o
  // "Combo 2 + Guaravita" tem categoria "Combos", nao "Bebidas". A impressora
  // do bar entao ou nao recebia nada, ou recebia o combo inteiro — e o
  // barman lia uma comanda de comida para servir um refrigerante.
  //
  // Aqui a bebida e extraida de dentro do combo e vira uma linha propria. O
  // preco dela sai ZERO de proposito: o valor pertence ao combo, nao a ela, e
  // repetir o preco do combo em cada bebida somaria dinheiro que nao existe.
  const somenteBebidas = order?.somenteBebidas === true;

  const itensParaImprimir = (() => {
    const todos = order.items || [];
    if (!somenteBebidas) return todos;

    const saida = [];
    for (const item of todos) {
      if (isBeverageItem(item)) { saida.push(item); continue; }

      const escolhas = normalizarCombo(item.comboSelections).filter(s => isBeverageName(s.name));

      const qtdDoItem = item.qty || item.quantity || 1;
      for (const sel of escolhas) {
        saida.push({
          name: `${sel.name}  (do ${cleanAscii(item.name || "combo")})`,
          qty: (Number(sel.quantity) || 1) * qtdDoItem,
          price: 0,
          isBeverage: true,
        });
      }
    }
    return saida;
  })();

  // Nada de bebida neste pedido: esta impressora nao cospe papel em branco.
  if (somenteBebidas && itensParaImprimir.length === 0) return null;

  /* ── AGRUPADOS OU SEPARADOS ─────────────────────────────────────────────
   *
   * Cinco X-Bacon saem como "5x X-Bacon" (agrupado, o padrao de sempre) ou
   * como cinco linhas de "1x X-Bacon" (separado).
   *
   * Nao e preferencia de estilo: e como a cozinha trabalha. Quem monta lanche
   * a lanche risca UMA linha por unidade e usa o papel como checklist — com
   * "5x" numa linha so, o cozinheiro perde a conta no meio do movimento e
   * manda quatro. Quem embala junto prefere agrupado, que ocupa menos papel.
   *
   * A escolha e POR IMPRESSORA (a cozinha separa, o caixa agrupa), vem em
   * `separarItens` no destino, e o padrao e agrupar — toda loja ja configurada
   * continua imprimindo exatamente como imprimia.
   *
   * Os VALORES nao mudam: o total vem de `order.totalAmount` e o subtotal e
   * somado de `order.items`, a lista ORIGINAL. Separar so muda o desenho das
   * linhas. */
  const itensDesenhados = (() => {
    if (order.separarItens !== true) return itensParaImprimir;
    const saida = [];
    for (const item of itensParaImprimir) {
      const q = Number(item.qty || item.quantity || 1) || 1;
      // Fracao (0,5 pizza) e quantidade que nao seja inteira positiva ficam
      // como estao: repetir "0.5x" cinco vezes nao significaria nada.
      if (!Number.isInteger(q) || q < 2) { saida.push(item); continue; }
      for (let i = 0; i < q; i++) saida.push({ ...item, qty: 1, quantity: 1 });
    }
    return saida;
  })();

  const INVERSE_ON = "\x1d\x42\x01";
  const INVERSE_OFF = "\x1d\x42\x00";

  /**
   * Pinta de preto a palavra BEBIDA numa linha JÁ montada e alinhada.
   *
   * Só a palavra, não a seta: é ela que o garçom procura de relance na pilha
   * de comandas. Trocar só "BEBIDA" também é o que sobrevive à quebra de
   * linha — `wrap` quebra nos espaços, então a palavra nunca chega partida.
   */
  const marcarBebida = (linha, ehBebida) =>
    ehBebida ? linha.replace("BEBIDA", INVERSE_ON + "BEBIDA" + INVERSE_OFF) : linha;

  // Comanda da COZINHA: mesmos itens, sem um preço na folha.
  //
  // O site tinha o botão "Cupom da Cozinha (Sem Valores)" desde sempre, e ele
  // saía com valores: o sinalizador parava no meio do caminho e aqui não havia
  // nada que o lesse. Quem monta o pedido na cozinha não precisa saber quanto
  // custa, e cupom com preço circulando no salão é o tipo de papel que acaba
  // na mão do cliente errado.
  const semValores = order?.semValores === true;

  // 4. RESUMO DO PEDIDO SECTION (Inside Boxes!)
  marcas.fimEntrega = res.length;
  marcas.tituloItens = res.length;
  res += LF + DOUBLE_HEIGHT + makeHeaderTitle(ehConta ? "CONTA DA MESA" : "RESUMO DO PEDIDO") + DOUBLE_OFF + LF;
  marcas.itens = res.length;

  // O recado vem ANTES da lista: é o que muda o modo de fazer o prato, e
  // quem lê a comanda de cima para baixo precisa saber disso antes de montar.
  const recado = ehConta ? "" : recadoDoCliente();
  if (recado) {
    // Sem a faixa, o recado ganha o rotulo na propria linha: texto solto no
    // meio da comanda nao diz de quem e.
    if (avisoLigado("faixaObservacao")) {
      res += LF + INVERSE_ON + banner("!! OBSERVACAO DO CLIENTE !!", "!! OBSERVACAO !!") + INVERSE_OFF + LF;
      res += wrapLines(recado, 2);
    } else {
      res += LF + wrapLines("Obs. do cliente: " + recado, 2);
    }
    res += LF;
  }

  if (somenteBebidas) {
    res += LF + INVERSE_ON + banner("!! SO BEBIDAS DESTE PEDIDO !!", "!! SO BEBIDAS !!") + INVERSE_OFF + LF;
  }

  // A lista de itens e a filtrada; `order.items` continua sendo o segundo
  // argumento de getItemEffectivePrice porque o rateio do desconto so fecha
  // olhando o pedido INTEIRO, nao o pedaco que esta sendo impresso.
  if (itensDesenhados.length) {
    res += boxBorder;
    itensDesenhados.forEach((item, idx) => {
      const qty = item.qty || item.quantity || 1;
      const unitPrice = getItemEffectivePrice(item, order.items, order.totalAmount, order.deliveryFee || 0, order.discountTotal || 0);
      const price = unitPrice * qty;
      const priceStr = semValores ? "" : "R$ " + price.toFixed(2).replace(".", ",");
      let name = cleanAscii(item.name || item.menuProduct?.name || "Item");
      name = name.replace(/\s*\[\s*◄\s*BEBIDA\s*►\s*\]/gi, "").replace(/\s*<===\s*BEBIDA/gi, "").trim();

      const comboSels = normalizarCombo(item.comboSelections);

      // A tag no item PAI so vale para bebida avulsa — e a mesma regra da
      // previa na tela. Um combo cujo NOME tem a palavra "Bebidas" saia
      // marcado como se ele proprio fosse a bebida, inclusive quando a loja ja
      // tinha tirado a bebida de dentro dele. Dentro do combo, quem leva a tag
      // e a linha da bebida, logo abaixo.
      const isItemBev = !ehConta && comboSels.length === 0 && isBeverageItem(item);
      const bevTag = isItemBev ? "  <=== BEBIDA" : "";
      const itemLabel = `${name}${bevTag}`;
      // A inversão entra DEPOIS de montar a linha, nunca antes.
      //
      // INVERSE_ON e INVERSE_OFF são três bytes de controle cada, que o papel
      // não imprime mas o `.length` do JavaScript conta. Se entrassem no rótulo
      // antes de padLine, o alinhamento acharia a linha 6 caracteres mais longa
      // e empurraria a coluna do preço para a esquerda — ou quebraria a linha no
      // meio. É por isso que a faixa "CONTEM BEBIDA" sempre funcionou: lá a
      // inversão envolve a linha inteira, já montada.
      res += marcarBebida(makeBoxLine(`${qty}x ${itemLabel}`, priceStr), isItemBev);

      if (comboSels.length > 0) {
        comboSels.forEach((sel) => {
          const totalQty = sel.quantity || 1;
          const qPrefix = totalQty > 1 ? `${totalQty}x ` : "";
          let selName = cleanAscii(sel.name || "");
          selName = selName.replace(/\s*\[\s*◄\s*BEBIDA\s*►\s*\]/gi, "").replace(/\s*<===\s*BEBIDA/gi, "").trim();
          const isSelBev = !ehConta && isBeverageName(selName);
          const selBevTag = isSelBev ? "  <=== BEBIDA" : "";

          // ── O QUE O ADICIONAL CUSTOU, NA LINHA DELE ────────────────────
          //
          // A notinha imprimia so o NOME do adicional. O cliente pagava R$ 3,00
          // pelo bacon, o Total batia certo, e o papel nao dizia de onde vinha a
          // diferenca — a loja nao tinha como conferir item a item, nem
          // responder ao cliente que perguntasse. Queixa da Delicias de Casa.
          //
          // Valor da LINHA (unitario x quantidade): e o que ele pagou por
          // aquele adicional. O "2x" ja aparece antes do nome.
          //
          // Na via da COZINHA (semValores) nada disto sai: la o papel nunca
          // leva valor nenhum, e e proposital.
          const addUnit = Number(sel.price ?? sel.unitPrice ?? sel.addition ?? 0);
          const addTotal = Number.isFinite(addUnit) ? addUnit * totalQty : 0;
          const addStr = !semValores && addTotal > 0
            ? "+R$ " + addTotal.toFixed(2).replace(".", ",")
            : "";

          const rotulo = `  - ${qPrefix}${selName}${selBevTag}`;
          res += marcarBebida(
            addStr ? makeBoxLine(rotulo, addStr) : makeBoxText(rotulo),
            isSelBev
          );
        });
      }

      // A OBSERVACAO DO ITEM E O QUE A COZINHA ERRA. Saia no mesmo corpo da
      // lista e recuada dois espacos, e "sem cebola" se perdia no meio dos
      // complementos — o pedido voltava. Decisao do dono (19/09/2026), com a
      // comanda do iFood como regua. Sem o recuo: em corpo ampliado ele come a
      // coluna que falta para a frase.
      if (item.notes) {
        res += ampliado(`${R("itens", "observacaoDoItem", "Obs:")} ${cleanAscii(item.notes)}`, CORPO_DA_OBSERVACAO, { negrito: N("itens", "observacaoDoItem", true) });
      }
      res += boxBorder;
    });
  }

  if (hasBeverages && !ehConta && avisoLigado("contemBebida")) {
    // Nasce em 2x (DESTAQUE_DO_AVISO_DE_BEBIDA em src/lib/comanda-modelo.ts).
    // A loja aumenta ou diminui em Impressoras > Personalizar notinha; bebida
    // esquecida volta como entrega refeita, e a faixa no corpo do resto do
    // papel se perdia na pilha de comandas do balcao (NIK, 21/09/2026).
    res += bannerNoCorpo(
      "!! ATENCAO: POSSUI BEBIDA NESTE PEDIDO !!",
      "!! CONTEM BEBIDA !!",
      C("itens", "avisoDeBebida", 2)
    );
    res += boxBorder;
  }

  // 5. TOTALS
  marcas.fimItens = res.length;
  marcas.totais = res.length;
  // Comanda so de bebida tambem para aqui: ela mostra um pedaco do pedido, e
  // um total embaixo de um pedaco seria um numero que nao corresponde a nada.
  if (somenteBebidas) {
    res += LF + centerLine("-- COMANDA DE BEBIDAS --") + LF;
    res += LEFT + FEED + CUT;
    return Buffer.from(res, "binary");
  }

  // Na comanda da cozinha o papel acaba aqui: nada de subtotal, taxa, total,
  // forma de pagamento nem "COBRAR DO CLIENTE".
  if (semValores) {
    // A via da cozinha tem modelo proprio (o site manda a lista certa em
    // `order.blocos`), e ela acaba aqui: nada de valores no papel.
    marcas.fimItens = marcas.fimItens == null ? res.length : marcas.fimItens;
    res = aplicarModelo();
    res += LF + centerLine("-- COMANDA DA COZINHA --") + LF;
    res += centerLine("(sem valores)") + LF;
    res += LEFT + FEED + CUT;
    return Buffer.from(res, "binary");
  }

  res += LF;
  // ── O QUE SAIU EM OUTRA IMPRESSORA ─────────────────────────────────────
  //
  // A loja que separa a cozinha por categoria recebe aqui SO os itens desta
  // impressora, mas o total e o do pedido inteiro. A diferenca caia na conta
  // do desconto e saia "Outros valores do pedido: R$ 36,00" — os dois sucos
  // que foram para a COZINHA PIZZA, na comanda de mesa da Ragnar Burger
  // (24/09/2026). Quem le nao tinha como saber o que era aquilo.
  //
  // O site manda `restoDoPedido` ({ itens, valor }) com o que foi para as
  // outras impressoras (src/lib/roteamento-de-impressao.ts). Aqui ele ganha
  // linha propria e entra na conta, que volta a fechar: subtotal desta +
  // outra impressora - descontos + entrega = total.
  const resto = !ehConta && order.restoDoPedido && Number(order.restoDoPedido.valor) > 0
    ? {
        itens: Math.max(0, Math.round(Number(order.restoDoPedido.itens) || 0)),
        valor: Math.round(Number(order.restoDoPedido.valor) * 100) / 100,
      }
    : null;
  const valorDoResto = resto ? resto.valor : 0;
  const subtotal = order.items?.reduce((sum, it) => sum + (getItemEffectivePrice(it, order.items, Number(order.totalAmount || 0) - valorDoResto, order.deliveryFee || 0, order.discountTotal || 0) * (it.qty || it.quantity || 1)), 0) || order.totalAmount || 0;
  // ── A CONTA DA MESA TEM SEU PROPRIO RODAPE ────────────────────────────
  //
  // Antes a taxa de servico e a gorjeta vinham como ITENS, misturadas aos
  // pratos: o cliente lia "1x Taxa de servico 10% .... R$ 12,90" como se
  // fosse mais um pedido da mesa, e o subtotal ja vinha com os 10% dentro.
  // Deu reclamacao de cliente (15/09/2026). Agora o servidor manda os
  // valores em campos proprios (consumo, taxaServico, gorjeta) e o rodape e
  // este: consumo, desconto, taxa, gorjeta e o total — nessa ordem, que e a
  // ordem em que a pessoa confere a conta.
  // `taxaSeparada` vem do servidor e diz que a taxa NAO esta na lista de
  // itens. Nao da para deduzir por `consumo`: ele ja viajava no cupom antes
  // desta mudanca, e cupom antigo reimpresso (PrintRequest guarda o payload)
  // cairia aqui com a taxa ainda dentro dos itens.
  const contaComRodape = ehConta && order.taxaSeparada === true;
  if (contaComRodape) {
    const dinheiroConta = (v) => "R$ " + Number(v).toFixed(2).replace(".", ",");
    const consumo = Number(order.consumo || 0) > 0 ? Number(order.consumo) : subtotal;
    res += rightAlign("Consumo:", dinheiroConta(consumo));

    const descontoConta = Number(order.descontoDaConta?.valor || 0);
    if (descontoConta > 0) {
      const motivo = String(order.descontoDaConta?.motivo || "").trim();
      res += rightAlign("Desconto:" + (motivo ? " " + cleanAscii(motivo).slice(0, 18) : ""), "-" + dinheiroConta(descontoConta));
    }

    const taxaValor = Number(order.taxaServico?.valor || 0);
    if (taxaValor > 0) {
      const pct = Number(order.taxaServico?.percentual || 0);
      res += rightAlign("Taxa de servico" + (pct > 0 ? " " + pct + "%" : "") + ":", dinheiroConta(taxaValor));
    }
    const gorjetaValor = Number(order.gorjeta || 0);
    if (gorjetaValor > 0) res += rightAlign("Gorjeta:", dinheiroConta(gorjetaValor));
  } else {
    res += comNegrito(rightAlign(R("totais", "subtotal", "Subtotal:"), "R$ " + Number(subtotal).toFixed(2).replace(".", ",")), "totais", "subtotal", false);
    if (resto) {
      // Em 58 mm a contagem nao cabe na linha com o valor.
      const rotuloDoResto = columns >= 42 && resto.itens > 0
        ? `Em outra impressora (${resto.itens} ${resto.itens === 1 ? "item" : "itens"}):`
        : "Em outra impressora:";
      res += rightAlign(rotuloDoResto, "R$ " + resto.valor.toFixed(2).replace(".", ","));
    }
  }

  const dFee = typeof order.deliveryFee === "number" ? order.deliveryFee : 0;
  const dFeeLabel = R("totais", "taxaEntrega", order.source === "IFOOD" ? "Taxa de Entrega (iFood):" : "Taxa de Entrega:");
  const dinheiro = (v) => "R$ " + Number(v).toFixed(2).replace(".", ",");

  // ── O DESCONTO IMPRESSO E O QUE REALMENTE SAIU DA CONTA ──────────────
  //
  // O TOTAL nao e somado aqui: vem do parceiro (`totalAmount`), unica fonte
  // confiavel do que o cliente pagou. Ja as linhas de desconto sao montadas de
  // campos separados, e no 99Food elas nao correspondem ao que foi abatido:
  // medido em 12/09/2026, 12 de 12 pedidos imprimiam "59,99 - 25,00 + 1,00" e
  // Total 48,52. A diferenca e o desconto que o PARCEIRO bancou — ele aparece
  // em `discountTotal` mas nunca saiu do bolso da loja nem do cliente.
  //
  // O lojista soma de cabeca, ve que nao fecha, e para de confiar no papel
  // inteiro — inclusive na parte certa. Entao o desconto impresso passa a ser
  // o que a conta exige: subtotal + taxa - total. As linhas separadas
  // (iFood/loja) so saem quando elas mesmas fecham; senao sai uma linha so,
  // com o numero que corresponde ao que o cliente pagou.
  const totalCobrado = Number(order.totalAmount || 0);
  // ── TAXA DE SERVICO DO PARCEIRO ──────────────────────────────────────
  //
  // O 99Food cobra do cliente uma taxa de servico que entra no total mas
  // nao e item, nem entrega, nem desconto. Sem ela a conta abaixo nunca
  // fechava num pedido do 99 com taxa (R$ 0,99 no #266003 do Frangoso,
  // 17/09/2026) e as linhas separadas nunca saiam — o papel dizia so
  // "Desconto: -69,01", que nao e nenhum numero que o lojista reconheca.
  // O servidor manda `serviceFee` (src/lib/desconto-99food.ts); servidor
  // antigo nao manda e tudo fica como era.
  const sFee = Number(order.serviceFee || 0) > 0 ? Number(order.serviceFee) : 0;
  const descontoQueFecha = Math.round((Number(subtotal) + valorDoResto + Number(dFee) + sFee - totalCobrado) * 100) / 100;

  // A parte da PLATAFORMA: `discountIfood` e o campo historico do iFood; o
  // 99Food chega em `discountPlatform` com o rotulo junto, porque "Desconto
  // (iFood)" numa comanda do 99 e outra reclamacao.
  const plataformaValor = Number(order.discountPlatform || order.discountIfood || 0);
  const plataformaRotulo = String(order.discountPlatformLabel || "Desconto (iFood):");
  const partes = [];
  if (plataformaValor > 0) partes.push([plataformaRotulo, plataformaValor]);
  if (order.discountMerchant && Number(order.discountMerchant) > 0) partes.push([R("totais", "desconto", "Desconto (Cupom - Loja):"), Number(order.discountMerchant)]);
  else if (!(plataformaValor > 0) && order.discountTotal && Number(order.discountTotal) > 0) partes.push([R("totais", "desconto", "Desconto (Cupom - Loja):"), Number(order.discountTotal)]);
  const somaDasPartes = Math.round(partes.reduce((s, p) => s + p[1], 0) * 100) / 100;

  if (ehConta) {
    // Conta da mesa nao tem taxa nem total do parceiro para conferir contra.
    for (const [rotulo, valor] of partes) res += rightAlign(rotulo, "-" + dinheiro(valor));
  } else if (Math.abs(somaDasPartes - descontoQueFecha) < 0.01) {
    for (const [rotulo, valor] of partes) res += rightAlign(rotulo, "-" + dinheiro(valor));
  } else if (descontoQueFecha > 0.005) {
    res += rightAlign("Desconto:", "-" + dinheiro(descontoQueFecha));
  } else if (descontoQueFecha < -0.005) {
    // Total maior que subtotal + taxa: taxa de servico ou embalagem do
    // parceiro, que nao chega em campo proprio.
    res += rightAlign("Outros valores do pedido:", dinheiro(Math.abs(descontoQueFecha)));
  }

  // A loja pode pedir para esta LINHA nao sair (modelo da comanda, bloco
  // "Valores e total"). O TOTAL nao muda: ele vem de order.totalAmount, que ja
  // inclui a taxa — some a linha, nao o dinheiro.
  marcas.taxaEntrega = res.length;
  if (!ehConta) {
    // ── ENTREGA ISENTADA: O VALOR CONTINUA NO PAPEL ────────────────────
    //
    // Isentar zera a taxa, e a comanda saia com 'Taxa de Entrega: R$ 0,00' —
    // que nao diz nem quanto era nem por que nao foi cobrada. A loja precisa
    // dos dois numeros para conferir com o motoboy, e o cliente precisa ver
    // que ganhou alguma coisa. O servidor manda {valor, motivo} em
    // order.entregaGratis (src/lib/entrega-gratis.ts).
    var gratis = order.entregaGratis && Number(order.entregaGratis.valor) > 0 ? order.entregaGratis : null;
    if (gratis) {
      res += rightAlign(dFeeLabel, dinheiro(Number(gratis.valor)) + " GRATIS");
      var motivoDaIsencao = String(gratis.motivo || "").trim();
      if (motivoDaIsencao) res += "  " + motivoDaIsencao.slice(0, 40) + "\n";
    } else if (!(ehPedidoDeMesa && !(Number(dFee) > 0))) {
      // Mesa nao tem entrega: "Taxa de Entrega: R$ 0,00" ali e so ruido.
      res += rightAlign(dFeeLabel, dinheiro(dFee));
    }
    // Taxa de servico do parceiro, na linha dela — e o que faz o total fechar
    // na frente do lojista: subtotal - descontos + entrega + servico = total.
    if (sFee > 0) res += rightAlign(String(order.serviceFeeLabel || "Taxa de servico:"), dinheiro(sFee));
  }
  marcas.fimTaxaEntrega = res.length;

  // TOTAL BOX — destaque limpo
  const totalValStr = "R$ " + Number(order.totalAmount || 0).toFixed(2).replace(".", ",");
  res += boxBorder;
  res += DOUBLE_HEIGHT + comNegrito(makeBoxLine(R("totais", "total", "Total:"), totalValStr), "totais", "total", true) + DOUBLE_OFF;
  res += boxBorder;

  marcas.fimTotais = res.length;
  marcas.pagamento = res.length;
  // 6. PAYMENT METHOD & SAFETY NOTE
  // ── CONTA DA MESA ────────────────────────────────────────────────────
  //
  // O servidor manda a conta como um "pedido" (src/lib/conta-da-mesa.ts) com
  // `rateio` = quanto cada pessoa paga. Assistente antigo ignora o campo e
  // imprime a conta como comanda comum, com a divisao dentro do nome do
  // cliente; este imprime o bloco proprio.
  const ehMesa = order.deliveryType === "MESA" || order.kind === "CONTA_DA_MESA";
  if (Array.isArray(order.rateio) && order.rateio.length > 0) {
    res += LF + DOUBLE_HEIGHT + makeHeaderTitle("DIVISAO POR PESSOA") + DOUBLE_OFF + LF;
    res += boxBorder;
    for (const parte of order.rateio) {
      const valor = "R$ " + Number(parte?.valor || 0).toFixed(2).replace(".", ",");
      res += makeBoxLine(cleanAscii(parte?.nome || "Pessoa"), valor);
    }
    res += boxBorder;
  }

  const payMethodRaw = cleanAscii(order.paymentMethod || "");
  const payMethodClean = payMethodRaw.toLowerCase();
  const isExplicitOffline =
    /dinheiro|cobrar|maquin|entrega|pendente|troco|presencial|balc/i.test(payMethodClean) ||
    order.isPrepaid === false ||
    order.prepaid === false;

  const isOnlinePayment = !isExplicitOffline && (
    /pago online|online|prepaid|ifood pago|jotaja pago|jotaj\u00e1 pago|app/i.test(payMethodClean) ||
    order.isPrepaid === true
  );

  let baseMethodName = payMethodRaw
    .replace(/\s*\([^)]*\)/gi, "")
    .trim();
  if (!baseMethodName || baseMethodName.toUpperCase() === "OTHER") baseMethodName = "Cartao";

  // "(Pago via Online)" nao diz em qual app o dinheiro entrou. Com o nome do
  // canal, quem confere o caixa sabe onde procurar. Cai em "Online" so no
  // pedido do proprio site, que e onde a palavra ja basta.
  const onlineSource = NOME_DO_CANAL[srcStr] || "Online";

  // ── A RODADA DA MESA NAO SE PAGA SOZINHA ──────────────────────────────
  //
  // Cada rodada lancada na mesa e um pedido, e nenhum e pago por si: tudo
  // entra na conta, que fecha no caixa (src/lib/conta-da-mesa.ts). O papel
  // dizia "Forma de Pagamento: N/A", "(PAGAR NO CAIXA OU NA MESA)" e
  // "!! TOTAL A PAGAR: R$ 128,70 !!" — o valor de UMA rodada, que nao e o
  // que a mesa paga. Vale so para o pedido com conta aberta
  // (`tableSessionId`); a "Mesa 20" lancada no PDV sem conta, com a forma de
  // pagamento escolhida ali, segue como sempre.
  const naContaDaMesa = ehPedidoDeMesa && !!order.tableSessionId;

  // Os avisos desta secao obedecem a aba Avisos — menos na CONTA DA MESA, que
  // e outro papel: "TOTAL A PAGAR" ali e a propria conta, nao um aviso.
  if (naContaDaMesa) {
    res += comNegrito(wrapLines(R("pagamento", "formaDePagamento", "Forma de Pagamento:") + " na conta da mesa", 2), "pagamento", "formaDePagamento", true);
  } else if (isOnlinePayment) {
    res += comNegrito(wrapLines(R("pagamento", "formaDePagamento", "Forma de Pagamento:") + " " + baseMethodName, 2), "pagamento", "formaDePagamento", true);
    if (ehMesa || avisoLigado("pagoOnline")) {
      res += DOUBLE_HEIGHT + wrapLines("(Pago via " + onlineSource + " - NAO COBRAR)", 2) + DOUBLE_OFF;
    }
  } else {
    res += comNegrito(wrapLines(R("pagamento", "formaDePagamento", "Forma de Pagamento:") + " " + baseMethodName, 2), "pagamento", "formaDePagamento", true);
    if (ehMesa || avisoLigado("cobrarNaEntrega")) {
      res += DOUBLE_HEIGHT + wrapLines(ehMesa ? "(PAGAR NO CAIXA OU NA MESA)" : "(COBRAR NA ENTREGA)", 2) + DOUBLE_OFF;
    }

    if (order.changeAmount != null && Number(order.changeAmount) > 0 && (ehMesa || avisoLigado("troco"))) {
      const changeFor = Number(order.changeAmount);
      const totalVal = Number(order.totalAmount || 0);
      const changeToReturn = Math.max(0, changeFor - totalVal);
      const changeForStr = "R$ " + changeFor.toFixed(2).replace(".", ",");
      const changeToReturnStr = "R$ " + changeToReturn.toFixed(2).replace(".", ",");

      res += DOUBLE_HEIGHT + comNegrito(wrapLines(R("pagamento", "troco", "Troco para:") + " " + changeForStr + " (Levar " + changeToReturnStr + " de troco)", 2), "pagamento", "troco", true) + DOUBLE_OFF;
    }

    if (ehMesa || avisoLigado("cobrarDoCliente")) {
      res += divider;
      res += DOUBLE_HEIGHT + BOLD_ON + wrapLines((ehMesa ? "!! TOTAL A PAGAR: " : "!! COBRAR DO CLIENTE NA ENTREGA: ") + totalValStr + " !!", 2) + BOLD_OFF + DOUBLE_OFF;
    }
  }

  marcas.fimPagamento = res.length;
  marcas.qrMotoboy = res.length;
  // ── QR "PUXAR PEDIDO" ──────────────────────────────────────────────────
  //
  // So sai quando o servidor mandou `qrPuxarUrl` — ele ja decidiu tudo la
  // (entrega da loja, nao-parceira, flag da loja ligada). O QR carrega a URL
  // do app do motoboy com ?p=AAAAMMDD-numero: NADA de segredo no papel, o
  // numero ja esta impresso em corpo dobrado no topo desta mesma comanda.
  //
  // ESC/POS: GS ( k — o comando de QR do padrao Epson, que as POS-58/80
  // genericas seguem. Impressora que NAO conhece o comando simplesmente o
  // ignora (dados de funcao ficam fora do fluxo de texto), e o rodape com o
  // numero digitavel sai do mesmo jeito — o app aceita digitar o numero, entao
  // nenhuma loja fica sem o recurso por causa da impressora. No perfil
  // "legacy" o QR nem e tentado: e o perfil das impressoras que imprimem lixo
  // com comando desconhecido.
  if (order.qrPuxarUrl && profile !== "legacy") {
    res += LF + CENTER + qrEscPos(order.qrPuxarUrl, 6);
    res += LF + comNegrito(centerLine(R("qrMotoboy", "chamada", "MOTOBOY: escaneie para puxar")), "qrMotoboy", "chamada", true);
    const codigoCurto = String(order.qrPuxarCodigo || "").split("-").pop() || "";
    if (codigoCurto) {
      res += comNegrito(centerLine(R("qrMotoboy", "digite", "ou digite o numero") + " " + codigoCurto + " no app"), "qrMotoboy", "digite", false);
    }
    res += LEFT;
  }

  marcas.fimQrMotoboy = res.length;
  marcas.qrCliente = res.length;
  // ── CAMPANHA "CONVERTER PARA SITE PROPRIO" ────────────────────────────
  //
  // O bloco "VOCE GANHOU R$ X" + QR com cupom que vai grampeado no saco do
  // pedido do iFood/99Food, para o proximo pedido daquele cliente entrar pelo
  // site da loja, sem comissao. Quem decide SE sai e EM QUAL impressora e o
  // servidor (lib/campanha-converter.ts): aqui so se desenha o que veio em
  // `order.campanha`. Nunca na comanda da cozinha (semValores) — o bloco e
  // para o cliente ler em casa, nao para a chapa.
  //
  // O titulo e o premio saem em corpo dobrado nos DOIS eixos (DOUBLE_SIZE):
  // cada caractere ocupa duas colunas, entao a centralizacao e sobre
  // columns/2. centerLine centraria sobre a largura simples e o texto sairia
  // empurrado para a direita (ou cortado, na bobina de 58 mm).
  const campanha = order.campanha && typeof order.campanha === "object" ? order.campanha : null;
  if (campanha && !semValores) {
    const centerBig = (text) => {
      const t = cleanAscii(text).trim();
      if (!t) return "";
      const largura = Math.floor(columns / 2);
      if (t.length > largura) return DOUBLE_HEIGHT + BOLD_ON + centerLine(t) + BOLD_OFF + DOUBLE_OFF;
      return DOUBLE_SIZE + BOLD_ON + " ".repeat(Math.max(0, Math.floor((largura - t.length) / 2))) + t + LF + BOLD_OFF + DOUBLE_OFF;
    };
    res += LF + LEFT + divider + LF;
    res += centerBig(campanha.titulo || "VOCE GANHOU");
    res += centerBig(campanha.premio || "");
    if (campanha.texto) res += BOLD_ON + centerLine(campanha.texto) + BOLD_OFF;
    if (campanha.url && profile !== "legacy") {
      // Modulo 8 (o do motoboy e 6): este QR e lido pelo cliente com a camera
      // do celular, em casa, e nao pelo motoboy a 30 cm — quanto maior, melhor.
      res += LF + CENTER + qrEscPos(campanha.url, 8) + LF;
    }
    res += LEFT + comNegrito(centerLine(R("qrCliente", "chamada", "Escaneie e faca seu proximo pedido")), "qrCliente", "chamada", true);
    if (campanha.codigo) {
      res += comNegrito(centerLine(R("qrCliente", "cupom", "ou use o cupom") + " " + String(campanha.codigo).toUpperCase()), "qrCliente", "cupom", false);
      if (campanha.endereco) {
        // Na bobina de 58 mm o endereco nao cabe numa linha e a quebra por
        // palavra cortaria o slug no meio ("pastel-d / a-paulista"). Parte
        // em "/loja/", que e onde da para ler: dominio numa linha, loja na outra.
        const endereco = cleanAscii(String(campanha.endereco)).trim();
        const corte = endereco.indexOf("/loja/");
        if (("em " + endereco).length <= columns || corte <= 0) {
          res += centerLine("em " + endereco);
        } else {
          res += centerLine("em " + endereco.slice(0, corte));
          res += centerLine(endereco.slice(corte));
        }
      }
    }
    for (const regra of Array.isArray(campanha.regras) ? campanha.regras : []) {
      res += centerLine(String(regra));
    }
    res += LEFT + divider;
  }

  marcas.fimQrCliente = res.length;

  res = aplicarModelo();
  res += LF + (avisoLigado("obrigado") ? centerLine("Obrigado pela preferencia!") : "") + LEFT + FEED + CUT;
  return Buffer.from(res, "binary");
}

export const VERSAO_DO_ASSISTENTE = "1.2.25";
export const ASSINATURA_DO_CODIGO = "2240f279304157ac";

/** Os bytes ESC/POS da comanda, como o Assistente 1.2.25 manda para a impressora. */
export function comandaDoAssistente(order, storeName, columns, profile = "safe") {
  return buildEscPos(order, storeName, columns, profile);
}
