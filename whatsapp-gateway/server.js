const express = require("express");
const cors = require("cors");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const sessions = new Map();
const replyCooldowns = new Map();
const sessionLocks = new Map();
const reconnectCounters = new Map();

// ── A CURA DO "AGUARDANDO MENSAGEM" ─────────────────────────────────────────
//
// Quando o aparelho do destinatário não consegue decifrar uma mensagem (sessão
// de criptografia dessincronizada), o WhatsApp mostra "Aguardando mensagem.
// Essa ação pode levar alguns instantes." e pede a RETRANSMISSÃO ao remetente.
// O Baileys atende esse pedido chamando `getMessage(key)` para reenviar o
// conteúdo com uma sessão nova. O socket daqui respondia `undefined` — ou
// seja: a retransmissão NUNCA acontecia e a mensagem ficava presa PARA SEMPRE.
// Era exatamente o que o dono e os motoboys viam nas conversas em que o robô
// só envia (aviso de pedido, rota): sessão apodrecia e nada mais chegava.
//
// Este cache guarda as últimas mensagens ENVIADAS para o retry funcionar.
// Pequeno de propósito (o processo vive brigando com o teto de memória): o
// pedido de retransmissão chega segundos após o envio, não horas.
// A chave é `<instância>|<id>`, nunca o id sozinho: duas lojas atendidas pelo
// mesmo processo podiam colidir, e devolver a mensagem da loja B para o socket
// da loja A cifra conteúdo alheio com as chaves erradas.
//
// E o cache MORA EM DISCO. Ele já foi só de memória, e o processo morre com
// frequência (watchdog de memória, deploy): todo pedido de retransmissão que
// chegasse depois de uma morte encontrava o cache vazio, e aquele balão ficava
// preso para sempre. O WhatsApp insiste por cerca de uma hora — muito mais do
// que o intervalo entre dois reinícios num dia ruim.
const mensagensEnviadas = new Map();
const TETO_DO_CACHE_DE_ENVIO = 800;
const VALIDADE_DO_CACHE_MS = 2 * 60 * 60 * 1000;
const ARQUIVO_DAS_ENVIADAS = path.join(__dirname, "data", "enviadas.json");
let enviadasSujas = false;

/**
 * Esta mensagem sobrevive a uma ida e volta por JSON sem mudar de forma?
 *
 * Mensagem de mídia carrega `Buffer`/`Uint8Array` (mediaKey, fileSha256) e
 * `Long` do protobuf (fileLength). Nenhum dos três volta do JSON como o que era:
 * o Buffer vira `{type:"Buffer",data:[...]}`, o Long vira `{low,high,unsigned}`.
 * Reenviar isso é pior do que não reenviar — sai um envelope malformado.
 *
 * Então o disco guarda só o que é seguro: texto. Que é justamente o que o robô
 * manda para motoboy e para o dono. Mídia continua valendo em memória, como
 * antes — sem regressão, e sem risco novo.
 */
function ehPersistivel(valor, profundidade = 0) {
  if (profundidade > 12) return false;
  if (valor === null || valor === undefined) return true;
  const tipo = typeof valor;
  if (tipo === "string" || tipo === "number" || tipo === "boolean") return true;
  if (tipo !== "object") return false;
  if (Buffer.isBuffer(valor) || ArrayBuffer.isView(valor) || valor instanceof ArrayBuffer) return false;
  // Long do protobufjs: int64 partido em duas metades.
  if ("low" in valor && "high" in valor && "unsigned" in valor) return false;
  if (Array.isArray(valor)) return valor.every((v) => ehPersistivel(v, profundidade + 1));
  return Object.values(valor).every((v) => ehPersistivel(v, profundidade + 1));
}

function lembrarEnviada(instanceName, resultado) {
  const id = resultado?.key?.id;
  if (!id || !resultado?.message) return;
  const persistivel = ehPersistivel(resultado.message);
  mensagensEnviadas.set(`${instanceName}|${id}`, { message: resultado.message, em: Date.now(), persistivel });
  if (persistivel) enviadasSujas = true;
  if (mensagensEnviadas.size > TETO_DO_CACHE_DE_ENVIO) {
    // Map preserva ordem de inserção: o primeiro é o mais antigo.
    const maisAntigo = mensagensEnviadas.keys().next().value;
    mensagensEnviadas.delete(maisAntigo);
  }
}

function recuperarEnviada(instanceName, id) {
  const registro = mensagensEnviadas.get(`${instanceName}|${id}`);
  if (!registro) return undefined;
  if (Date.now() - registro.em > VALIDADE_DO_CACHE_MS) {
    mensagensEnviadas.delete(`${instanceName}|${id}`);
    return undefined;
  }
  return registro.message;
}

function carregarEnviadas() {
  try {
    const cru = JSON.parse(fs.readFileSync(ARQUIVO_DAS_ENVIADAS, "utf8"));
    const limite = Date.now() - VALIDADE_DO_CACHE_MS;
    for (const [chave, registro] of Object.entries(cru || {})) {
      if (registro?.em > limite) mensagensEnviadas.set(chave, registro);
    }
    console.log(`[WhatsApp Gateway] 📬 ${mensagensEnviadas.size} mensagem(ns) recuperada(s) do disco para retransmissão`);
  } catch {
    // Primeira execução, ou arquivo ainda não existe.
  }
}

function salvarEnviadas() {
  if (!enviadasSujas) return;
  enviadasSujas = false;
  try {
    const limite = Date.now() - VALIDADE_DO_CACHE_MS;
    const vivas = {};
    for (const [chave, registro] of mensagensEnviadas) {
      if (registro.persistivel && registro.em > limite) vivas[chave] = registro;
    }
    fs.mkdirSync(path.dirname(ARQUIVO_DAS_ENVIADAS), { recursive: true });
    fs.writeFileSync(`${ARQUIVO_DAS_ENVIADAS}.tmp`, JSON.stringify(vivas));
    fs.renameSync(`${ARQUIVO_DAS_ENVIADAS}.tmp`, ARQUIVO_DAS_ENVIADAS);
  } catch (err) {
    console.warn("[WhatsApp Gateway] Aviso ao gravar cache de enviadas:", err.message);
  }
}

// ── POR QUE A "AUTOCURA" FOI REMOVIDA ───────────────────────────────────────
//
// Aqui existia uma rotina que, ao segundo pedido de retransmissão, APAGAVA o
// arquivo de sessão do contato para forçar uma negociação nova. A ideia parecia
// certa e o efeito era o oposto. Duas leituras do Baileys 6.7.23 explicam:
//
// 1. O BAILEYS JÁ SE CURA SOZINHO, e antes de nós.
//    Em `Socket/messages-recv.js`, `sendMessagesAgain` chama
//    `await assertSessions([participant], true)` — com `force = true`,
//    INCONDICIONAL, a cada pedido de retransmissão. Em `messages-send.js` o
//    `force` faz `jidsRequiringFetch = jids`: busca pre-keys novas no servidor e
//    injeta uma sessão E2E do zero. O conserto acontece ali, sempre, mesmo
//    quando o nosso `getMessage` devolve `undefined`.
//
// 2. O QUE FAZÍAMOS ERA DESFAZER ESSE CONSERTO, 5 SEGUNDOS DEPOIS.
//    O `setTimeout(..., 5000)` apagava exatamente o `session-*.json` que o
//    `assertSessions` acabara de construir. O envio seguinte abria OUTRA sessão
//    (novo `pkmsg`), o aparelho do destinatário descartava a que tinha acabado
//    de estabelecer, e tudo que estava em voo cifrado sob a anterior ficava
//    órfão PARA SEMPRE — mais um balão "Aguardando mensagem". Como o contador
//    era zerado logo depois, o par entrava em laço: conta até 2, apaga, zera,
//    recomeça. O comentário antigo descrevia esse laço
//    ("retransmissão 1 → 2 → descartada → 1 → 2 → descartada") e o atribuía ao
//    LID. Não era o LID. Era esta função.
//
// 3. E AINDA MIRAVA O CONTATO ERRADO.
//    Quem falhou em decifrar é `key.participant`, não `key.remoteJid`
//    (`messages-recv.js`: `key.participant = key.participant || attrs.from`).
//    Quando o pedido vem de um aparelho da NOSSA PRÓPRIA conta, `isNodeFromMe`
//    é verdadeiro e o `remoteJid` passa a ser `attrs.recipient` — o CLIENTE.
//    Ou seja: o celular do dono não conseguia decifrar, e nós apagávamos a
//    sessão saudável do cliente. O log imprimia "1 arquivo(s)" e cantava
//    vitória enquanto espalhava o defeito para quem estava bem.
//
// Sobrou telemetria. Ela agora diz QUEM pediu retransmissão e se esse quem é a
// própria loja — que é a pergunta que faltava para entender o sintoma.
const pedidosDeRetransmissao = new Map();
const JANELA_DE_RETRANSMISSAO_MS = 10 * 60 * 1000;

function pastaDaSessao(instanceName) {
  return path.join(__dirname, "data", "sessions", instanceName);
}

/**
 * As identidades da conta pareada nesta instância — telefone E LID.
 *
 * Os DOIS importam, e descobrir isso custou caro. O log de produção mostrou a
 * sessão com o próprio aparelho endereçada pelo **LID**:
 *
 *   failed to decrypt message key={"remoteJid":"...@lid","fromMe":true}
 *   err={"type":"MessageCounterError","message":"Key used already or never filled"}
 *     at 131366423384261.0 [as awaitable]
 *
 * `131366423384261` é o LID da loja, não o telefone dela. Ou seja: o arquivo é
 * `session-131366423384261.0.json`, e uma proteção que olhasse só o telefone
 * (`session-5522992026732.*`) deixaria o mutirão apagar justamente a sessão que
 * ela deveria proteger.
 */
function identidadesDaPropriaConta(instanceName) {
  const user = sessions.get(instanceName)?.sock?.user || {};
  const soDigitos = (v) => String(v || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  return [soDigitos(user.id), soDigitos(user.lid)].filter(Boolean);
}

/** É a própria conta desta instância (por telefone ou por LID)? */
function ehAPropriaConta(instanceName, numero) {
  return Boolean(numero) && identidadesDaPropriaConta(instanceName).includes(numero);
}

/**
 * Apaga os arquivos de sessão Signal de UM contato (todos os aparelhos dele).
 * O Baileys grava como "session-<numero>.<device>.json".
 *
 * DUAS PROTEÇÕES que faltavam:
 *
 * - Nunca apaga a sessão da PRÓPRIA CONTA. Toda mensagem 1:1 que o robô manda é
 *   cifrada também para os aparelhos da loja (`messages-send.js` empilha
 *   `devices.push({ user: meUser })`), para o dono ver no celular dele. Apagar
 *   essa sessão quebra de uma vez a cópia de TODAS as conversas — é o caminho
 *   mais curto para "muitas mensagens chegando para nós como Aguardando".
 *
 * - Casa o nome do arquivo por prefixo exato (`session-<numero>.`), não por
 *   `includes(numero)`. O `includes` pegava qualquer arquivo que contivesse
 *   aqueles dígitos em qualquer posição.
 */
function apagarSessaoDoContato(instanceName, jid) {
  const numero = String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");
  if (!numero) return 0;

  if (ehAPropriaConta(instanceName, numero)) {
    console.warn(`[WhatsApp Gateway] 🛡️ Recusado: ${jid} é a própria conta de ${instanceName}. Apagar essa sessão quebraria a cópia de todas as conversas no celular da loja.`);
    return 0;
  }

  let apagados = 0;
  try {
    for (const arquivo of fs.readdirSync(pastaDaSessao(instanceName))) {
      if (!arquivo.startsWith(`session-${numero}.`)) continue;
      fs.rmSync(path.join(pastaDaSessao(instanceName), arquivo), { force: true });
      apagados++;
    }
  } catch (err) {
    console.warn(`[WhatsApp Gateway] Aviso ao apagar sessão de ${jid}:`, err.message);
  }
  return apagados;
}

// ── LID → TELEFONE ──────────────────────────────────────────────────────────
//
// O WhatsApp está migrando os contatos para LID (um id interno, "220104...@lid")
// no lugar do JID de telefone. Mensagem cifrada para o endereço @lid chega no
// aparelho e NÃO decifra: vira "Aguardando mensagem" para sempre. E não adianta
// renegociar a sessão — a autocura acima descartava, o envio seguinte falhava
// igual, e o ciclo recomeçava (foi exatamente o que apareceu no log:
// retransmissão 1 → 2 → descartada → 1 → 2 → descartada).
//
// A cura é endereçar pelo TELEFONE. O Baileys mantém o mapa LID↔telefone das
// conversas que já viu; a chamada é opcional porque a API mudou de lugar entre
// versões — se não existir, devolvemos o JID original e nada piora.
// Mapa LID→telefone que NÓS montamos, porque o Baileys desta versão não expõe
// nenhum. Ele se enche sozinho: todo envio para um telefone pergunta ao
// WhatsApp qual é o LID daquele número e guarda o caminho de volta. Como o
// robô manda confirmação de pedido, rota de motoboy e aviso para o dono, os
// contatos que importam entram no mapa pelo uso normal.
const lidParaTelefone = new Map();
const TETO_DO_MAPA_DE_LID = 5000;

// O mapa MORA EM DISCO, no mesmo volume das sessões.
//
// Ele já existiu só em memória e a consequência apareceu na hora: um deploy do
// gateway zerava tudo, e as conversas voltavam a receber "Aguardando mensagem"
// como se nada tivesse sido consertado. Reinício de processo não pode desfazer
// aprendizado.
const ARQUIVO_DO_MAPA = path.join(__dirname, "data", "lid-map.json");
let mapaSujo = false;

function carregarMapaDeLid() {
  try {
    const cru = JSON.parse(fs.readFileSync(ARQUIVO_DO_MAPA, "utf8"));
    for (const [lid, tel] of Object.entries(cru || {})) {
      lidParaTelefone.set(lid, tel);
      const digitos = String(tel).split("@")[0].split(":")[0].replace(/\D/g, "");
      if (digitos) telefoneParaLid.set(digitos, lid);
    }
    console.log(`[WhatsApp Gateway] 🔗 Mapa de LID carregado do disco: ${lidParaTelefone.size} contato(s)`);
  } catch {
    // Primeira execução, ou arquivo ainda não existe. Segue com mapa vazio.
  }
}

function salvarMapaDeLid() {
  if (!mapaSujo) return;
  mapaSujo = false;
  try {
    fs.mkdirSync(path.dirname(ARQUIVO_DO_MAPA), { recursive: true });
    fs.writeFileSync(ARQUIVO_DO_MAPA, JSON.stringify(Object.fromEntries(lidParaTelefone)));
  } catch (err) {
    console.warn("[WhatsApp Gateway] Aviso ao gravar mapa de LID:", err.message);
  }
}

// O caminho de VOLTA: telefone (só dígitos) → LID. É ele que passou a decidir o
// endereço de envio; ver `resolverDestino`.
const telefoneParaLid = new Map();

function lembrarLid(lid, telefoneJid) {
  if (!lid || !telefoneJid) return;
  const chave = String(lid);
  const valor = String(telefoneJid);
  const digitos = valor.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (digitos) telefoneParaLid.set(digitos, chave);
  if (lidParaTelefone.get(chave) === valor) return;
  lidParaTelefone.set(chave, valor);
  if (lidParaTelefone.size > TETO_DO_MAPA_DE_LID) {
    const maisAntigo = lidParaTelefone.keys().next().value;
    const telAntigo = String(lidParaTelefone.get(maisAntigo) || "").split("@")[0].replace(/\D/g, "");
    lidParaTelefone.delete(maisAntigo);
    if (telAntigo && telefoneParaLid.get(telAntigo) === maisAntigo) telefoneParaLid.delete(telAntigo);
  }
  mapaSujo = true;
}

carregarMapaDeLid();
carregarEnviadas();
// Gravação agrupada: os mapas mudam a cada mensagem e escrever a cada uma seria
// desperdício. Nada se perde por 10s de atraso, e o encerramento também salva.
setInterval(() => { salvarMapaDeLid(); salvarEnviadas(); }, 10_000).unref?.();

// ── ENCERRAMENTO DRENADO ────────────────────────────────────────────────────
//
// Antes daqui saía um `process.exit()` seco. O problema é onde a morte cai: no
// Baileys 6.7.23 o `relayMessage` inteiro roda dentro de
// `authState.keys.transaction(...)` e o `sendNode(stanza)` é a ÚLTIMA instrução
// de dentro dela — o texto cifrado já foi para o fio enquanto o novo estado do
// ratchet ainda só existe em memória, esperando o commit da transação gravar em
// disco. Morrer nessa janela deixa a nossa cadeia de envio um passo atrás do que
// o aparelho do destinatário já consumiu, e passo de ratchet reusado é
// indecifrável por definição: vira "Aguardando mensagem".
//
// Drenar custa 2 segundos e fecha essa janela.
let encerrando = false;
function encerrar(codigo, motivo) {
  if (encerrando) return;
  encerrando = true;
  console.log(`[WhatsApp Gateway] 🛑 Encerrando (${motivo}). Drenando...`);
  for (const [nome, s] of sessions.entries()) {
    try { s.sock?.end(); } catch { /* já morto */ }
    console.log(`[WhatsApp Gateway] 🛑 Socket de ${nome} encerrado`);
  }
  salvarMapaDeLid();
  salvarEnviadas();
  // Dá tempo para o commit da transação de chaves que possa estar em voo pousar
  // no disco antes de o processo sumir.
  setTimeout(() => process.exit(codigo), 2000);
}
for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => encerrar(0, sinal));
}

/** Aceita "5522...@s.whatsapp.net" ou só dígitos; devolve o JID de telefone ou "". */
function normalizarParaJidDeTelefone(bruto) {
  const texto = String(bruto || "");
  if (!texto || texto.includes("@lid")) return "";
  const digitos = texto.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 15) return "";
  return `${digitos}@s.whatsapp.net`;
}

// Já perguntamos por este número? Consulta de existência de contato (USync) é
// padrão de enumeração e vetor conhecido de throttle em cliente não oficial —
// e antes daqui saía UMA por mensagem enviada, para sempre, mesmo para o mesmo
// motoboy recebendo a décima rota do dia.
const telefonesJaConsultados = new Set();

/** Pergunta ao WhatsApp o LID de um telefone e guarda o caminho de volta. */
async function aprenderLidDoTelefone(sock, telefoneJid) {
  const numero = String(telefoneJid || "").split("@")[0].replace(/\D/g, "");
  if (!numero) return;
  // Já sabemos o caminho de volta: não gastar outra consulta.
  if (telefoneParaLid.has(numero)) return telefoneParaLid.get(numero);
  if (telefonesJaConsultados.has(numero)) return;
  try {
    const [info] = (await sock.onWhatsApp(numero)) || [];
    // Marcar como consultado só DEPOIS de a consulta completar. Marcar antes fazia
    // uma falha de rede calar o número para sempre nesta instância do processo.
    telefonesJaConsultados.add(numero);
    if (telefonesJaConsultados.size > 5000) {
      telefonesJaConsultados.delete(telefonesJaConsultados.values().next().value);
    }
    if (info?.lid) {
      lembrarLid(info.lid, `${numero}@s.whatsapp.net`);
      return String(info.lid);
    }
  } catch (err) {
    console.warn(`[WhatsApp Gateway] Aviso ao consultar LID de ${numero}:`, err.message);
  }
}

// ── PARA ONDE ENDEREÇAR ─────────────────────────────────────────────────────
//
// Ligado, o gateway endereça pelo **LID** sempre que conhece um. Desligue com
// ENDERECAR_POR_LID=false para voltar ao comportamento antigo, sem deploy.
//
// POR QUE INVERTEU. O gateway convertia todo `@lid` em telefone (commit 9378c8b)
// e o app fazia o mesmo. Só que em `Socket/messages-send.js` do Baileys 6.7.23:
//
//   const isLid = server === 'lid';                          // linha 261, vem do DESTINO
//   const { user, device } = jidDecode(participant.jid);     // linha 285, o LID de quem pediu retry
//   const jid = jidEncode(user, isLid ? 'lid' : 's.whatsapp.net', device);   // linha 412
//
// Com o destino forçado para telefone, `isLid` é false, e a retransmissão sai
// endereçada a `<númeroLID>@s.whatsapp.net` — número de LID sob o servidor de
// telefone, endereço que não existe. Ela some no caminho, o aparelho pede de
// novo, e o contador só sobe: foi medido um contato em `vezes: 10`.
//
// Confirmado empiricamente em 28/08/2026: a MESMA mensagem enviada ao mesmo
// aparelho chegou legível pelo LID e não chegou pelo telefone.
//
// A queda para telefone continua existindo para quem não tem LID conhecido —
// contato que o WhatsApp ainda não migrou continua funcionando como antes.
const ENDERECAR_POR_LID = process.env.ENDERECAR_POR_LID !== "false";

async function resolverDestino(sock, jidBruto) {
  const texto = String(jidBruto || "");
  if (!ENDERECAR_POR_LID) return resolverParaTelefone(sock, texto);

  // Já veio endereçado por LID: é o endereço certo, não mexer.
  if (texto.endsWith("@lid")) return texto;

  const digitos = texto.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (!digitos) return texto;

  const lid = telefoneParaLid.get(digitos) || (await aprenderLidDoTelefone(sock, `${digitos}@s.whatsapp.net`));
  if (lid) {
    const enderecoLid = String(lid).includes("@") ? String(lid) : `${lid}@lid`;
    console.log(`[WhatsApp Gateway] 🎯 ${digitos} → ${enderecoLid} (endereçando por LID)`);
    return enderecoLid;
  }

  console.log(`[WhatsApp Gateway] 🎯 ${digitos}: sem LID conhecido, enviando por telefone`);
  return texto;
}

async function resolverParaTelefone(sock, jid) {
  const texto = String(jid || "");
  if (!texto.endsWith("@lid")) return texto;

  const aprendido = lidParaTelefone.get(texto);
  if (aprendido) {
    console.log(`[WhatsApp Gateway] 🔗 LID ${texto} → ${aprendido} (mapa próprio)`);
    return aprendido;
  }

  try {
    const mapa = sock?.signalRepository?.lidMapping;
    const candidatos = [
      mapa?.getPNForLID?.bind(mapa),
      mapa?.getPNFromLID?.bind(mapa),
    ].filter(Boolean);

    for (const resolver of candidatos) {
      const pn = await resolver(texto);
      const achado = String(pn || "");
      if (achado.includes("@s.whatsapp.net")) {
        console.log(`[WhatsApp Gateway] 🔗 LID ${texto} resolvido para ${achado}`);
        return achado;
      }
      if (/^\d{10,15}$/.test(achado)) {
        const comSufixo = `${achado}@s.whatsapp.net`;
        console.log(`[WhatsApp Gateway] 🔗 LID ${texto} resolvido para ${comSufixo}`);
        return comSufixo;
      }
    }
  } catch (err) {
    console.warn(`[WhatsApp Gateway] Aviso ao resolver LID ${texto}:`, err.message);
  }

  console.warn(`[WhatsApp Gateway] ⚠️ LID ${texto} sem telefone conhecido; enviando para o próprio LID (pode não decifrar).`);
  return texto;
}

/**
 * Telemetria de quem não conseguiu decifrar. NÃO apaga nada — ver o bloco
 * "POR QUE A AUTOCURA FOI REMOVIDA" no topo do arquivo.
 *
 * O alvo certo é `key.participant`: é ele que o Baileys preenche com quem pediu
 * a retransmissão. O `remoteJid` é a CONVERSA, e num pedido vindo de aparelho da
 * própria conta ele aponta para o cliente — o inocente.
 */
function registrarPedidoDeRetransmissao(instanceName, key) {
  const conversa = String(key?.remoteJid || "");
  const quemFalhou = String(key?.participant || key?.remoteJid || "");
  if (!quemFalhou || conversa.endsWith("@g.us")) return;

  const numero = quemFalhou.split("@")[0].split(":")[0].replace(/\D/g, "");
  const ehAPropriaLoja = ehAPropriaConta(instanceName, numero);

  // Contador por INSTÂNCIA + contato. Antes era só o jid: o dono, que fala com
  // várias lojas, somava no mesmo balde os pedidos de instâncias diferentes.
  const chave = `${instanceName}|${quemFalhou}`;
  const agora = Date.now();
  const anterior = pedidosDeRetransmissao.get(chave);
  const dentroDaJanela = anterior && agora - anterior.ultimoEm < JANELA_DE_RETRANSMISSAO_MS;
  const vezes = dentroDaJanela ? anterior.vezes + 1 : 1;
  pedidosDeRetransmissao.set(chave, { vezes, ultimoEm: agora });

  console.warn(
    `[WhatsApp Gateway] 🔁 ${instanceName}: ${quemFalhou} não decifrou (pedido nº ${vezes})` +
    (ehAPropriaLoja ? " ⚠️ É O APARELHO DA PRÓPRIA LOJA — a cópia de todas as conversas está quebrada" : "") +
    (conversa && conversa !== quemFalhou ? ` [conversa: ${conversa}]` : "") +
    ". O Baileys renegocia a sessão sozinho; o gateway não apaga mais nada.",
  );

  // Trava de memória: o Map só cresce com contato problemático, mas não fica solto.
  if (pedidosDeRetransmissao.size > 200) {
    pedidosDeRetransmissao.delete(pedidosDeRetransmissao.keys().next().value);
  }
}

// Limpar sessões corrompidas ao iniciar
const CLEAN_ON_BOOT = process.env.CLEAN_SESSIONS === "true";
if (CLEAN_ON_BOOT) {
  const sessionsDir = path.join(__dirname, "data", "sessions");
  try { fs.rmSync(sessionsDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(sessionsDir, { recursive: true });
  console.log("[WhatsApp Gateway] 🗑️ Sessões limpas no boot (CLEAN_SESSIONS=true)");
}

// Monitoramento de memória - previne OOM + limpeza de cooldowns + auto-restart
// O watchdog matava o processo à primeira leitura acima de 420MB, com o V8
// configurado para 450MB — ou seja, disparava a 93% do teto que ele mesmo pediu,
// que é faixa NORMAL de operação, e antes de tentar um GC. Cada morte dessas cai
// na janela descrita em `encerrar()`. Agora: GC primeiro, duas leituras seguidas
// para confirmar, e saída drenada.
const TETO_DE_HEAP_MB = Number(process.env.HEAP_CRITICO_MB || 420);
let leiturasCriticas = 0;
setInterval(() => {
  const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

  if (heapMB > TETO_DE_HEAP_MB) {
    // Tentar recuperar ANTES de condenar: heapUsed conta lixo ainda não coletado.
    if (global.gc) { try { global.gc(); } catch { /* sem --expose-gc */ } }
    const depoisDoGC = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    if (depoisDoGC <= TETO_DE_HEAP_MB) {
      console.warn(`[WhatsApp Gateway] ♻️ Heap ${heapMB}MB → ${depoisDoGC}MB após GC. Falso alarme.`);
      leiturasCriticas = 0;
      return;
    }
    leiturasCriticas++;
    console.error(`[WhatsApp Gateway] 🔴 Memória CRÍTICA: heap=${depoisDoGC}MB rss=${rssMB}MB (leitura ${leiturasCriticas}/2)`);
    if (leiturasCriticas >= 2) encerrar(1, `memória crítica ${depoisDoGC}MB`);
    return;
  }
  leiturasCriticas = 0;

  if (heapMB > TETO_DE_HEAP_MB - 70) {
    console.warn(`[WhatsApp Gateway] ⚠️ Memória alta: heap=${heapMB}MB rss=${rssMB}MB - forçando GC`);
    if (global.gc) { try { global.gc(); } catch { /* sem --expose-gc */ } }
  }
  // Fix 2: Limpar replyCooldowns antigos para evitar memory leak
  const now = Date.now();
  for (const [key, ts] of replyCooldowns.entries()) {
    if (now - ts > 10000) replyCooldowns.delete(key);
  }
  // NÃO limpar sessionLocks aqui. Havia um "limpador de locks órfãos" que
  // apagava a trava de toda instância ausente de `sessions` — inclusive a de uma
  // criação EM ANDAMENTO, porque `getOrCreateSocket` trava antes de registrar a
  // sessão e há dois `await` no meio. Era uma porta aberta para dois sockets
  // Baileys vivos sobre a MESMA pasta de autenticação, cada um avançando o
  // ratchet por cima do outro. A trava agora é liberada por quem a pegou, no
  // `finally`.
}, 15000);

// Self-ping: mantém o processo ativo a cada 4 min (evita sleep em qualquer hosting)
setInterval(() => {
  const url = `http://localhost:${PORT}/`;
  fetch(url).catch(() => {});
  console.log(`[WhatsApp Gateway] 💓 Self-ping (uptime: ${Math.round(process.uptime())}s, sessões: ${sessions.size})`);
}, 4 * 60 * 1000);

// Fix 1: GC periódico global (único, nunca duplica em reconexões)
if (global.gc) {
  setInterval(() => { try { global.gc(); } catch(e) {} }, 30000);
}

// Fix 3: Auto-health-check - reconecta sessões mortas a cada 5 minutos
// Garante que o bot continue ativo na madrugada mesmo sem tráfego externo
setInterval(() => {
  for (const [name, session] of sessions.entries()) {
    if (session.state !== "open" && session.state !== "connecting") {
      console.log(`[WhatsApp Gateway] 🩺 Health-check: sessão "${name}" está ${session.state}. Reconectando...`);
      getOrCreateSocket(name).catch((err) => {
        console.warn(`[WhatsApp Gateway] ⚠️ Health-check reconexão falhou para ${name}:`, err.message);
      });
    }
  }
  // Também reconectar sessões salvas em disco que não estão no Map
  const sessionsDir = path.join(__dirname, "data", "sessions");
  if (fs.existsSync(sessionsDir)) {
    try {
      const folders = fs.readdirSync(sessionsDir).filter(f => {
        try { return fs.statSync(path.join(sessionsDir, f)).isDirectory(); } catch { return false; }
      });
      for (const folder of folders) {
        if (!sessions.has(folder)) {
          console.log(`[WhatsApp Gateway] 🩺 Health-check: sessão salva "${folder}" não está no Map. Reconectando...`);
          getOrCreateSocket(folder).catch((err) => {
            console.warn(`[WhatsApp Gateway] ⚠️ Health-check reconexão falhou para ${folder}:`, err.message);
          });
        }
      }
    } catch (e) {}
  }
}, 5 * 60 * 1000);

process.on("uncaughtException", (err) => {
  console.warn("[WhatsApp Gateway] Aviso uncaughtException ignorado:", err.message || err);
});
process.on("unhandledRejection", (err) => {
  console.warn("[WhatsApp Gateway] Aviso unhandledRejection ignorado:", err.message || err);
});

/**
 * Uma criação de socket por instância, e ponto.
 *
 * A trava era um booleano liberado LOGO APÓS `sessions.set`, e havia um
 * faxineiro de 15 em 15 segundos que a apagava por conta própria. Entre pegar a
 * trava e registrar a sessão existem dois `await` (`useMultiFileAuthState` e
 * `fetchLatestBaileysVersion`), e nessa janela a instância não está em
 * `sessions` — o que fazia o faxineiro concluir que a trava estava órfã e
 * removê-la. Com a trava fora, uma segunda chamada entrava e criava OUTRO socket
 * sobre a MESMA pasta de autenticação.
 *
 * Dois sockets Baileys na mesma pasta é a pior coisa que pode acontecer aqui:
 * cada um avança o ratchet Signal e grava por cima do outro, e o que sai no fio
 * fica cifrado com estado que o destinatário nunca vai conseguir seguir.
 *
 * Agora a trava é a PRÓPRIA PROMESSA da criação: quem chega no meio espera o
 * mesmo socket em vez de abrir um segundo, e ela só é liberada no `finally`.
 */
async function getOrCreateSocket(instanceName) {
  const emAndamento = sessionLocks.get(instanceName);
  if (emAndamento) return emAndamento;

  const atual = sessions.get(instanceName);
  if (atual?.sock && (atual.state === "open" || atual.state === "connecting")) return atual;

  const promessa = criarSocket(instanceName).finally(() => sessionLocks.delete(instanceName));
  sessionLocks.set(instanceName, promessa);
  return promessa;
}

async function criarSocket(instanceName) {
  let session = sessions.get(instanceName);

  // Clean up previous socket if exists
  if (session && session.sock) {
    try { session.sock.end(); } catch(e) {}
  }

  const authFolder = path.join(__dirname, "data", "sessions", instanceName);
  fs.mkdirSync(authFolder, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    browser: ["FireHub Food", "Chrome", "1.0.0"],
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    // NUNCA voltar para `async () => undefined`: sem isto, o pedido de
    // retransmissão do WhatsApp fica sem resposta e o destinatário vê
    // "Aguardando mensagem" para sempre. Ver o cache no topo do arquivo.
    getMessage: async (key) => {
      // Ser chamado aqui É a prova de que o destinatário não decifrou.
      registrarPedidoDeRetransmissao(instanceName, key);
      return recuperarEnviada(instanceName, key?.id);
    },
    cachedGroupMetadata: async () => undefined,
    fireInitQueries: false,
  });

  session = { sock, state: "connecting", qrBase64: null, phone: null };
  sessions.set(instanceName, session);

  // Ignorar eventos pesados que consomem memória
  sock.ev.on("messaging-history.set", () => {
    // Ignora sync de histórico completamente
  });
  sock.ev.on("chats.upsert", () => {});
  sock.ev.on("chats.update", () => {});
  sock.ev.on("chats.delete", () => {});
  sock.ev.on("contacts.upsert", () => {});
  sock.ev.on("contacts.update", () => {});
  sock.ev.on("groups.upsert", () => {});
  sock.ev.on("groups.update", () => {});
  sock.ev.on("presence.update", () => {});
  sock.ev.on("blocklist.set", () => {});
  sock.ev.on("blocklist.update", () => {});

  // Fix 1: GC periódico agora é global (não duplica em reconexões)
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    // Socket velho falando: quando um socket é substituído, o listener dele
    // continua registrado e fecha sobre a `session` ANTIGA. Sem esta guarda, o
    // "close" do zumbi agendava outra reconexão e mexia em estado que já não é
    // dele — mais um caminho para dois sockets vivos na mesma pasta de auth.
    if (sessions.get(instanceName)?.sock !== sock) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrBase64 = await QRCode.toDataURL(qr, { margin: 2, width: 300 });
        session.qrBase64 = qrBase64;
      } catch (err) {
        console.error("[WhatsApp Gateway] Erro ao converter QR Code:", err);
      }
    }

    if (connection === "open") {
      session.state = "open";
      session.qrBase64 = null;
      reconnectCounters.set(instanceName, 0);
      const userJid = sock.user?.id || "";
      const rawPhone = userJid.split(":")[0] || "";
      session.phone = rawPhone ? `+55 ${rawPhone.replace(/^55/, "")}` : "";

      console.log(`[WhatsApp Gateway] ✅ Instância ${instanceName} conectada! Número: ${session.phone}`);

      // Notifica o FireHub via Webhook
      try {
        const webhookUrl = process.env.FIREHUB_WEBHOOK_URL || "https://firehubfood.com.br/api/webhook/whatsapp";
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "CONNECTION_UPDATE",
            instance: instanceName,
            data: { state: "open", ownerJid: userJid, phone: session.phone },
          }),
        });
      } catch (err) {
        console.warn("[WhatsApp Gateway] Aviso ao notificar webhook de conexão:", err.message);
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      // 440 = connectionReplaced: OUTRA conexão assumiu esta credencial. Voltar
      // correndo é reentrar na briga que acabamos de perder, e os dois lados
      // ficam se derrubando enquanto escrevem ratchet divergente no mesmo lugar.
      // Se este número aparecer no log, há dois processos com a mesma sessão —
      // deploy antigo vivo, ou o WhatsApp Web aberto no navegador de alguém.
      const substituida = statusCode === DisconnectReason.connectionReplaced || statusCode === 440;
      const shouldReconnect = !isLoggedOut && !substituida;
      session.state = "close";

      const count = (reconnectCounters.get(instanceName) || 0) + 1;
      reconnectCounters.set(instanceName, count);

      console.log(`[WhatsApp Gateway] 🔄 Conexão encerrada para ${instanceName} (Status ${statusCode}). Reconectar: ${shouldReconnect} (tentativa #${count})`);

      if (shouldReconnect) {
        // Reconexão infinita com backoff de 3s até no máximo 30s
        const delay = Math.min(3000 * Math.min(count, 10), 30000);
        console.log(`[WhatsApp Gateway] ⏳ Agendando reconexão de ${instanceName} em ${delay / 1000}s...`);
        setTimeout(() => {
          getOrCreateSocket(instanceName).catch((err) => {
            console.error(`[WhatsApp Gateway] Erro ao tentar reconectar ${instanceName}:`, err.message);
          });
        }, delay);
      } else if (isLoggedOut) {
        console.log(`[WhatsApp Gateway] 🚪 Instância ${instanceName} desconectada pelo usuário (loggedOut). Limpando sessão...`);
        sessions.delete(instanceName);
        reconnectCounters.delete(instanceName);
        try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch {}
      } else {
        // Substituída (440). A credencial CONTINUA VÁLIDA — apagar a pasta aqui
        // seria trocar um conflito temporário por um QR novo em cinco lojas.
        console.error(`[WhatsApp Gateway] ⛔ ${instanceName}: a conexão foi ASSUMIDA POR OUTRO CLIENTE (status ${statusCode}). Não vou reconectar em laço. Procure um segundo gateway rodando com a mesma sessão, ou o WhatsApp Web aberto nesse número. Autenticação preservada; use /instance/restart/${instanceName} depois de resolver.`);
        reconnectCounters.delete(instanceName);
      }
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    if (m.type !== "notify") return;

    for (const msg of m.messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid || "";
      if (remoteJid.endsWith("@g.us")) continue;

      const isAudio = Boolean(
        msg.message.audioMessage ||
        msg.message.pttMessage ||
        msg.message.ephemeralMessage?.message?.audioMessage ||
        msg.message.viewOnceMessage?.message?.audioMessage ||
        msg.message.viewOnceMessageV2?.message?.audioMessage
      );

      const textMessage =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        (isAudio ? "O cliente enviou a mensagem de áudio em anexo." : "");

      if (!textMessage.trim() && !isAudio) continue;

      // O cooldown existe para não disparar a IA em rajada. Mensagem que SAI do
      // número da loja não chama IA nenhuma — ela é o sinal de que o lojista
      // assumiu a conversa. Se ela caísse no cooldown (o dono respondendo 2s
      // depois do cliente, que é o caso comum), o FireHub nunca ficaria sabendo
      // e o robô continuaria falando por cima dele.
      const isFromMe = Boolean(msg.key?.fromMe);

      const now = Date.now();
      if (!isFromMe) {
        // ── O COOLDOWN DESCARTAVA MENSAGEM DE CLIENTE ────────────────────────
        //
        // A janela era de 3 SEGUNDOS e a mensagem não era enfileirada: era
        // JOGADA FORA, com um `continue`. Quem manda várias mensagens seguidas
        // — e áudio é sempre assim — tinha parte do que disse simplesmente
        // ignorada. Se a pergunta estava na mensagem descartada, o robô "parava
        // de responder" sem nenhum erro em lugar nenhum. Foi o relato do dono
        // em 29/08/2026: "quando alguém fala muito com ele de áudio, ele para
        // de responder".
        //
        // A janela caiu para 1s, que ainda barra o toque duplo acidental, e
        // ÁUDIO NUNCA É DESCARTADO: é o que carrega o conteúdo do pedido, e o
        // cliente costuma mandar dois ou três em sequência.
        //
        // Chave por instância: o dono, que fala com várias lojas pelo mesmo
        // número, tinha as mensagens de uma loja engolidas pelo cooldown da
        // outra.
        const chaveDoCooldown = `${instanceName}|${remoteJid}`;
        const lastReply = replyCooldowns.get(chaveDoCooldown) || 0;
        if (!isAudio && now - lastReply < 1000) {
          console.log(`[WhatsApp Gateway] ⏳ Ignorando mensagem de ${remoteJid} (repetição em menos de 1s)`);
          continue;
        }
        replyCooldowns.set(chaveDoCooldown, now);
      }

      let payloadMessage = JSON.parse(JSON.stringify(msg.message));

      if (isAudio) {
        try {
          console.log(`[WhatsApp Gateway] 🎙️ Baixando áudio de ${remoteJid}...`);
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          const base64Str = buffer.toString("base64");
          if (!payloadMessage.audioMessage) payloadMessage.audioMessage = {};
          payloadMessage.audioMessage.base64 = base64Str;
          payloadMessage.audioMessage.mimetype = "audio/ogg";
          console.log(`[WhatsApp Gateway] ✅ Áudio de ${remoteJid} baixado com sucesso (${base64Str.length} chars)`);
        } catch (audioErr) {
          console.error(`[WhatsApp Gateway] ❌ Erro ao baixar áudio de ${remoteJid}:`, audioErr?.message || audioErr);
        }
      }

      console.log(`[WhatsApp Gateway] 💬 Mensagem recebida de ${remoteJid}: "${textMessage}" (isAudio: ${isAudio})`);

      // Conversa endereçada por LID: descobrir o telefone AQUI e mandar junto.
      // O FireHub já procura `senderAlt` entre os candidatos e pontua telefone
      // brasileiro acima de tudo — preenchendo este campo, a resposta passa a
      // sair para o telefone em vez do @lid, que é o que não decifra.
      let senderAlt = "";
      if (String(remoteJid).endsWith("@lid")) {
        // O TELEFONE VEM JUNTO DA MENSAGEM. O Baileys põe o número real em
        // `senderPn` na própria `key` de toda mensagem recebida por LID — é a
        // fonte mais confiável que existe, melhor que qualquer mapa nosso,
        // porque chega junto do dado e não depende de consulta nem de memória.
        const doProprioWhatsApp = normalizarParaJidDeTelefone(
          msg.key?.senderPn || msg.key?.participantPn || msg.key?.remoteJidAlt || msg.participantPn,
        );

        if (doProprioWhatsApp) {
          // Aprender aqui é o que faz a RESPOSTA sair para o telefone.
          lembrarLid(remoteJid, doProprioWhatsApp);
          senderAlt = doProprioWhatsApp;
        } else {
          const telefoneReal = await resolverParaTelefone(sock, remoteJid);
          if (telefoneReal !== remoteJid) senderAlt = telefoneReal;
          // Sem telefone em lugar nenhum: registrar a key crua para não ficarmos
          // no escuro sobre o que a biblioteca entrega nesse caso.
          if (!senderAlt) {
            console.warn(`[WhatsApp Gateway] 🪪 LID sem telefone em nenhuma fonte. key=${JSON.stringify(msg.key)}`);
          }
        }
      }

      try {
        const webhookUrl = process.env.FIREHUB_WEBHOOK_URL || "https://firehubfood.com.br/api/webhook/whatsapp";
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "MESSAGES_UPSERT",
            instance: instanceName,
            data: {
              key: msg.key,
              message: payloadMessage,
              sender: remoteJid,
              senderAlt,
              pushName: msg.pushName || "",
              // Conta empresarial verificada. Cliente de verdade nunca tem esse
              // campo; robô institucional (InfinityPay, banco, marketplace) tem.
              // É o sinal mais barato para o FireHub não entrar em conversa de
              // robô com robô.
              verifiedBizName: msg.verifiedBizName || "",
            },
          }),
        });
      } catch (err) {
        console.error("[WhatsApp Gateway] Erro ao enviar mensagem para webhook FireHub:", err);
      }
    }
  });

  return session;
}

/**
 * Health.
 *
 * `sessions` contava o tamanho do Map — ou seja, quantos sockets EXISTEM, não
 * quantos estão conectados. Uma loja presa em "connecting" há 26 tentativas
 * (sem credencial, gerando QR que ninguém lê) entrava na conta igual a uma loja
 * saudável. Foi assim que o painel disse "5 sessões" com 3 lojas mudas — e o
 * robô "parou de responder" sem nenhum alarme tocar em lugar nenhum.
 *
 * Agora o número que importa é `conectadas`, e `precisamDeQR` lista nome por
 * nome quem está fora. `status` só é "ok" quando não há ninguém caído.
 */
app.get("/", (req, res) => {
  const porEstado = { open: [], connecting: [], outros: [] };
  for (const [nome, s] of sessions.entries()) {
    if (s.state === "open") porEstado.open.push(nome);
    else if (s.state === "connecting") porEstado.connecting.push(nome);
    else porEstado.outros.push(`${nome}:${s.state}`);
  }
  const foraDoAr = [...porEstado.connecting, ...porEstado.outros];
  return res.json({
    status: foraDoAr.length === 0 ? "ok" : "degradado",
    conectadas: porEstado.open.length,
    totalDeInstancias: sessions.size,
    precisamDeQR: foraDoAr,
    lojasConectadas: porEstado.open,
    uptime: process.uptime(),
  });
});

// ── AUTENTICAÇÃO ────────────────────────────────────────────────────────────
//
// Havia um `process.env.API_KEY || "firehub_secret_key_2026"` aqui. Esse literal
// está no repositório, que é público — e era a chave REAL de produção. Ou seja:
// qualquer pessoa podia chamar `DELETE /instance/clean-all` e desconectar todas
// as lojas. O default foi embora: sem `API_KEY`, o gateway não sobe.
//
// `API_KEY_ANTERIOR` existe só para a troca de chave não ter janela de queda. O
// app roda em outro lugar (Coolify) e não muda no mesmo instante que este
// serviço; durante a virada as duas chaves valem. Apague a variável assim que o
// app estiver usando a nova — enquanto ela existir, a chave velha continua boa.
const CHAVES_ACEITAS = [process.env.API_KEY, process.env.API_KEY_ANTERIOR].filter(Boolean);
if (CHAVES_ACEITAS.length === 0) {
  console.error("[WhatsApp Gateway] ❌ API_KEY não definida. Recusando subir sem autenticação — antes havia um default público no código.");
  process.exit(1);
}
if (process.env.API_KEY_ANTERIOR) {
  console.warn("[WhatsApp Gateway] 🔑 API_KEY_ANTERIOR ativa: a chave antiga ainda é aceita. Apague a variável quando o app estiver na nova.");
}

app.use((req, res, next) => {
  // Comparação em tempo constante para não vazar a chave pelo tempo de resposta.
  const recebida = String(req.headers["apikey"] || "");
  const confere = CHAVES_ACEITAS.some((valida) => {
    const a = Buffer.from(recebida);
    const b = Buffer.from(valida);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!confere) {
    // Gritar no log, sem NUNCA imprimir a chave recebida.
    //
    // Existe para a virada de chave não falhar em silêncio: se sobrou alguém
    // chamando com a chave velha — uma loja com `chatbotConfig.evolutionApiKey`
    // próprio, um script esquecido — a recusa aparece aqui com o caminho e a
    // origem, em vez de virar "o robô parou de mandar mensagem" sem explicação.
    console.warn(`[WhatsApp Gateway] 🔒 Chamada RECUSADA (401) em ${req.method} ${req.path} — origem ${req.headers["user-agent"] || "desconhecida"}, apikey de ${String(req.headers["apikey"] || "").length} caractere(s)`);
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// 1. Estado da Conexão
app.get("/instance/connectionState/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);

  if (session && session.state === "open") {
    return res.json({ instance: { state: "open", ownerJid: session.phone } });
  }

  if (!session) {
    return res.status(404).json({ error: "Instance not found" });
  }

  return res.json({ instance: { state: session.state || "close" } });
});

// 2. Conectar e Obter QR Code Real
app.get("/instance/connect/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const session = await getOrCreateSocket(instanceName);

  if (session.state === "open") {
    return res.json({ instance: { state: "open" }, connected: true, phone: session.phone });
  }

  // Aguarda até 4 segundos se o QR Code ainda estiver sendo gerado
  let attempts = 0;
  while (!session.qrBase64 && session.state !== "open" && attempts < 20) {
    await new Promise((r) => setTimeout(r, 200));
    attempts++;
  }

  if (session.qrBase64) {
    // NÃO devolver `pairingCode` aqui. Havia um "8888-9999" fixo, que o painel
    // exibia como se fosse um código real de "conectar com número de telefone":
    // o lojista digitava, não funcionava nunca, e desistia achando que o
    // sistema estava quebrado. Código de pareamento de verdade só existe sob
    // demanda, no endpoint abaixo, porque a Meta o emite amarrado ao número.
    return res.json({
      code: session.qrBase64,
      base64: session.qrBase64,
      status: 200,
    });
  }

  return res.status(500).json({ error: "Gerando QR Code..." });
});

/**
 * GET /instance/pairing-code/:instanceName?number=5522999999999
 *
 * O caminho SEM câmera: em vez de apontar o celular para o QR na tela, o
 * lojista digita um código de 8 caracteres em
 * WhatsApp → Aparelhos conectados → Conectar com número de telefone.
 *
 * É o que resolve loja remota, onde ninguém está na frente do computador com o
 * telefone na mão — dá para passar o código por ligação ou mensagem.
 *
 * O número tem que ser o MESMO que vai ser conectado, com DDI (55) e DDD.
 */
app.get("/instance/pairing-code/:instanceName", async (req, res) => {
  const numero = String(req.query.number || "").replace(/\D/g, "");
  if (numero.length < 12) {
    return res.status(400).json({ error: "Informe ?number=55DDNUMERO (com 55 e DDD)" });
  }

  const session = await getOrCreateSocket(req.params.instanceName);
  if (session.state === "open") {
    return res.json({ jaConectada: true, phone: session.phone });
  }

  try {
    if (session.sock?.authState?.creds?.registered) {
      return res.status(409).json({ error: "Instância já registrada; reinicie antes de parear de novo" });
    }
    const pairingCode = await session.sock.requestPairingCode(numero);
    console.log(`[WhatsApp Gateway] 🔑 Código de pareamento gerado para ${req.params.instanceName} (${numero})`);
    return res.json({ pairingCode, number: numero });
  } catch (err) {
    console.error(`[WhatsApp Gateway] ❌ Falha ao gerar código de pareamento:`, err?.message || err);
    return res.status(500).json({ error: err?.message || "Falha ao gerar código" });
  }
});

// 3. Criar Instância
app.post("/instance/create", async (req, res) => {
  const { instanceName } = req.body;
  await getOrCreateSocket(instanceName || "default");
  return res.json({ instance: { instanceName, status: "created" } });
});

// 3.4 Restart: derruba e recria a conexão SEM apagar a autenticação.
//
// É o que o botão "Reparar conexão do WhatsApp" do FireHub chama quando as
// mensagens ficam em "Aguardando mensagem": força o Baileys a renegociar as
// sessões de criptografia, mantendo o pareamento — NÃO pede QR de novo.
// Aceita PUT e POST porque a Evolution API oficial mudou o verbo entre
// versões e o FireHub tenta os dois.
async function reiniciarInstancia(req, res) {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);
  const authFolder = path.join(__dirname, "data", "sessions", instanceName);

  if (!session && !fs.existsSync(authFolder)) {
    return res.status(404).json({ error: "Instance not found" });
  }

  // Se há uma criação em voo, ESPERAR — nunca apagar a trava dela. Apagar era
  // o jeito mais confiável de acabar com dois sockets na mesma pasta de auth,
  // e o botão "Reparar conexão" do painel chama exatamente isto (clicado três
  // vezes seguidas por um lojista impaciente, fabricava três sockets).
  try { await sessionLocks.get(instanceName); } catch { /* a criação falhou; segue */ }

  if (session && session.sock) {
    try { session.sock.end(); } catch (e) {}
  }
  sessions.delete(instanceName);
  reconnectCounters.delete(instanceName);

  console.log(`[WhatsApp Gateway] 🔄 Restart solicitado para ${instanceName} (autenticação preservada)`);
  try {
    await getOrCreateSocket(instanceName);
    return res.json({ success: true, message: `Instância ${instanceName} reconectando` });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Falha ao reconectar" });
  }
}
app.put("/instance/restart/:instanceName", reiniciarInstancia);
app.post("/instance/restart/:instanceName", reiniciarInstancia);

/**
 * POST /instance/renovar-chaves/:instanceName
 *
 * Publica um lote novo de pre-keys e descarta as sessões dos contatos.
 *
 * É a cura de "PreKeyError: Invalid PreKey ID", que aparece quando o aparelho
 * do contato inicia sessão citando uma pre-key nossa que não existe mais do
 * nosso lado. Aí NADA decifra, nos dois sentidos: as mensagens dele chegam
 * ilegíveis para nós (e o gateway fica pedindo retransmissão em laço) e as
 * nossas chegam como "Aguardando mensagem" para ele.
 *
 * Descartar só a sessão não resolve esse caso — o aparelho dele volta a citar
 * a mesma pre-key inexistente. Publicando um lote novo, o próximo handshake
 * encontra chave válida.
 *
 * Não desconecta e não pede QR: `creds.json` fica intacto.
 */
app.post("/instance/renovar-chaves/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);
  if (!session || session.state !== "open" || !session.sock) {
    return res.status(400).json({ error: "Instância não conectada" });
  }

  let publicou = false;
  try {
    // O nome mudou entre versões do Baileys; tentar as duas formas conhecidas.
    if (typeof session.sock.uploadPreKeys === "function") {
      await session.sock.uploadPreKeys();
      publicou = true;
    } else if (typeof session.sock.uploadPreKeysToServerIfRequired === "function") {
      await session.sock.uploadPreKeysToServerIfRequired();
      publicou = true;
    }
  } catch (err) {
    console.error(`[WhatsApp Gateway] ❌ Falha ao publicar pre-keys de ${instanceName}:`, err?.message || err);
    return res.status(500).json({ error: err?.message || "Falha ao publicar pre-keys" });
  }

  // Com chaves novas publicadas, as sessões antigas só atrapalham.
  const proprias = identidadesDaPropriaConta(instanceName);
  let sessoesDescartadas = 0;
  try {
    for (const arquivo of fs.readdirSync(pastaDaSessao(instanceName))) {
      if (!arquivo.startsWith("session-")) continue;
      // NUNCA a própria conta: toda mensagem 1:1 é cifrada também para os
      // aparelhos da loja, e apagar essa sessão quebra de uma vez a cópia de
      // todas as conversas no celular do dono.
      if (proprias.some((n) => arquivo.startsWith(`session-${n}.`))) {
        console.warn(`[WhatsApp Gateway] 🛡️ Preservando ${arquivo} (própria conta de ${instanceName})`);
        continue;
      }
      fs.rmSync(path.join(pastaDaSessao(instanceName), arquivo), { force: true });
      sessoesDescartadas++;
    }
  } catch (err) {
    console.warn(`[WhatsApp Gateway] Aviso ao descartar sessões de ${instanceName}:`, err.message);
  }
  pedidosDeRetransmissao.clear();

  console.log(`[WhatsApp Gateway] 🔑 ${instanceName}: pre-keys publicadas=${publicou}, ${sessoesDescartadas} sessão(ões) descartada(s)`);
  return res.json({ success: true, preKeysPublicadas: publicou, sessoesDescartadas });
});

/**
 * POST /instance/aprender-contatos/:instanceName   { "numeros": ["5522...", ...] }
 *
 * Enche o mapa LID→telefone de uma vez, em vez de esperar o robô falar com cada
 * contato. Sem isto, a PRIMEIRA resposta a um cliente que chega por LID sai para
 * o endereço errado e não decifra — e primeira mensagem é justamente quando o
 * cliente está decidindo se pede ou não.
 *
 * O `onWhatsApp` do Baileys aceita vários números por chamada, então a lista
 * inteira custa poucas consultas. Lotes de 50 para não montar stanza gigante.
 */
app.post("/instance/aprender-contatos/:instanceName", async (req, res) => {
  const session = sessions.get(req.params.instanceName);
  if (!session || session.state !== "open" || !session.sock) {
    return res.status(400).json({ error: "Instância não conectada" });
  }

  const numeros = Array.isArray(req.body?.numeros) ? req.body.numeros : [];
  const limpos = [...new Set(
    numeros.map((n) => String(n || "").replace(/\D/g, "")).filter((n) => n.length >= 12 && n.length <= 13),
  )];
  if (limpos.length === 0) return res.json({ aprendidos: 0, consultados: 0, mapaTem: lidParaTelefone.size });

  let aprendidos = 0;
  for (let i = 0; i < limpos.length; i += 50) {
    const lote = limpos.slice(i, i + 50);
    try {
      const resultado = (await session.sock.onWhatsApp(...lote)) || [];
      for (const info of resultado) {
        if (!info?.lid || !info?.jid) continue;
        lembrarLid(info.lid, info.jid);
        aprendidos++;
      }
    } catch (err) {
      console.warn(`[WhatsApp Gateway] Aviso ao aprender lote de contatos:`, err.message);
    }
  }

  console.log(`[WhatsApp Gateway] 🔗 ${req.params.instanceName}: ${aprendidos} LID(s) aprendidos de ${limpos.length} número(s)`);
  return res.json({ aprendidos, consultados: limpos.length, mapaTem: lidParaTelefone.size });
});

/**
 * GET /instance/quem-e/:instanceName?number=5522999999999
 *
 * Pergunta ao WhatsApp o que ele sabe sobre um número — inclusive o LID dele —
 * e já grava o caminho de volta no mapa. Serve para diagnosticar conversa presa
 * em "Aguardando mensagem" e para ensinar um contato ao gateway sem esperar que
 * o robô mande alguma coisa para ele.
 */
app.get("/instance/quem-e/:instanceName", async (req, res) => {
  const numero = String(req.query.number || "").replace(/\D/g, "");
  if (!numero) return res.status(400).json({ error: "Informe ?number=55DDNUMERO" });

  const session = sessions.get(req.params.instanceName);
  if (!session || session.state !== "open" || !session.sock) {
    return res.status(400).json({ error: "Instância não conectada" });
  }

  try {
    const resultado = (await session.sock.onWhatsApp(numero)) || [];
    const info = resultado[0] || null;
    if (info?.lid) lembrarLid(info.lid, `${numero}@s.whatsapp.net`);
    return res.json({ numero, info, mapaTem: lidParaTelefone.size });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Falha na consulta" });
  }
});

/**
 * GET /instance/diagnostico-sessao/:instanceName
 *
 * A pergunta que faltava para entender o "Aguardando mensagem": a sessão de
 * criptografia com a PRÓPRIA CONTA da loja existe e está íntegra?
 *
 * Ela importa porque toda mensagem 1:1 que o robô manda é cifrada DUAS vezes —
 * uma para o cliente e outra para os aparelhos da loja, para o dono acompanhar
 * pelo celular dele (`messages-send.js` empilha `devices.push({ user: meUser })`).
 * Se essa sessão está quebrada, o dono vê "Aguardando mensagem" em TODAS as
 * conversas do robô ao mesmo tempo, enquanto os clientes recebem normalmente.
 * É exatamente o formato do relato, e nenhum conserto feito em sessão de cliente
 * chega perto disso.
 *
 * Também aponta arquivo de sessão com JSON inválido — o `useMultiFileAuthState`
 * do Baileys engole erro de leitura e devolve `null`, que é indistinguível de
 * "não tenho sessão". Sem isto, corrupção por escrita interrompida é invisível.
 */
app.get("/instance/diagnostico-sessao/:instanceName", (req, res) => {
  const { instanceName } = req.params;
  const pasta = pastaDaSessao(instanceName);
  const proprias = identidadesDaPropriaConta(instanceName);

  let arquivos = [];
  try {
    arquivos = fs.readdirSync(pasta);
  } catch {
    return res.status(404).json({ error: "Instância sem pasta de sessão", instanceName });
  }

  const sessoes = arquivos.filter((a) => a.startsWith("session-"));
  const daPropriaConta = sessoes.filter((a) => proprias.some((n) => a.startsWith(`session-${n}.`)));

  const corrompidos = [];
  for (const arquivo of arquivos) {
    try {
      JSON.parse(fs.readFileSync(path.join(pasta, arquivo), "utf8"));
    } catch (err) {
      corrompidos.push({ arquivo, erro: err.message });
    }
  }

  const pendentes = [];
  for (const [chave, dado] of pedidosDeRetransmissao) {
    if (chave.startsWith(`${instanceName}|`)) {
      pendentes.push({ contato: chave.split("|")[1], vezes: dado.vezes, hoje: new Date(dado.ultimoEm).toISOString() });
    }
  }

  return res.json({
    instanceName,
    estado: sessions.get(instanceName)?.state || "inexistente",
    identidadesDaLoja: proprias,
    sessaoComAPropriaConta: {
      existe: daPropriaConta.length > 0,
      arquivos: daPropriaConta,
      // Este é o alarme. Sem sessão com a própria conta, o dono não decifra nada
      // do que o robô manda — e é o sintoma que ele relata.
      alerta: proprias.length > 0 && daPropriaConta.length === 0
        ? "NÃO EXISTE sessão com o aparelho da própria loja. Enquanto ela não for renegociada, o dono vê 'Aguardando mensagem' em toda mensagem do robô. Peça a ele para MANDAR UMA MENSAGEM no chat da loja: a mensagem dele reabre a sessão nos dois sentidos."
        : null,
    },
    totalDeSessoes: sessoes.length,
    arquivosCorrompidos: corrompidos,
    pedidosDeRetransmissaoPendentes: pendentes,
    mensagensEmCacheParaRetransmitir: [...mensagensEnviadas.keys()].filter((k) => k.startsWith(`${instanceName}|`)).length,
  });
});

/**
 * POST /instance/limpar-sessao-do-contato/:instanceName  { "number": "5522..." }
 *
 * Cura manual do "Aguardando mensagem" numa conversa específica. Descarta só a
 * sessão de criptografia DAQUELE contato — o próximo envio negocia chaves novas.
 * Não desconecta a loja, não pede QR, não toca nas outras conversas.
 *
 * A autocura (ver o topo do arquivo) faz isso sozinha quando o WhatsApp pede
 * retransmissão duas vezes; este endpoint é para quando se quer forçar na hora.
 */
app.post("/instance/limpar-sessao-do-contato/:instanceName", (req, res) => {
  const numero = String(req.body?.number || "").replace(/\D/g, "");
  if (!numero) return res.status(400).json({ error: "Informe 'number'" });

  // "todas" cura o mesmo contato em todas as lojas de uma vez — é o caso comum
  // de quem fala com várias (o dono, um motoboy) e não sabe nome de instância.
  const alvos = req.params.instanceName === "todas"
    ? fs.readdirSync(path.join(__dirname, "data", "sessions"), { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name)
    : [req.params.instanceName];

  const jid = `${numero}@s.whatsapp.net`;
  const porInstancia = {};
  for (const instancia of alvos) porInstancia[instancia] = apagarSessaoDoContato(instancia, jid);
  pedidosDeRetransmissao.delete(jid);

  const total = Object.values(porInstancia).reduce((a, b) => a + b, 0);
  console.log(`[WhatsApp Gateway] 🧹 Sessão de ${jid} limpa manualmente (${total} arquivo(s) em ${alvos.length} instância(s))`);
  return res.json({ success: true, jid, arquivosApagados: total, porInstancia });
});

/**
 * POST /instance/renegociar-todas-as-conversas/:instanceName
 *
 * Mutirão: descarta a sessão de criptografia de TODOS os contatos da loja
 * (ou de todas, com "todas"). Existe porque a podridão não estava num contato
 * só — pegou o dono, motoboys e parte dos clientes, e curar um a um exigiria
 * saber de antemão quem está quebrado, que é justamente o que não dá para ver.
 *
 * ⚠️ LEIA ANTES DE RODAR: ISTO QUASE SEMPRE PIORA.
 *
 * A descrição acima ("é seguro, só renegocia") estava errada, e este endpoint é
 * provavelmente a origem das ondas de "Aguardando mensagem" que apareciam logo
 * depois de cada tentativa de conserto. Duas razões:
 *
 * 1. Sessão Signal é SIMÉTRICA. Apagar o nosso registro não apaga o do aparelho
 *    do contato. Passamos a mandar `pkmsg` forçando sessão nova, e tudo que
 *    estava em voo cifrado sob a sessão anterior fica órfão dos DOIS lados —
 *    cada mensagem órfã é um balão "Aguardando mensagem" que nunca abre.
 * 2. Com "todas", a base inteira entra em handshake ao mesmo tempo. É a receita
 *    exata de "muitas mensagens quebradas de uma vez".
 *
 * O Baileys já renegocia sozinho, e melhor: a cada pedido de retransmissão ele
 * chama `assertSessions(participant, force=true)`, que busca pre-keys novas e
 * refaz a sessão daquele contato — só de quem precisa, na hora certa.
 *
 * Ficou aqui como último recurso manual, atrás de uma confirmação explícita, e
 * agora preservando a sessão da própria conta.
 */
app.post("/instance/renegociar-todas-as-conversas/:instanceName", (req, res) => {
  if (req.query.confirmo !== "sim-eu-sei") {
    return res.status(400).json({
      error: "Este mutirão costuma PIORAR o 'Aguardando mensagem' — leia o comentário no código antes.",
      comoForcar: "repita a chamada com ?confirmo=sim-eu-sei",
    });
  }

  const raiz = path.join(__dirname, "data", "sessions");
  const alvos = req.params.instanceName === "todas"
    ? fs.readdirSync(raiz, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    : [req.params.instanceName];

  const porInstancia = {};
  for (const instancia of alvos) {
    const proprias = identidadesDaPropriaConta(instancia);
    let apagados = 0;
    try {
      for (const arquivo of fs.readdirSync(path.join(raiz, instancia))) {
        // SÓ "session-". "pre-key-", "sender-key-", "app-state-" e "creds.json"
        // são nossos e apagá-los derrubaria a loja.
        if (!arquivo.startsWith("session-")) continue;
        // E nunca a própria conta — ver `apagarSessaoDoContato`.
        if (proprias.some((n) => arquivo.startsWith(`session-${n}.`))) continue;
        fs.rmSync(path.join(raiz, instancia, arquivo), { force: true });
        apagados++;
      }
    } catch (err) {
      console.warn(`[WhatsApp Gateway] Aviso ao renegociar ${instancia}:`, err.message);
    }
    porInstancia[instancia] = apagados;
  }

  pedidosDeRetransmissao.clear();
  const total = Object.values(porInstancia).reduce((a, b) => a + b, 0);
  console.warn(`[WhatsApp Gateway] 🧹 Mutirão FORÇADO: ${total} sessão(ões) descartada(s) em ${alvos.length} instância(s). Espere uma onda de renegociação.`);
  return res.json({ success: true, sessoesDescartadas: total, porInstancia });
});

// 3.5 Reset Instância (limpa sessão corrompida e força novo QR Code)
app.delete("/instance/reset/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);
  
  // Mesma regra do restart: esperar a criação em voo em vez de apagar a trava.
  try { await sessionLocks.get(instanceName); } catch { /* a criação falhou; segue */ }

  if (session && session.sock) {
    try { session.sock.end(); } catch(e) {}
  }

  sessions.delete(instanceName);
  reconnectCounters.delete(instanceName);

  const authFolder = path.join(__dirname, "data", "sessions", instanceName);
  try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch {}
  
  console.log(`[WhatsApp Gateway] 🗑️ Reset completo da instância ${instanceName}`);
  return res.json({ success: true, message: `Instância ${instanceName} resetada` });
});

// 3.6 Limpar TODAS as sessões
app.delete("/instance/clean-all", async (req, res) => {
  for (const [name, session] of sessions) {
    if (session.sock) {
      try { session.sock.end(); } catch(e) {}
    }
  }
  
  sessions.clear();
  sessionLocks.clear();
  reconnectCounters.clear();
  
  const sessionsFolder = path.join(__dirname, "data", "sessions");
  try { fs.rmSync(sessionsFolder, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(sessionsFolder, { recursive: true });
  
  console.log("[WhatsApp Gateway] 🗑️ TODAS as sessões foram limpas");
  return res.json({ success: true, message: "Todas as sessões limpas" });
});

// 4. Enviar Mensagem de Texto
app.post("/message/sendText/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const { number, text } = req.body;

  // O FALLBACK DE INSTÂNCIA FOI REMOVIDO.
  //
  // Aqui, quando a instância pedida não estava conectada, a mensagem saía pela
  // sessão de OUTRA loja. O destinatário recebia de um número que ele nunca viu
  // — e como hoje 3 de 5 lojas passam boa parte do tempo fora do ar, isso era
  // uma fonte silenciosa de "mensagens estranhas chegando". Pior: escondia a
  // queda, então ninguém ia reconectar a loja.
  //
  // Falhar alto é o comportamento certo. Quem chama já sabe tratar `false`.
  const session = sessions.get(instanceName);
  if (!session || session.state !== "open" || !session.sock) {
    console.error(`[WhatsApp Gateway] ⛔ Envio recusado: instância "${instanceName}" está ${session?.state || "inexistente"}. Reconecte a loja — a mensagem NÃO sai pelo número de outra.`);
    return res.status(503).json({ error: "Instância não conectada no celular", instancia: instanceName, estado: session?.state || "inexistente" });
  }

  // Se o número já for um JID completo (@s.whatsapp.net ou @lid), envia diretamente para ele
  const cleanNum = String(number).trim();
  const jidBruto = (cleanNum.includes("@s.whatsapp.net") || cleanNum.includes("@lid"))
    ? cleanNum
    : `${cleanNum.replace(/\D/g, "")}@s.whatsapp.net`;

  // `bruto: true` desliga a conversão LID → telefone e manda para o endereço
  // exatamente como veio.
  //
  // Existe para uma pergunta que o log não responde sozinho: para um contato que
  // o WhatsApp já migrou para LID, qual endereço o aparelho dele consegue
  // decifrar? Hoje o gateway converte tudo para telefone (commit 9378c8b) e os
  // pedidos de retransmissão voltam de endereços @lid — o que sugere que a
  // conversão é justamente o defeito. Sugerir não basta: com isto dá para mandar
  // a MESMA mensagem pelos dois caminhos e ver qual chega legível.
  const jid = req.body?.bruto ? jidBruto : await resolverDestino(session.sock, jidBruto);
  // Enviar para um telefone é a oportunidade de aprender o LID dele. Não trava
  // o envio: se a consulta falhar, a mensagem sai do mesmo jeito.
  // `resolverDestino` já consulta e grava o LID quando precisa; não há mais uma
  // consulta USync solta a cada mensagem enviada.

  try {
    const enviada = await session.sock.sendMessage(jid, { text });
    lembrarEnviada(instanceName, enviada);
    console.log(`[WhatsApp Gateway] 🚀 Mensagem enviada com sucesso para ${jid}: "${text.slice(0, 50)}..."`);
    return res.json({ status: "SENT", to: jid });
  } catch (err) {
    console.error(`[WhatsApp Gateway] ❌ Erro ao enviar mensagem para ${jid}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

// 4.1 Enviar Mídia (Imagem com legenda)
app.post("/message/sendMedia/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const { number, mediaMessage, mediaUrl: directMediaUrl, caption: directCaption } = req.body || {};

  // Mesma regra do texto: sem fallback para o número de outra loja.
  const session = sessions.get(instanceName);
  if (!session || session.state !== "open" || !session.sock) {
    console.error(`[WhatsApp Gateway] ⛔ Envio de mídia recusado: instância "${instanceName}" está ${session?.state || "inexistente"}.`);
    return res.status(503).json({ error: "Instância não conectada no celular", instancia: instanceName, estado: session?.state || "inexistente" });
  }

  const cleanNum = String(number || "").trim();
  const jidBrutoMidia = (cleanNum.includes("@s.whatsapp.net") || cleanNum.includes("@lid"))
    ? cleanNum
    : `${cleanNum.replace(/\D/g, "")}@s.whatsapp.net`;
  // Mesma regra do texto: mídia para @lid também não decifra.
  const jid = req.body?.bruto ? jidBrutoMidia : await resolverDestino(session.sock, jidBrutoMidia);

  const mediaUrl = mediaMessage?.media || mediaMessage?.url || directMediaUrl;
  const caption = mediaMessage?.caption || directCaption || "";

  if (!mediaUrl) {
    return res.status(400).json({ error: "URL da mídia é obrigatória" });
  }

  // PDF enviado como "image" chega quebrado no aparelho: documento vai como
  // documento, com nome de arquivo — é o que o FireHub manda em mediatype.
  const ehDocumento = (mediaMessage?.mediatype || "").toLowerCase() === "document";

  try {
    const enviada = await session.sock.sendMessage(jid, ehDocumento
      ? {
          document: { url: mediaUrl },
          mimetype: /\.pdf(\?|$)/i.test(mediaUrl) ? "application/pdf" : undefined,
          fileName: mediaMessage?.fileName || "arquivo.pdf",
          caption: caption || undefined,
        }
      : {
          image: { url: mediaUrl },
          caption: caption || undefined,
        });
    lembrarEnviada(instanceName, enviada);
    console.log(`[WhatsApp Gateway] 📸 Mídia (${ehDocumento ? "documento" : "imagem"}) enviada com sucesso para ${jid}: "${mediaUrl}"`);
    return res.json({ status: "SENT", to: jid });
  } catch (err) {
    console.error(`[WhatsApp Gateway] ❌ Erro ao enviar mídia para ${jid}:`, err);
    try {
      if (caption) {
        await session.sock.sendMessage(jid, { text: caption });
      }
    } catch {}
    return res.status(500).json({ error: err.message });
  }
});

// 4.5 Obter Base64 de Mídia / Áudio via API REST
app.post("/chat/getBase64FromMediaMessage/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const { message } = req.body || {};

  try {
    // Sem fallback aqui também: baixar mídia pelo socket de outra loja falha na
    // decifragem do arquivo, e o erro sai como "falha ao baixar" sem dizer que a
    // instância pedida estava fora do ar.
    const session = sessions.get(instanceName);

    if (!session || !session.sock) {
      return res.status(400).json({ error: "Sessão não conectada" });
    }

    const msgObj = message?.key ? message : { key: message?.key || {}, message: message?.message || message };
    const buffer = await downloadMediaMessage(msgObj, "buffer", {});
    const base64Str = buffer.toString("base64");
    return res.json({ base64: base64Str, status: "SUCCESS" });
  } catch (err) {
    console.error("[WhatsApp Gateway] Erro no endpoint getBase64FromMediaMessage:", err);
    return res.status(500).json({ error: err.message || "Falha ao baixar mídia" });
  }
});

// 5. Desconectar
app.delete("/instance/logout/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);
  if (session && session.sock) {
    try { await session.sock.logout(); } catch {}
  }
  sessions.delete(instanceName);
  const authFolder = path.join(__dirname, "data", "sessions", instanceName);
  try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch {}
  return res.json({ status: "logged_out" });
});

app.listen(PORT, () => {
  console.log(`[FireHub WhatsApp Gateway] 🚀 Servidor rodando na porta ${PORT}`);

  // Auto-reconectar sessões salvas com delay (evita OOM no boot)
  const sessionsDir = path.join(__dirname, "data", "sessions");
  if (fs.existsSync(sessionsDir)) {
    const folders = fs.readdirSync(sessionsDir).filter(f => {
      try { return fs.statSync(path.join(sessionsDir, f)).isDirectory(); } catch { return false; }
    });
    
    if (folders.length > 0) {
      console.log(`[WhatsApp Gateway] 📋 ${folders.length} sessão(ões) salva(s). Reconectando em 10s...`);
      
      // Reconecta uma por vez com intervalo de 5s entre cada
      let i = 0;
      const reconnectNext = () => {
        if (i >= folders.length) return;
        const instanceName = folders[i++];
        console.log(`[WhatsApp Gateway] 🔄 Reconectando: ${instanceName} (${i}/${folders.length})`);
        getOrCreateSocket(instanceName).catch((err) => {
          console.warn(`[WhatsApp Gateway] ⚠️ Falha ao reconectar ${instanceName}:`, err.message);
        });
        if (i < folders.length) {
          setTimeout(reconnectNext, 5000);
        }
      };
      setTimeout(reconnectNext, 10000);
    }
  }
});
