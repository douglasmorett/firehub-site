/**
 * Saúde do vínculo de cada loja com o WhatsApp — e o que o gateway manda (ou
 * não manda) ao FireHub.
 *
 * Módulo sem dependências, separado do server.js para ter teste
 * (scripts/teste-saude-do-vinculo.mjs): o server.js sobe o servidor e exige
 * API_KEY no momento em que é carregado, então nada dele é testável sozinho.
 *
 * ── O caso que isto conserta (Divinos Burger, 24–25/09/2026) ────────────────
 *
 * O painel dizia "conectado" a noite inteira, e o log dizia "enviada com
 * sucesso" a cada notificação de pedido. Mas 100% dos destinatários pediram
 * RETRANSMISSÃO do que o robô mandava — 431 pedidos de 12 contatos, contra no
 * máximo 2 por dia somando as outras 6 lojas. Ou seja: cada "Pedido Recebido",
 * "Saiu para Entrega" e "NOVO PEDIDO ATRIBUÍDO" chegou como "Aguardando
 * mensagem". Esse era o sinal decisivo, e ele só existia num console.warn.
 *
 * E havia dois avisos que ninguém dava:
 *   - a conta da loja tinha um aparelho HOSPEDADO (id 99: API oficial da Meta
 *     em coexistência, típico de quem migrou de um sistema que usa a API
 *     oficial, como o CardápioWeb). O Baileys 6.x não fala com aparelho
 *     hospedado; o gateway o chamava de "aparelho da própria loja", o que
 *     levava a religar à toa;
 *   - o primeiro vínculo da noite de 22/09 foi feito com o WhatsApp PESSOAL do
 *     dono (plataforma "iphone"), não com o WhatsApp Business da loja
 *     ("smba"/"smbi"). Quem escrevia para o número da loja nunca chegava ao
 *     robô.
 *
 * Aqui esses três sinais viram estado por instância, exposto em
 * GET /instance/connectionState e no status público — sem telefone de ninguém.
 */

/** Janela do alarme: contatos DIFERENTES que não conseguiram ler, na última hora. */
const JANELA_DO_ALARME_MS = 60 * 60 * 1000;
/** Mais que isto em uma hora é vínculo doente (a Divinos teve 10 de 10; loja sadia, 0 a 2 por DIA). */
const LIMITE_DE_CONTATOS = 3;
/** O id que o WhatsApp dá ao aparelho hospedado (API oficial / coexistência). */
const ID_DO_APARELHO_HOSPEDADO = 99;

/** WAMessageStubType.CIPHERTEXT do protobuf do WhatsApp: mensagem que não decifrou. */
const STUB_CIPHERTEXT = 2;

// ── ENDEREÇOS ──────────────────────────────────────────────────────────────

/** "36704874438867:99@lid" → { usuario: "36704874438867", dispositivo: 99, servidor: "lid" } */
function decodificarJid(jid) {
  const texto = String(jid || "").trim();
  if (!texto) return { usuario: "", dispositivo: null, servidor: "" };
  const corte = texto.lastIndexOf("@");
  const antes = corte === -1 ? texto : texto.slice(0, corte);
  const servidor = corte === -1 ? "" : texto.slice(corte + 1).toLowerCase();
  const [usuarioComAgente, dispositivoBruto] = antes.split(":");
  // "user_agent" (formato antigo "5522..._1") não é o aparelho; o aparelho vem depois do ":".
  const usuario = String(usuarioComAgente || "").split("_")[0].replace(/\D/g, "");
  const dispositivo = dispositivoBruto === undefined || dispositivoBruto === "" ? null : Number(dispositivoBruto);
  return { usuario, dispositivo: Number.isFinite(dispositivo) ? dispositivo : null, servidor };
}

/** Só os últimos 4 dígitos: dá para achar no banco sem expor o telefone no log. */
function mascararJid(jid) {
  const { usuario, dispositivo, servidor } = decodificarJid(jid);
  if (!usuario) return String(jid || "?").includes("@") ? `?@${servidor}` : "?";
  return `…${usuario.slice(-4)}${dispositivo != null ? `:${dispositivo}` : ""}${servidor ? `@${servidor}` : ""}`;
}

/**
 * Esta conversa vai para o webhook do FireHub?
 *
 * Antes só grupo (@g.us) era barrado aqui. Em 7 horas de 24/09 foram ao
 * webhook 201 posts de status (status@broadcast) e ~30 de canais
 * (@newsletter): carga inútil, e o status ainda podia virar resposta por
 * mensagem direta (o webhook escolhia o telefone de quem postou). O webhook
 * também recusa — isto é a primeira barreira, e a mais barata.
 */
function conversaVaiParaOWebhook(remoteJid) {
  const jid = String(remoteJid || "").trim().toLowerCase();
  if (!jid) return false;
  if (jid.endsWith("@g.us")) return false;
  if (jid.endsWith("@broadcast")) return false; // status@broadcast e listas de transmissão
  if (jid.endsWith("@newsletter")) return false; // canais
  return true;
}

// ── CONTEÚDO DA MENSAGEM ───────────────────────────────────────────────────

/** Tira o envelope de mensagem temporária / visualização única / documento com legenda. */
function desembrulharMensagem(message) {
  let atual = message;
  for (let i = 0; i < 5 && atual && typeof atual === "object"; i++) {
    const dentro =
      (atual.ephemeralMessage && atual.ephemeralMessage.message) ||
      (atual.viewOnceMessage && atual.viewOnceMessage.message) ||
      (atual.viewOnceMessageV2 && atual.viewOnceMessageV2.message) ||
      (atual.viewOnceMessageV2Extension && atual.viewOnceMessageV2Extension.message) ||
      (atual.documentWithCaptionMessage && atual.documentWithCaptionMessage.message);
    if (!dentro) break;
    atual = dentro;
  }
  return atual;
}

function coordenadaValida(lat, lng) {
  const a = typeof lat === "number" ? lat : Number(lat);
  const b = typeof lng === "number" ? lng : Number(lng);
  if (lat === null || lat === undefined || lat === "" || lng === null || lng === undefined || lng === "") return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return false;
  return !(a === 0 && b === 0);
}

function textoCurto(v, max = 120) {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\r\n()]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

/**
 * A localização (📎 → Localização) de uma mensagem, ou null.
 *
 * Era descartada aqui: o gateway só lia texto, legenda e áudio, e a mensagem
 * sem texto nem chegava ao FireHub. Loja que cobra por km perdia o melhor
 * dado que existe para cobrar certo — o ponto do aparelho do cliente.
 */
function localizacaoDaMensagem(message) {
  const conteudo = desembrulharMensagem(message);
  if (!conteudo || typeof conteudo !== "object") return null;
  const fixa = conteudo.locationMessage;
  const aoVivo = conteudo.liveLocationMessage;
  const bruta = fixa || aoVivo;
  if (!bruta || typeof bruta !== "object") return null;
  const lat = bruta.degreesLatitude;
  const lng = bruta.degreesLongitude;
  if (!coordenadaValida(lat, lng)) return null;
  const loc = { lat: Number(lat), lng: Number(lng) };
  const nome = textoCurto(bruta.name);
  const endereco = textoCurto(bruta.address);
  if (nome) loc.nome = nome;
  if (endereco) loc.endereco = endereco;
  if (!fixa && aoVivo) loc.aoVivo = true;
  return loc;
}

/**
 * Cópia da mensagem para o POST ao webhook, sem a miniatura do mapa.
 *
 * O `jpegThumbnail` da localização é um Buffer: no JSON vira
 * `{type:"Buffer",data:[...]}` com milhares de números — peso morto, que o
 * FireHub não usa.
 */
function mensagemParaOWebhook(message) {
  let copia;
  try {
    copia = JSON.parse(JSON.stringify(message || {}));
  } catch {
    return {};
  }
  const limpar = (m, profundidade = 0) => {
    if (!m || typeof m !== "object" || profundidade > 5) return;
    for (const chave of ["locationMessage", "liveLocationMessage"]) {
      if (m[chave] && typeof m[chave] === "object") delete m[chave].jpegThumbnail;
    }
    for (const envelope of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"]) {
      if (m[envelope] && m[envelope].message) limpar(m[envelope].message, profundidade + 1);
    }
  };
  limpar(copia);
  return copia;
}

/**
 * Linha de log para a mensagem que chegou SEM conteúdo (não decifrou).
 *
 * O `if (!msg.message) continue` jogava isso fora sem rastro nenhum, e o
 * Baileys só registra em nível debug — que não é gravado. Na Divinos, a
 * mensagem de teste do dono ("No session record") só apareceu porque alguém
 * garimpou o log cru. Com o nome da instância e o motivo, "mandei e não
 * chegou" passa a ter resposta no log.
 */
function descreverMensagemSemConteudo(instanceName, msg) {
  const key = (msg && msg.key) || {};
  const tipo = msg && msg.messageStubType;
  const parametros = Array.isArray(msg && msg.messageStubParameters) ? msg.messageStubParameters.map(String).slice(0, 3) : [];
  const ehCifrada = tipo === STUB_CIPHERTEXT || tipo === "CIPHERTEXT";
  const quem = mascararJid(key.remoteJid) + (key.participant ? ` (de ${mascararJid(key.participant)})` : "");
  return {
    ehCifrada,
    linha:
      `[WhatsApp Gateway] 🔒 ${instanceName}: mensagem ${ehCifrada ? "que NÃO DECIFROU" : `sem conteúdo (stub ${tipo ?? "?"})`} ` +
      `de ${quem}${key.fromMe ? " [fromMe]" : ""}${parametros.length ? ` — ${parametros.join(" | ")}` : ""}. Não vai ao FireHub.`,
  };
}

// ── APARELHOS DA CONTA ─────────────────────────────────────────────────────

/**
 * De que aplicativo veio o pareamento (o `platform` do pair-success, que o
 * Baileys guarda em `creds.platform`).
 *
 * smba = WhatsApp Business Android; smbi = WhatsApp Business iPhone. As
 * outras são o WhatsApp comum — ou seja, provavelmente o celular PESSOAL de
 * alguém, não o número da loja. Desconhecida não gera aviso: melhor calar do
 * que acusar à toa.
 */
function classificarPlataforma(plataforma) {
  const p = String(plataforma || "").trim().toLowerCase();
  if (!p) return "desconhecida";
  if (p === "smba" || p === "smbi" || p.startsWith("smb")) return "business";
  if (["android", "iphone", "ipad", "ios", "kaios", "wearos", "iphone_os"].includes(p)) return "pessoal";
  return "desconhecida";
}

/** Quem da PRÓPRIA conta pediu retransmissão, em português — o diagnóstico muda conforme o aparelho. */
function descreverAparelhoDaPropriaConta(dispositivo) {
  if (dispositivo === ID_DO_APARELHO_HOSPEDADO) {
    return "APARELHO HOSPEDADO da conta (API oficial da Meta em coexistência — ex.: CardápioWeb). Não é o celular: religar o robô não cura; é preciso desligar essa integração";
  }
  if (dispositivo === 0) return "o CELULAR da própria loja — a cópia das conversas no aparelho dela está quebrada";
  if (dispositivo === null || dispositivo === undefined) return "um aparelho da própria loja";
  return `outro aparelho vinculado à própria loja (:${dispositivo}) — WhatsApp Web/Desktop ou outro sistema`;
}

/**
 * Os aparelhos da conta, a partir do resultado da consulta USync de
 * dispositivos (`result.list[0].devices.deviceList` = [{id, keyIndex, isHosted}]).
 */
function resumirAparelhos(deviceList) {
  const lista = Array.isArray(deviceList) ? deviceList : [];
  const ids = [];
  let hospedado = false;
  for (const d of lista) {
    const id = Number(d && d.id);
    if (!Number.isFinite(id)) continue;
    ids.push(id);
    if (id === ID_DO_APARELHO_HOSPEDADO || (d && d.isHosted === true)) hospedado = true;
  }
  return { total: ids.length, ids: ids.sort((a, b) => a - b), hospedado };
}

// ── O MONITOR ──────────────────────────────────────────────────────────────

const MOTIVO_DO_ALARME = (n, janelaMin) =>
  `${n} contatos diferentes não conseguiram ler as mensagens do robô na última ${janelaMin === 60 ? "hora" : `${janelaMin} min`} ` +
  `(pediram retransmissão). O WhatsApp da loja está "conectado", mas o que o robô manda chega como "Aguardando mensagem". ` +
  `Confira em Aparelhos conectados se há integração de outro sistema ou aparelho estranho, e religue o robô UMA vez.`;

const AVISO_HOSPEDADO =
  "Este número está ligado à API oficial do WhatsApp (aparelho hospedado — coexistência com outro sistema, ex.: CardápioWeb). " +
  "Enquanto essa integração existir, o robô do FireHub não consegue ler nem ser lido. Desligue a integração no sistema antigo e leia o QR de novo.";

const AVISO_PESSOAL = (plataforma) =>
  `O robô foi vinculado a um WhatsApp comum (${plataforma}), não ao WhatsApp Business da loja. ` +
  "Se este não é o celular da loja, desconecte e leia o QR com o WhatsApp Business do número da loja.";

/**
 * Estado por instância. `agora` é injetável para teste.
 *
 * Nada aqui fala com a rede: quem chama decide o que fazer quando
 * `registrarRetransmissao` avisa que o estado MUDOU (o server.js registra no
 * log e avisa o FireHub uma vez, não a cada pedido).
 */
function criarMonitorDoVinculo(opcoes = {}) {
  const janelaMs = opcoes.janelaMs || JANELA_DO_ALARME_MS;
  const limite = opcoes.limite || LIMITE_DE_CONTATOS;
  /** instancia → { externos: Map<contato, ultimoEm>, proprios: Map<dispositivo, {vezes, ultimoEm}>, aparelho, doente } */
  const porInstancia = new Map();

  const doInstancia = (instancia) => {
    let s = porInstancia.get(instancia);
    if (!s) {
      s = {
        externos: new Map(),
        proprios: new Map(),
        naoDecifradas: new Map(),
        aparelho: { plataforma: null, aparelhoId: null, aparelhos: null, hospedadoVistoEm: null },
        doente: false,
      };
      porInstancia.set(instancia, s);
    }
    return s;
  };

  const podar = (mapa, agora) => {
    for (const [chave, em] of mapa) {
      const quando = typeof em === "number" ? em : em && em.ultimoEm;
      if (!(agora - quando < janelaMs)) mapa.delete(chave);
    }
    // Teto de memória: o mapa só guarda uma hora, mas não pode crescer solto num ataque.
    while (mapa.size > 500) mapa.delete(mapa.keys().next().value);
  };

  function estado(instancia, agora = Date.now()) {
    const s = porInstancia.get(instancia);
    const vazio = {
      vinculoDoente: false,
      motivo: null,
      contatosQueNaoLeram: 0,
      pedidosDaPropriaConta: 0,
      mensagensQueNaoDecifraram: 0,
      plataforma: null,
      tipoDePlataforma: "desconhecida",
      aparelhoId: null,
      aparelhosDaConta: null,
      aparelhoHospedado: false,
      avisos: [],
    };
    if (!s) return vazio;
    podar(s.externos, agora);
    podar(s.proprios, agora);
    podar(s.naoDecifradas, agora);
    const contatos = s.externos.size;
    const doente = contatos > limite;
    const tipoDePlataforma = classificarPlataforma(s.aparelho.plataforma);
    const hospedado = Boolean(s.aparelho.hospedadoVistoEm) || Boolean(s.aparelho.aparelhos && s.aparelho.aparelhos.hospedado);
    const avisos = [];
    if (hospedado) avisos.push({ tipo: "aparelho-hospedado", mensagem: AVISO_HOSPEDADO });
    if (tipoDePlataforma === "pessoal") avisos.push({ tipo: "numero-pessoal", mensagem: AVISO_PESSOAL(s.aparelho.plataforma) });
    let pedidosProprios = 0;
    for (const v of s.proprios.values()) pedidosProprios += v.vezes;
    return {
      vinculoDoente: doente,
      motivo: doente ? MOTIVO_DO_ALARME(contatos, Math.round(janelaMs / 60000)) : null,
      contatosQueNaoLeram: contatos,
      pedidosDaPropriaConta: pedidosProprios,
      mensagensQueNaoDecifraram: s.naoDecifradas.size,
      plataforma: s.aparelho.plataforma,
      tipoDePlataforma,
      aparelhoId: s.aparelho.aparelhoId,
      aparelhosDaConta: s.aparelho.aparelhos ? { total: s.aparelho.aparelhos.total, ids: s.aparelho.aparelhos.ids } : null,
      aparelhoHospedado: hospedado,
      avisos,
    };
  }

  /**
   * Um pedido de retransmissão. `contato` = só dígitos de quem falhou;
   * `ehPropriaConta` = é um aparelho da própria loja; `dispositivo` = id do aparelho.
   *
   * Devolve `{ mudou, estado }`: `mudou` é true só quando o vínculo ENTRA ou
   * SAI do estado doente — é isso que merece log alto e aviso ao FireHub.
   */
  function registrarRetransmissao(instancia, { contato, ehPropriaConta, dispositivo }, agora = Date.now()) {
    const s = doInstancia(instancia);
    // "Antes" é o último estado ANUNCIADO, não o recalculado agora: a volta ao
    // sadio acontece com o tempo passando (a janela anda), e recalcular aqui
    // esconderia essa mudança de quem precisa avisar o FireHub.
    const antes = s.doente;
    const hospedadoAntes = Boolean(s.aparelho.hospedadoVistoEm) || Boolean(s.aparelho.aparelhos && s.aparelho.aparelhos.hospedado);
    if (ehPropriaConta) {
      const chave = dispositivo == null ? "?" : String(dispositivo);
      const anterior = s.proprios.get(chave);
      s.proprios.set(chave, { vezes: (anterior && agora - anterior.ultimoEm < janelaMs ? anterior.vezes : 0) + 1, ultimoEm: agora });
      if (dispositivo === ID_DO_APARELHO_HOSPEDADO) s.aparelho.hospedadoVistoEm = agora;
    } else if (contato) {
      // Por CONTATO, não por pedido: um cliente com o celular velho pedindo dez
      // vezes é um problema dele; dez clientes diferentes é o vínculo da loja.
      s.externos.set(String(contato), agora);
    }
    const depois = estado(instancia, agora);
    s.doente = depois.vinculoDoente;
    // Descobrir o aparelho hospedado pelo pedido do :99 também é notícia: é a
    // causa que religar não cura, e o dono precisa saber uma vez.
    const achouHospedado = !hospedadoAntes && depois.aparelhoHospedado;
    return { mudou: antes !== depois.vinculoDoente || achouHospedado, achouHospedado, estado: depois };
  }

  /**
   * Varredura periódica: as instâncias cujo estado mudou desde o último
   * anúncio — em geral, as que SARARAM porque a janela de uma hora passou sem
   * pedido novo. Sem isto, o FireHub ficaria com "vínculo doente" aceso até o
   * próximo pedido de retransmissão, que numa loja sadia pode nunca vir.
   */
  function varrer(agora = Date.now()) {
    const mudaram = [];
    for (const [instancia, s] of porInstancia) {
      const atual = estado(instancia, agora);
      if (atual.vinculoDoente !== s.doente) {
        s.doente = atual.vinculoDoente;
        mudaram.push({ instancia, estado: atual });
      }
    }
    return mudaram;
  }

  /** Mensagem RECEBIDA que não decifrou (stub CIPHERTEXT). Só informação: o Baileys costuma recuperar no reenvio. */
  function registrarMensagemQueNaoDecifrou(instancia, { contato, ehPropriaConta }, agora = Date.now()) {
    if (ehPropriaConta || !contato) return;
    doInstancia(instancia).naoDecifradas.set(String(contato), agora);
  }

  /** O que se sabe do aparelho do robô e da conta, ao conectar. */
  function registrarAparelho(instancia, { plataforma, aparelhoId, deviceList } = {}) {
    const s = doInstancia(instancia);
    if (plataforma !== undefined) s.aparelho.plataforma = plataforma ? String(plataforma) : null;
    if (aparelhoId !== undefined) s.aparelho.aparelhoId = Number.isFinite(Number(aparelhoId)) && aparelhoId !== null ? Number(aparelhoId) : null;
    if (deviceList !== undefined) s.aparelho.aparelhos = resumirAparelhos(deviceList);
    return estado(instancia);
  }

  /** Logout/reset: o próximo vínculo começa do zero. */
  function esquecer(instancia) {
    porInstancia.delete(instancia);
  }

  function instancias() {
    return [...porInstancia.keys()];
  }

  return { registrarRetransmissao, registrarMensagemQueNaoDecifrou, registrarAparelho, estado, varrer, esquecer, instancias };
}

module.exports = {
  JANELA_DO_ALARME_MS,
  LIMITE_DE_CONTATOS,
  ID_DO_APARELHO_HOSPEDADO,
  STUB_CIPHERTEXT,
  decodificarJid,
  mascararJid,
  conversaVaiParaOWebhook,
  desembrulharMensagem,
  localizacaoDaMensagem,
  mensagemParaOWebhook,
  descreverMensagemSemConteudo,
  classificarPlataforma,
  descreverAparelhoDaPropriaConta,
  resumirAparelhos,
  criarMonitorDoVinculo,
};
