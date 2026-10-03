import { prisma } from "@/lib/prisma";
import { conversaOriginalEhDeCliente, ehConversaDeCliente } from "@/lib/jid-de-cliente";
import { contaOficialDoWhatsApp } from "@/lib/contas-oficiais-whatsapp";
import { desembrulharMensagem, localizacaoDoPayload, textoDaLocalizacao } from "@/lib/localizacao-do-whatsapp";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { contatoDaConversa } from "@/lib/crm/contatos";
import { gravarMensagem } from "@/lib/crm/mensagens";
import { configDoAtendimento, salvarConfigDoAtendimento } from "./config";
import { baixarMidia, ehEcoDoFireHub } from "./whatsapp";
import { descreverMidia, transcreverAudio } from "./gemini";
import { TAMANHO_MAXIMO_DA_MIDIA, bytesDoBase64, comecouALer, guardarMidia, midiaQueOModeloLe, terminouDeLer } from "./midias";
import { agendarRespostaDoRobo } from "./robo";
import { avisarDono, numeroDaEquipe } from "./avisos";

/**
 * O QUE CHEGA DO NÚMERO DO FIREHUB — desviado no topo de /api/webhook/whatsapp.
 *
 * Aqui não roda nada do caminho das lojas (cardápio, pedido, anti-loop da
 * loja): este número não é loja. O que roda:
 *
 *   1. conexão abriu/caiu → estado na config (a tela mostra) e aviso ao dono;
 *   2. mensagem do contato → contato achado/criado, mensagem gravada, robô
 *      agendado (só responde se estiver ligado — decisão do robo.ts);
 *   3. mensagem que SAIU do número digitada no celular → gravada como
 *      "pelo celular" e o robô cala naquela conversa enquanto a pessoa fala
 *      (PAUSA_PELO_CELULAR_MS). O eco do que a tela/robô mandou é reconhecido
 *      e ignorado (já está gravado).
 *
 * Nunca lança: o webhook devolve 200 ao gateway de qualquer jeito.
 */

/**
 * Quanto o robô espera depois da última mensagem digitada no celular. Cada
 * mensagem renova a espera: enquanto a pessoa está na conversa, o robô fica
 * quieto; 10 minutos sem ela falar, o robô volta a responder a próxima
 * mensagem do contato. Era 12 h — o Douglas achou demais (30/09/2026).
 */
export const PAUSA_PELO_CELULAR_MS = 10 * 60_000;

export async function receberEventoDoAtendimento(evento: string, body: any): Promise<void> {
  try {
    if (!(await garantirEstruturaDoCrm())) return;
    if (evento.includes("CONNECTION") || evento.includes("STATE")) {
      await mudouAConexao(body?.data || {});
      return;
    }
    if (evento.includes("MESSAGE") || evento.includes("UPSERT") || body?.data?.message) {
      await chegouMensagem(body);
    }
  } catch (err: any) {
    console.error(`[Atendimento] Evento ${evento} não processado: ${err?.message}`);
  }
}

async function mudouAConexao(data: any) {
  const estado = String(data?.state || data?.connection || "").toLowerCase();
  if (estado !== "open" && estado !== "close") return;
  const config = await configDoAtendimento();
  const agora = new Date().toISOString();

  if (estado === "open") {
    const telefone = String(data?.phone || data?.ownerJid || "").split("@")[0].split(":")[0].replace(/\D/g, "") || config.conexao.telefone;
    await salvarConfigDoAtendimento({
      conexao: { conectado: true, telefone: telefone || null, desde: config.conexao.conectado ? config.conexao.desde : agora, desconectadoDesde: null, jaConectou: true },
    });
    console.log(`[Atendimento] ✅ Número do FireHub conectado (${telefone || "?"}).`);
    return;
  }

  const jaEstavaFora = config.conexao.conectado === false;
  await salvarConfigDoAtendimento({
    conexao: { ...config.conexao, conectado: false, desconectadoDesde: config.conexao.desconectadoDesde || agora },
  });
  console.warn(`[Atendimento] 📉 Número do FireHub desconectou (status ${data?.statusCode ?? "?"}).`);
  if (!jaEstavaFora && config.conexao.jaConectou) {
    void avisarDono(
      "⚠️ O WhatsApp do atendimento do FireHub desconectou. As mensagens dos clientes não estão chegando no painel.\n" +
      "Reconecte em https://firehubfood.com.br/admin?aba=atendimento",
    );
  }
}

/**
 * O endereço de verdade da conversa. Mesma régua do webhook das lojas
 * (`getRealJid` em api/webhook/whatsapp/route.ts): telefone brasileiro bem
 * formado ganha de tudo; LID só quando não há telefone em lugar nenhum.
 */
function jidDaConversa(data: any, key: any): string {
  const candidatos = [
    key.remoteJidAlt, data.key?.remoteJidAlt, data.senderAlt, data.sender, key.participant, data.participantAlt, key.remoteJid, data.from,
  ].filter((c) => typeof c === "string" && c);
  const nota = (c: string): number => {
    if (c.includes("@lid") || c.includes("@broadcast") || c.includes("@g.us")) return -1;
    const d = c.replace(/\D/g, "");
    if (!d || d.startsWith("22010")) return -1;
    const contato = c.includes("@s.whatsapp.net") || c.includes("@c.us");
    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return contato ? 100 : 90;
    if (d.length > 13) return contato ? 20 : -1;
    if (d.length >= 10) return contato ? 70 : 60;
    return -1;
  };
  const melhor = candidatos.map((c) => ({ c, n: nota(c) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0];
  if (melhor) return melhor.c.includes("@") ? melhor.c : `${melhor.c.replace(/\D/g, "")}@s.whatsapp.net`;
  return key.remoteJid || data.from || "";
}

async function chegouMensagem(body: any) {
  const data = body?.data || body || {};
  const key = data.key || data.message?.key || {};
  if (!conversaOriginalEhDeCliente(key.remoteJid)) return;
  const jid = jidDaConversa(data, key);
  if (!ehConversaDeCliente(jid)) return;

  const jidsDaConversa = [jid, key.remoteJid, key.remoteJidAlt, key.senderPn, key.participant, data.senderAlt, data.sender, data.from].filter(Boolean);
  if (contaOficialDoWhatsApp({ jids: jidsDaConversa, verifiedBizName: data.verifiedBizName || data.message?.verifiedBizName })) return;

  const conteudo = desembrulharMensagem(data.message) || data.message || {};
  const localizacao = localizacaoDoPayload(data);
  const audio = conteudo.audioMessage || conteudo.pttMessage || data.message?.audioMessage || data.message?.pttMessage || null;
  const imagem = conteudo.imageMessage || null;
  const video = conteudo.videoMessage || null;
  const documento = conteudo.documentMessage || conteudo.documentWithCaptionMessage?.message?.documentMessage || null;
  const midia = imagem || video || documento;
  let texto = String(
    conteudo.conversation || conteudo.extendedTextMessage?.text || imagem?.caption || video?.caption || documento?.caption || data.body || data.text || "",
  ).trim();
  // O gateway põe esta frase no lugar do texto quando é só áudio.
  if (/^O cliente enviou a mensagem de áudio em anexo\.?$/i.test(texto)) texto = "";

  const telefone = jid.includes("@lid") ? null : jid.split("@")[0].replace(/\D/g, "");
  const waId = typeof key.id === "string" && key.id ? key.id : null;

  // ── Saiu do número do FireHub ────────────────────────────────────────────
  if (key.fromMe === true) {
    if (!texto && !audio && !midia) return;
    if (texto && ehEcoDoFireHub(jidsDaConversa, texto)) return;
    const contato = await silenciarSeForDaEquipe(await contatoDaConversa({ telefone, jid }), telefone);
    // Print mandado pelo celular sem legenda também é a equipe na conversa: o
    // robô tem de calar do mesmo jeito (antes, sem texto, nem era gravado).
    const doCelular = audio ? "🎤 Áudio enviado pelo celular" : imagem ? "📷 Imagem enviada pelo celular" : video ? "🎬 Vídeo enviado pelo celular" : "📎 Arquivo enviado pelo celular";
    await gravarMensagem({
      contatoId: contato.id, waId, direcao: "SAIDA", autor: "CELULAR", autorNome: "Pelo celular",
      tipo: audio ? "AUDIO" : imagem ? "IMAGEM" : video ? "VIDEO" : documento ? "ARQUIVO" : "TEXTO",
      texto: audio || !midia ? texto || doCelular : texto ? `${doCelular.split(" ")[0]} ${texto}` : doCelular,
    });
    // Uma pessoa respondeu pelo aparelho: robô quieto nessa conversa.
    await prisma.crmContato.update({
      where: { id: contato.id },
      data: { roboPausadoAte: new Date(Date.now() + PAUSA_PELO_CELULAR_MS), aguardandoHumanoDesde: null, naoLidas: 0 },
    });
    return;
  }

  // ── Chegou do contato ────────────────────────────────────────────────────
  let tipo: "TEXTO" | "AUDIO" | "IMAGEM" | "VIDEO" | "ARQUIVO" | "LOCALIZACAO" = "TEXTO";
  /** A leitura da mídia, que roda depois de a mensagem ser gravada (lerMidia). */
  let leitura: Parameters<typeof lerMidia>[2] | null = null;
  if (audio) {
    tipo = "AUDIO";
    let base64: string | null = audio.base64 || data.base64 || data.message?.base64 || null;
    if (!base64) base64 = await baixarMidia(key, data.message);
    const transcricao = base64 ? await transcreverAudio(base64, audio.mimetype || "audio/ogg") : "";
    texto = transcricao ? `🎤 ${transcricao}` : "🎤 Áudio (não consegui transcrever — ouça no celular)";
  } else if (localizacao) {
    tipo = "LOCALIZACAO";
    texto = textoDaLocalizacao(localizacao);
  } else if (midia) {
    // ── Imagem, vídeo e PDF: o robô vê (Douglas, 03/10/2026) ───────────────
    // Grava já com a legenda; baixar e descrever vem depois (lerMidia), para o
    // webhook responder logo ao gateway.
    tipo = imagem ? "IMAGEM" : video ? "VIDEO" : "ARQUIVO";
    const icone = imagem ? "📷" : video ? "🎬" : "📎";
    const nomeDaMidia = imagem ? "Imagem" : video ? "Vídeo" : String(documento?.fileName || "Arquivo");
    const mimeType = String(midia.mimetype || (imagem ? "image/jpeg" : video ? "video/mp4" : "application/octet-stream")).split(";")[0].trim();
    const declarado = Number(typeof midia.fileLength === "object" && midia.fileLength ? midia.fileLength.low : midia.fileLength);
    const cabe = !Number.isFinite(declarado) || declarado <= TAMANHO_MAXIMO_DA_MIDIA;
    if (midiaQueOModeloLe(mimeType) && cabe) {
      leitura = {
        mimeType, legenda: texto, oQue: imagem ? "a imagem" : video ? "o vídeo" : "o arquivo",
        base64: midia.base64 || data.base64 || data.message?.base64 || null, chave: key, mensagem: data.message,
      };
    }
    texto = `${icone} ${texto || nomeDaMidia}`;
  }
  if (!texto) return;

  const nome = typeof data.pushName === "string" ? data.pushName.trim() : "";
  const contato = await silenciarSeForDaEquipe(await contatoDaConversa({ telefone, jid, nome: nome || null }), telefone);
  const gravada = await gravarMensagem({ contatoId: contato.id, waId, direcao: "ENTRADA", autor: "CLIENTE", autorNome: contato.nome || nome || null, tipo, texto });
  if (!gravada) return; // evento repetido

  if (leitura) {
    comecouALer(contato.id, gravada.id);
    void lerMidia(contato.id, gravada.id, leitura);
  }
  agendarRespostaDoRobo(contato.id);
}

/**
 * Baixa a mídia, descreve (todo texto e número visível) e regrava a mensagem
 * com "[O que a imagem mostra: …]"; os bytes ficam em memória para o robô ver
 * a imagem de verdade (midias.ts). Enquanto isto roda, o robô espera.
 */
async function lerMidia(
  contatoId: string,
  mensagemId: string,
  m: { mimeType: string; legenda: string; oQue: string; base64: string | null; chave: any; mensagem: any },
) {
  try {
    const base64 = m.base64 || (await baixarMidia(m.chave, m.mensagem));
    if (!base64 || bytesDoBase64(base64) > TAMANHO_MAXIMO_DA_MIDIA) return;
    guardarMidia(mensagemId, base64, m.mimeType);
    const descricao = await descreverMidia(base64, m.mimeType, m.legenda);
    if (!descricao) return;
    const atual = await prisma.crmMensagem.findUnique({ where: { id: mensagemId }, select: { texto: true } });
    if (atual) {
      await prisma.crmMensagem.update({ where: { id: mensagemId }, data: { texto: `${atual.texto}\n[O que ${m.oQue} mostra: ${descricao}]`.slice(0, 8000) } });
    }
  } catch (err: any) {
    console.warn(`[Atendimento] Leitura da mídia ${mensagemId} falhou: ${err?.message}`);
  } finally {
    terminouDeLer(contatoId, mensagemId);
  }
}

/**
 * Contato recém-criado que é da própria equipe (o dono ou um vendedor
 * respondendo a um aviso): nasce com o robô desligado. Só no nascimento — se o
 * dono religar o robô para esse número na tela, fica religado.
 */
async function silenciarSeForDaEquipe<C extends { id: string; roboDesligado: boolean; criadoEm: Date }>(contato: C, telefone: string | null): Promise<C> {
  if (contato.roboDesligado || Date.now() - contato.criadoEm.getTime() > 60_000) return contato;
  if (!(await numeroDaEquipe(telefone).catch(() => false))) return contato;
  await prisma.crmContato.update({ where: { id: contato.id }, data: { roboDesligado: true } });
  return { ...contato, roboDesligado: true };
}

/** Estado ao vivo, para a tela conferir sem esperar o próximo evento do gateway. */
export async function sincronizarConexao(estado: { conectado: boolean | null; telefone: string | null }) {
  if (estado.conectado === null) return configDoAtendimento();
  const config = await configDoAtendimento();
  const agora = new Date().toISOString();
  if (estado.conectado && config.conexao.conectado !== true) {
    return salvarConfigDoAtendimento({ conexao: { conectado: true, telefone: estado.telefone || config.conexao.telefone, desde: agora, desconectadoDesde: null, jaConectou: true } });
  }
  if (!estado.conectado && config.conexao.conectado !== false) {
    return salvarConfigDoAtendimento({ conexao: { ...config.conexao, conectado: false, desconectadoDesde: config.conexao.desconectadoDesde || agora } });
  }
  if (estado.conectado && estado.telefone && estado.telefone !== config.conexao.telefone) {
    return salvarConfigDoAtendimento({ conexao: { ...config.conexao, telefone: estado.telefone } });
  }
  return config;
}
