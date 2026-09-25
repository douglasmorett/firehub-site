/**
 * Prova da localização do WhatsApp no robô (lib/localizacao-do-whatsapp.ts).
 *
 *   node scripts/teste-localizacao-do-whatsapp.mjs
 *
 * O ponto do aparelho do cliente é o dado que decide a taxa de quem cobra por
 * km (Divinos Burger, modo ROTA, 25/09/2026). Até ali o gateway jogava fora a
 * mensagem de localização e o robô ficava mudo.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/localizacao-do-whatsapp.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = await import("data:text/javascript," + encodeURIComponent(js));
const {
  coordenadaValida, desembrulharMensagem, localizacaoDaMensagem, localizacaoDoPayload, textoDaLocalizacao,
  localizacaoNoTexto, semCoordenadasDaLocalizacao, localizacaoVigente, roboJaPediuLocalizacao,
  MARCA_DA_LOCALIZACAO, COMO_MANDAR_A_LOCALIZACAO,
  semLinhaDaLocalizacao, estadoDaLocalizacao, clienteIndicaOutroLugar, enderecoDasFalas, descartavelNoCooldown,
} = m;
// A régua de endereço que o robô passa de verdade (lib/entrega-do-robo.ts).
const { pareceEnderecoEscrito } = await import("data:text/javascript," + encodeURIComponent(
  ts.transpileModule(readFileSync("src/lib/entrega-do-robo.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
));
// A régua de disparo da cotação no robô (lib/chatbot-ai.ts, `addressRegex`) — a
// que derrubava a localização até 25/09/2026, com "bairro" e "km".
const REGUA_ANTIGA = /\b(rua|r\.|avenida|av\.|bairro|estrada|est\.|alameda|travessa|praça|praca|rodovia|rod\.|quadra|qd|lote|lt|condomínio|condominio|loteamento|km)\b|\b(we|sn)\s*-?\s*\d{1,4}\b/i;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

// Um ponto real na área da Divinos (Cabo Frio), com a miniatura que o WhatsApp manda.
const LAT = -22.8795123, LNG = -42.0190456;
const locationMessage = {
  degreesLatitude: LAT,
  degreesLongitude: LNG,
  name: "Padaria Central",
  address: "Rua Itajuru, 120 - Centro, Cabo Frio",
  jpegThumbnail: { type: "Buffer", data: [255, 216, 255] },
};

console.log("\n1) Coordenada válida");
conferir("ponto normal", coordenadaValida(LAT, LNG));
conferir("texto numérico", coordenadaValida("-22.87", "-42.01"));
conferir("(0,0) é 'não sei'", !coordenadaValida(0, 0));
conferir("fora do globo", !coordenadaValida(91, 10) && !coordenadaValida(10, 181));
conferir("vazio/nulo/NaN", !coordenadaValida("", "") && !coordenadaValida(null, 1) && !coordenadaValida(NaN, 1) && !coordenadaValida({}, 1));

console.log("\n2) Lendo a mensagem do WhatsApp");
{
  const loc = localizacaoDaMensagem({ locationMessage });
  conferir("locationMessage", loc && loc.lat === LAT && loc.lng === LNG && loc.nome === "Padaria Central" && loc.endereco.startsWith("Rua Itajuru"), loc);
  conferir("sem miniatura no resultado", loc && !("jpegThumbnail" in loc));
  const temp = localizacaoDaMensagem({ ephemeralMessage: { message: { locationMessage } } });
  conferir("dentro de mensagem temporária", temp && temp.lat === LAT, temp);
  const unica = localizacaoDaMensagem({ viewOnceMessageV2: { message: { locationMessage } } });
  conferir("dentro de visualização única", unica && unica.lng === LNG, unica);
  const vivo = localizacaoDaMensagem({ liveLocationMessage: { degreesLatitude: LAT, degreesLongitude: LNG } });
  conferir("localização em tempo real", vivo && vivo.aoVivo === true, vivo);
  conferir("texto comum não é localização", localizacaoDaMensagem({ conversation: "oi" }) === null);
  conferir("localização (0,0) é descartada", localizacaoDaMensagem({ locationMessage: { degreesLatitude: 0, degreesLongitude: 0 } }) === null);
  conferir("mensagem nula não explode", localizacaoDaMensagem(null) === null && localizacaoDaMensagem(undefined) === null);
  conferir("desembrulhar texto temporário", desembrulharMensagem({ ephemeralMessage: { message: { conversation: "quero 2" } } }).conversation === "quero 2");
  const quebra = localizacaoDaMensagem({ locationMessage: { ...locationMessage, name: "Casa (fundos)\nportão azul" } });
  conferir("nome com parêntese e quebra de linha fica numa linha só", quebra && !/[()\n]/.test(quebra.nome), quebra);
}

console.log("\n3) O payload do webhook");
{
  const doGateway = localizacaoDoPayload({ localizacao: { lat: LAT, lng: LNG, endereco: "Rua X, 10" }, message: {} });
  conferir("campo pronto do gateway FireHub", doGateway && doGateway.lat === LAT && doGateway.endereco === "Rua X, 10", doGateway);
  const daEvolution = localizacaoDoPayload({ message: { locationMessage } });
  conferir("mensagem crua (Evolution oficial)", daEvolution && daEvolution.lng === LNG, daEvolution);
  const lixo = localizacaoDoPayload({ localizacao: { lat: "abc", lng: 1 }, message: { locationMessage } });
  conferir("campo pronto inválido cai na mensagem", lixo && lixo.lat === LAT, lixo);
  conferir("sem localização", localizacaoDoPayload({ message: { conversation: "oi" } }) === null && localizacaoDoPayload(null) === null);
}

console.log("\n4) A linha na conversa, ida e volta");
{
  const loc = localizacaoDaMensagem({ locationMessage });
  const linha = textoDaLocalizacao(loc);
  conferir("começa pela marca", linha.startsWith(MARCA_DA_LOCALIZACAO), linha);
  conferir("seis casas decimais", linha.includes("-22.879512, -42.019046"), linha);
  const volta = localizacaoNoTexto(linha);
  conferir("lida de volta com o mesmo ponto (~11 cm)", volta && Math.abs(volta.lat - LAT) < 1e-6 && Math.abs(volta.lng - LNG) < 1e-6, volta);
  conferir("lida de volta com nome e endereço", volta && volta.nome === "Padaria Central" && volta.endereco === "Rua Itajuru, 120 - Centro, Cabo Frio", volta);
  const soPonto = localizacaoNoTexto(textoDaLocalizacao({ lat: LAT, lng: LNG }));
  conferir("sem nome nem endereço", soPonto && soPonto.lat.toFixed(6) === LAT.toFixed(6) && !soPonto.nome, soPonto);
  const noMeio = localizacaoNoTexto(`oi\n${textoDaLocalizacao({ lat: LAT, lng: LNG, aoVivo: true })}\nobrigado`);
  conferir("linha no meio de outro texto", noMeio && noMeio.lng.toFixed(6) === LNG.toFixed(6), noMeio);
  conferir("texto qualquer com números não vira localização", localizacaoNoTexto("moro na rua 7, -22 graus lá fora") === null);
  conferir("não-string", localizacaoNoTexto(undefined) === null && localizacaoNoTexto(42) === null);
  const limpo = semCoordenadasDaLocalizacao(`rua itajuru 120 ${linha}`);
  conferir("sem as coordenadas, fica o endereço que o WhatsApp mandou", !/-22\.8/.test(limpo) && limpo.includes("Rua Itajuru, 120") && limpo.startsWith("rua itajuru 120"), limpo);
  conferir("sem coordenadas e sem detalhes vira vazio", semCoordenadasDaLocalizacao(textoDaLocalizacao({ lat: LAT, lng: LNG })) === "");
}

console.log("\n5) Qual localização vale agora");
{
  const pareceEndereco = (t) => /\b(rua|avenida|av\.|travessa|estrada)\b/i.test(t);
  // A linha guarda 6 casas: a volta compara nessa precisão (~11 cm).
  const eh = (loc) => Boolean(loc) && loc.lat.toFixed(6) === LAT.toFixed(6) && loc.lng.toFixed(6) === LNG.toFixed(6);
  const linha = textoDaLocalizacao({ lat: LAT, lng: LNG });
  const outra = textoDaLocalizacao({ lat: -22.9, lng: -42.05 });

  conferir("a desta mensagem", eh(localizacaoVigente([], linha, pareceEndereco)));
  conferir("a do histórico, quando a mensagem é 'pode fechar'",
    eh(localizacaoVigente([{ sender: "user", text: "quero 2 x-tudo" }, { sender: "user", text: linha }, { sender: "bot", text: "Anotado!" }], "pode fechar", pareceEndereco)));
  conferir("a MAIS RECENTE de duas",
    localizacaoVigente([{ sender: "user", text: linha }, { sender: "user", text: outra }], "ok", pareceEndereco)?.lat === -22.9);
  conferir("'na verdade entrega na Rua X' DEPOIS derruba a localização (é outro lugar)",
    localizacaoVigente([{ sender: "user", text: linha }], "na verdade entrega na Rua das Flores, 20", pareceEndereco) === null);
  conferir("endereço digitado ANTES não derruba",
    eh(localizacaoVigente([{ sender: "user", text: "Rua das Flores, 20" }, { sender: "user", text: linha }], "isso", pareceEndereco)));
  conferir("fala do robô não é o ponto de ninguém",
    localizacaoVigente([{ sender: "bot", text: linha }], "ok", pareceEndereco) === null);
  conferir("sem histórico nem localização", localizacaoVigente(null, "oi", pareceEndereco) === null);
}

console.log("\n5b) Localização → o robô pede a rua → o cliente digita a rua (revisão de 25/09/2026)");
{
  const eh = (loc) => Boolean(loc) && loc.lat.toFixed(6) === (-22.854031).toFixed(6) && loc.lng.toFixed(6) === (-42.029652).toFixed(6);
  const linha = textoDaLocalizacao({ lat: -22.854031, lng: -42.029652 });
  const conversa = [
    { sender: "user", text: "Travessa Canaã 6, Boca do Mato" },
    { sender: "bot", text: `Não achei esse endereço no mapa 🗺️ Me manda sua localização? ${COMO_MANDAR_A_LOCALIZACAO}` },
    { sender: "user", text: linha },
    { sender: "bot", text: "Recebi sua localização! Me confirma a rua, o número e um ponto de referência pro entregador?" },
  ];
  const rua = "Travessa Canaã, 6 - Boca do Mato";
  const e1 = estadoDaLocalizacao(conversa, rua, pareceEnderecoEscrito);
  conferir("a rua digitada DEPOIS não derruba a localização (é o complemento que o robô pediu)", eh(e1.localizacao) && !e1.descartadaPeloCliente, e1);
  conferir("… e volta como 'endereço digitado depois', para o mapa conferir a distância", e1.localizacao?.enderecoDigitadoDepois === rua, e1.localizacao);
  const e2 = estadoDaLocalizacao([...conversa, { sender: "user", text: rua }, { sender: "bot", text: "Anotado! Pagamento?" }], "pix", pareceEnderecoEscrito);
  conferir("continua valendo nas mensagens seguintes ('pix')", eh(e2.localizacao) && e2.localizacao.enderecoDigitadoDepois === rua, e2);
  conferir("a MESMA rua pela régua antiga também não derruba mais (a régua só junta o texto)",
    eh(localizacaoVigente(conversa, rua, (t) => REGUA_ANTIGA.test(t))));
  conferir("'vcs entregam no meu bairro?' não derruba", eh(localizacaoVigente([{ sender: "user", text: linha }], "vcs entregam no meu bairro?", (t) => REGUA_ANTIGA.test(t))));
  conferir("'quantos km dá?' não derruba nem vira endereço", (() => {
    const e = estadoDaLocalizacao([{ sender: "user", text: linha }], "quantos km dá?", pareceEnderecoEscrito);
    return eh(e.localizacao) && !e.localizacao.enderecoDigitadoDepois;
  })());
  const complemento = estadoDaLocalizacao([{ sender: "user", text: linha }], "Rua das Palmeiras, 45, casa 2, Jardim Excelsior", pareceEnderecoEscrito);
  conferir("rua + número + casa + bairro depois do ponto: ponto mantido, texto guardado",
    eh(complemento.localizacao) && complemento.localizacao.enderecoDigitadoDepois === "Rua das Palmeiras, 45, casa 2, Jardim Excelsior", complemento);
  const semTipo = estadoDaLocalizacao([{ sender: "user", text: linha }], "entrega no Jardim Esperança, 45, casa da minha mãe", pareceEnderecoEscrito);
  conferir("endereço SEM tipo de rua ('Jardim Esperança, 45') também volta para conferir no mapa",
    eh(semTipo.localizacao) && /Jardim Esperança, 45/.test(semTipo.localizacao.enderecoDigitadoDepois || ""), semTipo);
  const mae = estadoDaLocalizacao([{ sender: "user", text: linha }], "na verdade entrega no Jardim Esperança, 45, casa da minha mãe", pareceEnderecoEscrito);
  conferir("'na verdade entrega no …' descarta o ponto e marca que foi o cliente", mae.localizacao === null && mae.descartadaPeloCliente === true, mae);
  const outraDepois = estadoDaLocalizacao(
    [{ sender: "user", text: linha }, { sender: "user", text: "é em outro endereço" }, { sender: "user", text: textoDaLocalizacao({ lat: -22.9, lng: -42.05 }) }],
    "ok", pareceEnderecoEscrito);
  conferir("disse 'outro endereço' e mandou a localização NOVA: vale a nova", outraDepois.localizacao?.lat === -22.9 && !outraDepois.descartadaPeloCliente, outraDepois);
  const duas = estadoDaLocalizacao([{ sender: "user", text: linha }, { sender: "user", text: "Rua A, 10" }], "Rua B, 20", pareceEnderecoEscrito);
  conferir("duas ruas digitadas depois: vale a última (não junta as duas)", duas.localizacao?.enderecoDigitadoDepois === "Rua B, 20", duas.localizacao);
}

console.log("\n5c) O cliente está dizendo que é OUTRO lugar?");
{
  for (const t of [
    "na verdade entrega no Jardim Esperança, 45",
    "na verdade é pra entregar na casa da minha mãe",
    "é em outro endereço",
    "vou pedir pra outro lugar",
    "endereço diferente: Rua X, 10",
    "mudei de endereço",
    "a localização está errada",
    "mandei a localização errada",
    "não é aí não, é na Rua Y",
    "Não é essa localização",
  ]) conferir(`sim: "${t}"`, clienteIndicaOutroLugar(t));
  for (const t of [
    "Travessa Canaã, 6 - Boca do Mato",
    "casa da minha mãe, portão azul",
    "na verdade é o número 45",
    "é a outra casa do terreno, a dos fundos",
    "a entrada é pela outra rua",
    "vou mandar outra localização",
    "não é aquilo que eu pedi",
    "",
  ]) conferir(`não: "${t}"`, !clienteIndicaOutroLugar(t));
}

console.log("\n5d) O endereço a partir das falas");
conferir("a mais recente com rua", enderecoDasFalas(["Rua A, 10", "Rua B, 20"]) === "Rua B, 20");
conferir("bairro mandado depois da rua é juntado", enderecoDasFalas(["Rua A, 10", "bairro Centro"]) === "Rua A, 10 bairro Centro");
conferir("sem rua em nenhuma: as duas últimas", enderecoDasFalas(["Jardim Esperança, 45"]) === "Jardim Esperança, 45");
conferir("pergunta sem rua depois do endereço não entra na junção",
  enderecoDasFalas(["Rua A, 10", "vcs entregam no meu bairro?"]) === "Rua A, 10");
conferir("só a pergunta: fica ela (é o que o cliente escreveu)", enderecoDasFalas(["vcs entregam no meu bairro?"]) === "vcs entregam no meu bairro?");
conferir("vazio", enderecoDasFalas([]) === "" && enderecoDasFalas(["", "  "]) === "");

console.log("\n5e) O que o cliente digitou, sem a linha da localização");
{
  const comNome = textoDaLocalizacao({ lat: -22.874512, lng: -42.018733, nome: "Suporte Técnico Informática", endereco: "R. das Palmeiras, 45" });
  conferir("a linha inteira sai, com o nome do lugar (texto de terceiros)", semLinhaDaLocalizacao(comNome) === "", semLinhaDaLocalizacao(comNome));
  conferir("em tempo real também", semLinhaDaLocalizacao(textoDaLocalizacao({ lat: LAT, lng: LNG, aoVivo: true })) === "");
  conferir("o texto digitado em volta fica", semLinhaDaLocalizacao(`oi ${comNome} quero falar com atendente`) === "oi quero falar com atendente");
  conferir("texto sem localização passa igual", semLinhaDaLocalizacao("Rua X, 10") === "Rua X, 10" && semLinhaDaLocalizacao(undefined) === "");

  // Os detectores do webhook, sobre o que eles leem de verdade.
  const carregar = async (arquivo) => import("data:text/javascript," + encodeURIComponent(
    ts.transpileModule(readFileSync(arquivo, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
  ));
  const { detectarPedidoDeAtendente } = await carregar("src/lib/pedido-de-atendente.ts");
  const { detectarProblemaNoPedido } = await carregar("src/lib/problema-no-pedido.ts");
  conferir("(a linha crua casava com 'suporte' — o defeito)", detectarPedidoDeAtendente(comNome).pediu === true);
  conferir("a localização da 'Suporte Técnico Informática' NÃO é pedido de atendente", detectarPedidoDeAtendente(semLinhaDaLocalizacao(comNome)).pediu === false);
  conferir("… nem reclamação", detectarProblemaNoPedido(semLinhaDaLocalizacao(textoDaLocalizacao({ lat: LAT, lng: LNG, nome: "Loja Atrasado Reclamações" })), []).escalar === false);
  conferir("o cliente que DIGITA 'quero falar com atendente' continua sendo ouvido",
    detectarPedidoDeAtendente(semLinhaDaLocalizacao("quero falar com atendente")).pediu === true);
}

console.log("\n5f) O cooldown do webhook não descarta a localização");
conferir("texto 2 s depois da resposta: descartado (como antes)", descartavelNoCooldown({ msDesdeAUltimaResposta: 2000, temLocalizacao: false, pediuAtendente: false }));
conferir("LOCALIZAÇÃO 2 s depois da resposta: NÃO é descartada", !descartavelNoCooldown({ msDesdeAUltimaResposta: 2000, temLocalizacao: true, pediuAtendente: false }));
conferir("pedido de atendente 2 s depois: NÃO é descartado", !descartavelNoCooldown({ msDesdeAUltimaResposta: 2000, temLocalizacao: false, pediuAtendente: true }));
conferir("fora da janela de 3 s: nada é descartado", !descartavelNoCooldown({ msDesdeAUltimaResposta: 3000, temLocalizacao: false, pediuAtendente: false }));

console.log("\n6) O robô já PEDIU a localização?");
{
  conferir("a frase fixa do sistema", roboJaPediuLocalizacao([{ sender: "bot", text: `Me manda sua localização por aqui? ${COMO_MANDAR_A_LOCALIZACAO}` }]));
  conferir("o modelo reescrevendo o caminho: 'toca no 📎 e escolhe Localização'", roboJaPediuLocalizacao([{ sender: "bot", text: "toca no 📎 e escolhe Localização" }]));
  conferir("'clipe → Localização'", roboJaPediuLocalizacao([{ sender: "bot", text: "Manda por aqui: clipe → Localização → Enviar" }]));
  // Revisão de 25/09/2026: ofertas e menções não são o pedido que a trava conta.
  conferir("a OFERTA da regra 18a NÃO conta como pedido",
    !roboJaPediuLocalizacao([{ sender: "bot", text: "A nossa taxa de entrega é calculada conforme o seu endereço. Me passa a rua, o número e o bairro (ou manda sua localização pelo 📎) que eu vejo o valor certinho pra você? 😊" }]));
  conferir("'quer que eu te envie a localização da loja?' NÃO conta", !roboJaPediuLocalizacao([{ sender: "bot", text: "Quer que eu te envie a localização da loja?" }]));
  conferir("'posso te mandar a localização da loja no mapa' NÃO conta", !roboJaPediuLocalizacao([{ sender: "bot", text: "Posso te mandar a localização da loja no mapa" }]));
  conferir("pedido com outras palavras, sem o caminho do clipe, não conta (a gravação pede uma vez, com a frase fixa)",
    !roboJaPediuLocalizacao([{ sender: "bot", text: "Pode compartilhar a sua localização comigo?" }]) &&
    !roboJaPediuLocalizacao([{ sender: "bot", text: "Envia a localização pelo clipe, por favor" }]));
  conferir("o CLIENTE falando de localização não conta", !roboJaPediuLocalizacao([{ sender: "user", text: `vou te mandar a localização ${COMO_MANDAR_A_LOCALIZACAO}` }]));
  conferir("robô falando da localização DA LOJA não conta como pedido", !roboJaPediuLocalizacao([{ sender: "bot", text: "Nossa localização é Rua X, 10, Centro" }]));
  conferir("histórico vazio", !roboJaPediuLocalizacao([]) && !roboJaPediuLocalizacao(undefined));
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
