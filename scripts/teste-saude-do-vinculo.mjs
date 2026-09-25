/**
 * Prova da saúde do vínculo no gateway do WhatsApp (whatsapp-gateway/saude-do-vinculo.js).
 *
 *   node scripts/teste-saude-do-vinculo.mjs
 *
 * O caso real (Divinos Burger, 24–25/09/2026): painel "conectado", log dizendo
 * "enviada com sucesso", e 100% dos destinatários pedindo retransmissão — 431
 * pedidos de 12 contatos, contra no máximo 2 por dia nas outras 6 lojas. A
 * conta tinha um aparelho HOSPEDADO (:99, API oficial em coexistência) e, na
 * terça, o robô tinha sido pareado com o WhatsApp PESSOAL do dono ("iphone").
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const saude = require("../whatsapp-gateway/saude-do-vinculo.js");
const {
  decodificarJid, mascararJid, conversaVaiParaOWebhook, desembrulharMensagem, localizacaoDaMensagem,
  mensagemParaOWebhook, descreverMensagemSemConteudo, classificarPlataforma, descreverAparelhoDaPropriaConta,
  resumirAparelhos, criarMonitorDoVinculo, JANELA_DO_ALARME_MS, LIMITE_DE_CONTATOS,
} = saude;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

const INST = "firehub_010pmo1e0w";
const T0 = Date.UTC(2026, 8, 25, 0, 0, 0);
const MIN = 60 * 1000;

console.log("\n1) Endereços");
{
  const d = decodificarJid("36704874438867:99@lid");
  conferir("aparelho 99 do LID", d.usuario === "36704874438867" && d.dispositivo === 99 && d.servidor === "lid", d);
  const t = decodificarJid("5522997905262:25@s.whatsapp.net");
  conferir("aparelho do robô (:25)", t.usuario === "5522997905262" && t.dispositivo === 25, t);
  const sem = decodificarJid("5522997905262@s.whatsapp.net");
  conferir("sem aparelho = null", sem.dispositivo === null, sem);
  conferir("vazio não explode", decodificarJid(undefined).usuario === "" && decodificarJid(null).dispositivo === null);
  conferir("máscara mostra só o final", mascararJid("5522997905262:25@s.whatsapp.net") === "…5262:25@s.whatsapp.net", mascararJid("5522997905262:25@s.whatsapp.net"));
  conferir("máscara de LID", mascararJid("198964645236955@lid") === "…6955@lid");
}

console.log("\n2) O que vai ao webhook");
conferir("cliente 1:1 vai", conversaVaiParaOWebhook("5522999999999@s.whatsapp.net") && conversaVaiParaOWebhook("220104809820350@lid"));
conferir("status NÃO vai (201 em 7 h na Divinos)", !conversaVaiParaOWebhook("status@broadcast"));
conferir("canal NÃO vai", !conversaVaiParaOWebhook("120363172867223601@newsletter"));
conferir("grupo NÃO vai", !conversaVaiParaOWebhook("120363043211234567@g.us"));
conferir("lista de transmissão NÃO vai", !conversaVaiParaOWebhook("5522999999999@broadcast"));
conferir("maiúscula não fura", !conversaVaiParaOWebhook("STATUS@BROADCAST") && !conversaVaiParaOWebhook("1203@NEWSLETTER"));
conferir("vazio não vai", !conversaVaiParaOWebhook("") && !conversaVaiParaOWebhook(undefined));

console.log("\n3) Localização e envelopes");
{
  const msg = {
    ephemeralMessage: {
      message: {
        locationMessage: {
          degreesLatitude: -22.8795, degreesLongitude: -42.019, name: "Casa", address: "Rua X, 10",
          jpegThumbnail: Buffer.from([255, 216, 255, 224]),
        },
      },
    },
  };
  const loc = localizacaoDaMensagem(msg);
  conferir("localização dentro de mensagem temporária", loc && loc.lat === -22.8795 && loc.lng === -42.019 && loc.nome === "Casa" && loc.endereco === "Rua X, 10", loc);
  conferir("sem coordenada válida = null", localizacaoDaMensagem({ locationMessage: { degreesLatitude: 0, degreesLongitude: 0 } }) === null);
  conferir("texto não é localização", localizacaoDaMensagem({ conversation: "oi" }) === null);
  const ao = localizacaoDaMensagem({ liveLocationMessage: { degreesLatitude: -22.8, degreesLongitude: -42.0 } });
  conferir("tempo real", ao && ao.aoVivo === true, ao);

  const conteudo = desembrulharMensagem(msg);
  const paraOWebhook = mensagemParaOWebhook(conteudo);
  conferir("sem miniatura (Buffer) no POST", paraOWebhook.locationMessage && !("jpegThumbnail" in paraOWebhook.locationMessage), paraOWebhook);
  conferir("coordenadas preservadas no POST", paraOWebhook.locationMessage.degreesLatitude === -22.8795);
  conferir("a mensagem original não é alterada", Buffer.isBuffer(msg.ephemeralMessage.message.locationMessage.jpegThumbnail));
  const embrulhada = mensagemParaOWebhook(msg);
  conferir("miniatura sai também de dentro do envelope", !("jpegThumbnail" in embrulhada.ephemeralMessage.message.locationMessage));
  conferir("texto temporário desembrulhado", desembrulharMensagem({ ephemeralMessage: { message: { extendedTextMessage: { text: "quero 2" } } } }).extendedTextMessage.text === "quero 2");
  conferir("mensagem comum passa inteira", desembrulharMensagem({ conversation: "oi" }).conversation === "oi");
}

console.log("\n4) Mensagem que chegou sem conteúdo (não decifrou)");
{
  const stub = descreverMensagemSemConteudo(INST, {
    key: { remoteJid: "5522992090207@s.whatsapp.net", fromMe: false, id: "ABC" },
    messageStubType: 2,
    messageStubParameters: ["No session record"],
  });
  conferir("é cifrada (CIPHERTEXT = 2)", stub.ehCifrada === true, stub);
  conferir("a linha traz a instância e o motivo", stub.linha.includes(INST) && stub.linha.includes("No session record") && stub.linha.includes("NÃO DECIFROU"), stub.linha);
  conferir("a linha não expõe o telefone inteiro", !stub.linha.includes("5522992090207") && stub.linha.includes("…0207"), stub.linha);
  const outro = descreverMensagemSemConteudo(INST, { key: { remoteJid: "x@s.whatsapp.net" }, messageStubType: 20 });
  conferir("outro stub não é contado como cifrada", outro.ehCifrada === false, outro);
}

console.log("\n5) Plataforma do pareamento e aparelhos da conta");
conferir("smba = WhatsApp Business Android", classificarPlataforma("smba") === "business");
conferir("smbi = WhatsApp Business iPhone", classificarPlataforma("smbi") === "business");
conferir("iphone = WhatsApp PESSOAL (o vínculo de 22/09)", classificarPlataforma("iphone") === "pessoal");
conferir("android = WhatsApp pessoal", classificarPlataforma("ANDROID") === "pessoal");
conferir("desconhecida não acusa", classificarPlataforma(undefined) === "desconhecida" && classificarPlataforma("xyz") === "desconhecida");
conferir("device 99 descrito como aparelho HOSPEDADO, não como o celular",
  /HOSPEDADO/.test(descreverAparelhoDaPropriaConta(99)) && !/CELULAR/.test(descreverAparelhoDaPropriaConta(99)));
conferir("device 0 é o celular", /CELULAR/.test(descreverAparelhoDaPropriaConta(0)));
conferir("device 26 é outro aparelho vinculado", /:26/.test(descreverAparelhoDaPropriaConta(26)));
{
  const r = resumirAparelhos([{ id: 0, keyIndex: 0 }, { id: 25, keyIndex: 3 }, { id: 26, keyIndex: 4 }, { id: 99, keyIndex: 5 }]);
  conferir("lista da Divinos: 4 aparelhos, com hospedado", r.total === 4 && r.hospedado === true && r.ids.join(",") === "0,25,26,99", r);
  const flag = resumirAparelhos([{ id: 0 }, { id: 7, isHosted: true }]);
  conferir("is_hosted marcado pelo servidor também conta", flag.hospedado === true, flag);
  const sadia = resumirAparelhos([{ id: 0 }, { id: 25 }]);
  conferir("conta sem hospedado", sadia.hospedado === false && sadia.total === 2, sadia);
  conferir("lista ausente", resumirAparelhos(undefined).total === 0);
}

console.log("\n6) O alarme: contatos EXTERNOS distintos pedindo retransmissão");
{
  conferir(`limite é mais de ${LIMITE_DE_CONTATOS} em ${JANELA_DO_ALARME_MS / MIN} min`, LIMITE_DE_CONTATOS === 3 && JANELA_DO_ALARME_MS === 60 * MIN);
  const mon = criarMonitorDoVinculo();
  const ext = (n) => ({ contato: `55229900000${n}`, ehPropriaConta: false, dispositivo: 0 });

  let r = mon.registrarRetransmissao(INST, ext(1), T0);
  conferir("1 contato: sadio", r.estado.vinculoDoente === false && r.mudou === false, r);
  // O mesmo contato pedindo dez vezes é problema DELE, não do vínculo.
  for (let i = 0; i < 10; i++) r = mon.registrarRetransmissao(INST, ext(1), T0 + i * 1000);
  conferir("1 contato pedindo 10 vezes: sadio", r.estado.vinculoDoente === false && r.estado.contatosQueNaoLeram === 1, r.estado);
  mon.registrarRetransmissao(INST, ext(2), T0 + 5 * MIN);
  r = mon.registrarRetransmissao(INST, ext(3), T0 + 10 * MIN);
  conferir("3 contatos: ainda sadio (limite é MAIS que 3)", r.estado.vinculoDoente === false && r.estado.contatosQueNaoLeram === 3, r.estado);
  r = mon.registrarRetransmissao(INST, ext(4), T0 + 15 * MIN);
  conferir("4º contato distinto em 1 h: DOENTE, e o estado MUDOU", r.estado.vinculoDoente === true && r.mudou === true, r);
  conferir("motivo diz o que fazer", /4 contatos diferentes/.test(r.estado.motivo) && /Aguardando mensagem/.test(r.estado.motivo), r.estado.motivo);
  r = mon.registrarRetransmissao(INST, ext(5), T0 + 16 * MIN);
  conferir("5º: continua doente, mas não 'muda' de novo (sem aviso repetido)", r.estado.vinculoDoente === true && r.mudou === false, r);

  // A PRÓPRIA conta não entra na conta dos contatos externos.
  const mon2 = criarMonitorDoVinculo();
  for (let i = 0; i < 50; i++) mon2.registrarRetransmissao(INST, { contato: "36704874438867", ehPropriaConta: true, dispositivo: 0 }, T0 + i * 1000);
  const e2 = mon2.estado(INST, T0 + MIN);
  conferir("50 pedidos da própria conta não disparam o alarme de contatos", e2.vinculoDoente === false && e2.pedidosDaPropriaConta === 50, e2);

  // A janela anda: depois de uma hora sem pedidos, o vínculo volta a sadio.
  const depois = mon.estado(INST, T0 + 16 * MIN + JANELA_DO_ALARME_MS + 1);
  conferir("uma hora depois, sadio de novo", depois.vinculoDoente === false && depois.contatosQueNaoLeram === 0, depois);
  const volta = mon.registrarRetransmissao(INST, ext(9), T0 + 16 * MIN + JANELA_DO_ALARME_MS + 2);
  conferir("a volta ao sadio é MUDANÇA (avisa o FireHub uma vez)", volta.mudou === true && volta.estado.vinculoDoente === false, volta);

  // Sem pedido novo, só o tempo passando: a VARREDURA anuncia a volta, uma vez.
  const mon4 = criarMonitorDoVinculo();
  for (let i = 1; i <= 4; i++) mon4.registrarRetransmissao(INST, ext(i), T0 + i * MIN);
  conferir("varredura dentro da hora: nada mudou", mon4.varrer(T0 + 30 * MIN).length === 0);
  const sarou = mon4.varrer(T0 + 4 * MIN + JANELA_DO_ALARME_MS + 1);
  conferir("varredura depois da hora: a loja sarou e é anunciada", sarou.length === 1 && sarou[0].instancia === INST && sarou[0].estado.vinculoDoente === false, sarou);
  conferir("e só uma vez", mon4.varrer(T0 + 4 * MIN + JANELA_DO_ALARME_MS + 2).length === 0);

  // Por instância: a doença de uma loja não contamina a outra.
  const mon3 = criarMonitorDoVinculo();
  for (let i = 1; i <= 5; i++) mon3.registrarRetransmissao(INST, ext(i), T0 + i);
  conferir("outra loja segue sadia", mon3.estado(INST, T0 + 10).vinculoDoente === true && mon3.estado("firehub_outra", T0 + 10).vinculoDoente === false);
  mon3.esquecer(INST);
  conferir("logout/reset esquece o vínculo anterior", mon3.estado(INST, T0 + 20).vinculoDoente === false && mon3.instancias().length === 0);
}

console.log("\n7) Avisos do aparelho");
{
  const mon = criarMonitorDoVinculo();
  // O :99 aparece primeiro nos pedidos de retransmissão da própria conta.
  const primeira = mon.registrarRetransmissao(INST, { contato: "36704874438867", ehPropriaConta: true, dispositivo: 99 }, T0);
  conferir("a descoberta do hospedado é anunciada (uma vez)", primeira.mudou === true && primeira.achouHospedado === true, primeira);
  const segunda = mon.registrarRetransmissao(INST, { contato: "36704874438867", ehPropriaConta: true, dispositivo: 99 }, T0 + 5);
  conferir("o segundo pedido do :99 não anuncia de novo", segunda.mudou === false && segunda.achouHospedado === false, segunda);
  const doCelular = criarMonitorDoVinculo().registrarRetransmissao(INST, { contato: "36704874438867", ehPropriaConta: true, dispositivo: 0 }, T0);
  conferir("o celular da loja (:0) não é 'hospedado'", doCelular.mudou === false && doCelular.estado.aparelhoHospedado === false, doCelular);
  const jaSabido = criarMonitorDoVinculo();
  jaSabido.registrarAparelho(INST, { deviceList: [{ id: 0 }, { id: 99 }] });
  conferir("hospedado já visto na lista de aparelhos não é anunciado de novo pelo retry",
    jaSabido.registrarRetransmissao(INST, { contato: "36704874438867", ehPropriaConta: true, dispositivo: 99 }, T0).mudou === false);
  let e = mon.estado(INST, T0 + 1);
  conferir("retransmissão do :99 revela o aparelho hospedado", e.aparelhoHospedado === true && e.avisos.some((a) => a.tipo === "aparelho-hospedado"), e);
  conferir("hospedado não é 'vínculo doente' de contatos", e.vinculoDoente === false);

  const mon2 = criarMonitorDoVinculo();
  e = mon2.registrarAparelho(INST, { plataforma: "iphone", aparelhoId: 4 });
  conferir("pareado com WhatsApp pessoal: aviso", e.tipoDePlataforma === "pessoal" && e.avisos.some((a) => a.tipo === "numero-pessoal" && /iphone/.test(a.mensagem)), e);
  conferir("id do aparelho do robô guardado", e.aparelhoId === 4);
  e = mon2.registrarAparelho(INST, { plataforma: "smba", aparelhoId: 25 });
  conferir("religado pelo Business: sem aviso de número pessoal", e.tipoDePlataforma === "business" && e.avisos.length === 0, e);
  e = mon2.registrarAparelho(INST, { deviceList: [{ id: 0 }, { id: 25 }, { id: 99 }] });
  conferir("lista de aparelhos com :99 acende o aviso de hospedado", e.aparelhoHospedado === true && e.aparelhosDaConta.total === 3, e);
  conferir("estado não expõe telefone nenhum", !JSON.stringify(e).match(/55\d{10,11}/));
  conferir("instância desconhecida: estado vazio e sadio", mon2.estado("firehub_nada").vinculoDoente === false && mon2.estado("firehub_nada").avisos.length === 0);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
