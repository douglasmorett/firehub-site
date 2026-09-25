/**
 * A saúde do vínculo do WhatsApp, do jeito que a tela do robô mostra.
 *
 * ── O caso (Divinos Burger, 24–25/09/2026) ──────────────────────────────────
 *
 * A tela dizia "Conectado e Operacional" e "WhatsApp Vinculado com Sucesso!"
 * a noite inteira, enquanto 100% do que o robô mandava chegava aos clientes
 * como "Aguardando mensagem". O gateway passou a saber disso (vínculo doente,
 * aparelho hospedado da API oficial, QR lido num WhatsApp comum) e o FireHub
 * passou a receber — mas nada chegava aos olhos do lojista. Aqui essas
 * informações viram avisos com o que fazer.
 *
 * ── De onde vem a informação ────────────────────────────────────────────────
 *
 * Três leituras, cada uma com a hora em que foi feita:
 *   1. AO VIVO: GET /api/chatbot/qrcode com a loja conectada devolve o que o
 *      gateway sabe agora (`vinculoDoente`, `motivoDoVinculo`,
 *      `aparelhoHospedado`, `plataforma`, `avisosDoVinculo`). A hora é a do
 *      cabeçalho `Date` da resposta — relógio do servidor, o mesmo que carimba
 *      as outras duas; o relógio do computador da loja pode estar minutos
 *      errado e inverter quem é a mais nova.
 *   2. `chatbotConfig.saudeDoVinculo`: gravada pelo webhook quando o gateway
 *      AVISA que mudou (entrou/saiu do doente, achou aparelho hospedado) e na
 *      abertura da conexão. É o que chega enquanto a tela está aberta.
 *   3. `chatbotConfig.vinculoDoAparelho`: gravada na abertura da conexão —
 *      o aplicativo que leu o QR e o aviso "numero-do-dono", que só o FireHub
 *      calcula (ele é quem conhece os números cadastrados da loja).
 *
 * O estado do gateway (doente, hospedado, número comum) vale pela leitura
 * MAIS NOVA: o doente sara sozinho quando a janela de uma hora passa, e
 * somar as três deixaria o aviso aceso depois da cura. O "numero-do-dono" vem
 * sempre da 3, a única que o tem.
 */

export type AvisoDoVinculo = { tipo: string; mensagem: string };

/** O que o GET /api/chatbot/qrcode devolveu sobre a saúde, com a hora da leitura. */
export type LeituraAoVivo = {
  vinculoDoente: boolean;
  motivo: string | null;
  aparelhoHospedado: boolean;
  plataforma: string | null;
  avisos: AvisoDoVinculo[];
  lidoEm: number;
};

export type TipoDeProblema = "vinculo-doente" | "aparelho-hospedado" | "numero-errado";

export type ProblemaDoVinculo = {
  tipo: TipoDeProblema;
  titulo: string;
  passos: string[];
  /** O texto do servidor, para quem quiser o porquê (vai num "ver detalhe"). */
  detalhes: string[];
  /**
   * Só o "QR lido num WhatsApp comum" pode ser dispensado: há loja pequena
   * cujo número é mesmo um WhatsApp comum, e um aviso que nunca apaga ensina
   * o lojista a ignorar a faixa — inclusive no dia do vínculo doente.
   */
  dispensavel: boolean;
};

export type SaudeDoVinculoNaTela = {
  problemas: ProblemaDoVinculo[];
  /** Código do aplicativo que leu o QR ("smba", "iphone"...), quando se sabe. */
  plataforma: string | null;
  /** O mesmo, em português ("WhatsApp Business (Android)"). */
  nomeDaPlataforma: string | null;
  /** Hora (ms, relógio do servidor) da informação mais nova que decidiu a faixa. */
  vistoEm: number | null;
};

// Os três textos são a ordem que o lojista precisa ler — não o diagnóstico.
export const TITULO_VINCULO_DOENTE =
  "Os clientes não estão conseguindo ler as mensagens do robô: remova os aparelhos estranhos em Aparelhos conectados e leia o QR uma vez.";
export const TITULO_APARELHO_HOSPEDADO =
  "Seu WhatsApp está ligado a outro sistema pela API oficial (ex.: CardápioWeb/Saipos). Desconecte lá e leia o QR de novo.";
export const TITULO_NUMERO_ERRADO =
  "Este vínculo foi feito com um número que não é o WhatsApp Business da loja.";

const TIPOS_DE_NUMERO_ERRADO = new Set(["numero-pessoal", "numero-do-dono"]);

// ── LEITURA DEFENSIVA (tudo aqui veio de fora: gateway → webhook → banco) ────

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function avisosValidos(bruto: unknown): AvisoDoVinculo[] {
  if (!Array.isArray(bruto)) return [];
  const saida: AvisoDoVinculo[] = [];
  for (const a of bruto) {
    const tipo = texto((a as any)?.tipo, 40);
    const mensagem = texto((a as any)?.mensagem, 600);
    if (tipo && mensagem) saida.push({ tipo, mensagem });
    if (saida.length >= 5) break;
  }
  return saida;
}

function momento(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/**
 * A hora da resposta pelo cabeçalho `Date` (relógio do servidor). Sem ele —
 * ou ilegível —, a hora do computador da loja: melhor que nada.
 */
export function momentoDaResposta(cabecalhoDate: string | null | undefined, agora: number = Date.now()): number {
  const t = cabecalhoDate ? Date.parse(cabecalhoDate) : NaN;
  return Number.isFinite(t) ? t : agora;
}

/**
 * A saúde que veio junto da resposta do GET /api/chatbot/qrcode — ou null.
 *
 * Só com a loja CONECTADA e o campo `vinculoDoente` presente: desconectada, a
 * rota devolve o QR, não a saúde; e a resposta de erro ("servidor
 * indisponível") não diz nada sobre o vínculo — ler "doente: não" de uma
 * resposta que não perguntou apagaria um aviso verdadeiro.
 */
export function leituraAoVivoDaResposta(resposta: unknown, lidoEm: number): LeituraAoVivo | null {
  const r = resposta as any;
  if (!r || r.connected !== true || typeof r.vinculoDoente !== "boolean") return null;
  return {
    vinculoDoente: r.vinculoDoente,
    motivo: texto(r.motivoDoVinculo, 600),
    aparelhoHospedado: r.aparelhoHospedado === true,
    plataforma: texto(r.plataforma, 20),
    avisos: avisosValidos(r.avisosDoVinculo),
    lidoEm,
  };
}

/** O aplicativo que leu o QR, em português. Os códigos são os do Baileys (`creds.platform`). */
export function nomeDaPlataforma(plataforma: string | null | undefined): string | null {
  const p = String(plataforma || "").trim().toLowerCase();
  if (!p) return null;
  if (p === "smba") return "WhatsApp Business (Android)";
  if (p === "smbi") return "WhatsApp Business (iPhone)";
  if (p.startsWith("smb")) return "WhatsApp Business";
  if (p === "android") return "WhatsApp comum (Android)";
  if (p === "iphone" || p === "ios" || p === "iphone_os") return "WhatsApp comum (iPhone)";
  if (p === "ipad") return "WhatsApp comum (iPad)";
  return `WhatsApp (${p})`;
}

type Leitura = {
  em: number;
  doente?: boolean;
  motivo?: string | null;
  hospedado?: boolean;
  plataforma?: string | null;
  /** Só os avisos do GATEWAY — o "numero-do-dono" é tratado à parte. */
  avisos: AvisoDoVinculo[];
};

/** A mais nova; no empate, a que vem antes na lista (a ao vivo vai primeiro). */
function maisNova(leituras: Array<Leitura | null>, serve: (l: Leitura) => boolean): Leitura | null {
  let escolhida: Leitura | null = null;
  for (const l of leituras) {
    if (!l || !serve(l)) continue;
    if (!escolhida || l.em > escolhida.em) escolhida = l;
  }
  return escolhida;
}

export function saudeDoVinculoNaTela(entrada: {
  conectado: boolean;
  aoVivo?: LeituraAoVivo | null;
  /** `chatbotConfig.saudeDoVinculo` */
  saudeSalva?: unknown;
  /** `chatbotConfig.vinculoDoAparelho` */
  aparelhoSalvo?: unknown;
  /** O lojista já disse que o WhatsApp comum É o número da loja (vale para este número). */
  numeroComumConfirmado?: boolean;
}): SaudeDoVinculoNaTela {
  const vazio: SaudeDoVinculoNaTela = { problemas: [], plataforma: null, nomeDaPlataforma: null, vistoEm: null };
  // Desconectado, a faixa de "robô fora do ar" já diz o que fazer; e os avisos
  // guardados são do vínculo que caiu, não do próximo QR.
  if (!entrada.conectado) return vazio;

  const aoVivo: Leitura | null = entrada.aoVivo
    ? {
        em: entrada.aoVivo.lidoEm,
        doente: entrada.aoVivo.vinculoDoente,
        motivo: entrada.aoVivo.motivo,
        hospedado: entrada.aoVivo.aparelhoHospedado,
        plataforma: entrada.aoVivo.plataforma,
        avisos: entrada.aoVivo.avisos.filter((a) => a.tipo !== "numero-do-dono"),
      }
    : null;

  const s = entrada.saudeSalva as any;
  const saudeSalva: Leitura | null =
    s && typeof s === "object"
      ? {
          em: momento(s.em),
          doente: typeof s.vinculoDoente === "boolean" ? s.vinculoDoente : undefined,
          motivo: texto(s.motivo, 600),
          hospedado: s.aparelhoHospedado === true,
          avisos: avisosValidos(s.avisos).filter((a) => a.tipo !== "numero-do-dono"),
        }
      : null;

  const a = entrada.aparelhoSalvo as any;
  const avisosDoAparelho = a && typeof a === "object" ? avisosValidos(a.avisos) : [];
  const aparelhoSalvo: Leitura | null =
    a && typeof a === "object"
      ? {
          em: momento(a.em),
          plataforma: texto(a.plataforma, 20),
          avisos: avisosDoAparelho.filter((x) => x.tipo !== "numero-do-dono"),
        }
      : null;

  const leituras = [aoVivo, saudeSalva, aparelhoSalvo];

  // Doente/sadio: só quem mede o alarme (ao vivo e o aviso do gateway).
  const doDoente = maisNova(leituras, (l) => typeof l.doente === "boolean");
  // Avisos do aparelho: a mais nova de todas — as três trazem a lista inteira.
  const doAparelho = maisNova(leituras, () => true);
  const daPlataforma = maisNova(leituras, (l) => Boolean(l.plataforma));

  const doente = doDoente?.doente === true;
  const hospedado =
    Boolean(doAparelho) &&
    (doAparelho!.hospedado === true || doAparelho!.avisos.some((x) => x.tipo === "aparelho-hospedado"));
  const avisoHospedado = doAparelho?.avisos.find((x) => x.tipo === "aparelho-hospedado") || null;
  const avisoComum = doAparelho?.avisos.find((x) => x.tipo === "numero-pessoal") || null;
  const avisoDoDono = avisosDoAparelho.find((x) => x.tipo === "numero-do-dono") || null;

  const problemas: ProblemaDoVinculo[] = [];

  // 1º o que os clientes estão sofrendo AGORA; depois as causas.
  if (doente) {
    const passos = [
      "No celular da loja, abra o WhatsApp › Configurações › Aparelhos conectados.",
      "Remova todo aparelho que você não reconhece (outro sistema, computador antigo, WhatsApp Web esquecido).",
      "Volte aqui e clique em “Desconectar e ler o QR de novo” — uma vez só.",
    ];
    if (hospedado) {
      // Religar não cura o aparelho hospedado (é a API oficial, não um celular):
      // sem esta linha o lojista relê o QR, nada muda, e ele relê de novo.
      passos.unshift(
        "Antes de tudo, desligue a integração do outro sistema que usa a API oficial (CardápioWeb, Saipos…): enquanto ela existir, ler o QR de novo não resolve.",
      );
    }
    problemas.push({
      tipo: "vinculo-doente",
      titulo: TITULO_VINCULO_DOENTE,
      passos,
      detalhes: doDoente?.motivo ? [doDoente.motivo] : [],
      dispensavel: false,
    });
  }

  if (hospedado) {
    problemas.push({
      tipo: "aparelho-hospedado",
      titulo: TITULO_APARELHO_HOSPEDADO,
      passos: [
        "Entre no sistema antigo (CardápioWeb, Saipos ou outro que responda pelo WhatsApp) e desligue a integração com o WhatsApp.",
        "Volte aqui e clique em “Desconectar e ler o QR de novo”.",
      ],
      detalhes: avisoHospedado ? [avisoHospedado.mensagem] : [],
      dispensavel: false,
    });
  }

  // "Número do dono" é conferido pelo FireHub contra os números cadastrados:
  // é certeza, não se dispensa. "WhatsApp comum" é suspeita pelo aplicativo.
  const numeroErradoDispensavel = !avisoDoDono && Boolean(avisoComum);
  if ((avisoDoDono || avisoComum) && !(numeroErradoDispensavel && entrada.numeroComumConfirmado)) {
    problemas.push({
      tipo: "numero-errado",
      titulo: TITULO_NUMERO_ERRADO,
      passos: [
        "Pegue o celular da loja e abra o aplicativo WhatsApp Business do número da loja (não o WhatsApp de alguém da equipe).",
        "Clique em “Desconectar e ler o QR de novo” e leia o QR com esse aplicativo.",
      ],
      detalhes: [avisoDoDono, avisoComum]
        .filter((x): x is AvisoDoVinculo => Boolean(x) && TIPOS_DE_NUMERO_ERRADO.has(x!.tipo))
        .map((x) => x.mensagem),
      dispensavel: numeroErradoDispensavel,
    });
  }

  const plataforma = daPlataforma?.plataforma || null;
  const vistoEm = [doDoente, doAparelho].reduce((m, l) => (l && l.em > m ? l.em : m), 0);
  return {
    problemas,
    plataforma,
    nomeDaPlataforma: nomeDaPlataforma(plataforma),
    vistoEm: vistoEm > 0 ? vistoEm : null,
  };
}
