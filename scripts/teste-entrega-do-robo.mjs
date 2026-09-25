/**
 * Prova das regras de entrega do ROBÔ (lib/entrega-do-robo.ts).
 *
 *   node scripts/teste-entrega-do-robo.mjs
 *
 * Loja de referência: Divinos Burger (Cabo Frio, modo ROTA). Tabela real
 * (km de rua, taxa ao cliente • repasse ao motoboy): 1 km R$5•4; 1,5 R$8•7;
 * 2 R$10•9; 2,5 R$12•11; 3 R$15•14; 3,5 R$17•16; 4 R$18•17; 4,5 R$19•18;
 * 5 R$20•19.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/entrega-do-robo.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  minimoDoFreteGratis, freteGratisQueVale, pontoParaGravar, pontoDoClienteGravado, mesmoEnderecoDeEntrega,
  motivoParaPedirLocalizacao, avisosDaEntregaNaNota, partesDoEnderecoDaTag, frasesDaDistancia,
  faltaOPontoDaLoja, pontoDaEntregaDoRobo, avaliarEntregaDoRobo, partesDoEnderecoDigitado, pareceEnderecoEscrito,
  enderecoDaLocalizacaoDoCliente, ehEnderecoDaLocalizacao, levaEnderecoDaLocalizacao, DISTANCIA_QUE_TROCA_O_PONTO_KM,
} = await import("data:text/javascript," + encodeURIComponent(js));
const { tipoDoPedidoDoRobo } = await import("data:text/javascript," + encodeURIComponent(
  ts.transpileModule(readFileSync("src/lib/tipo-do-pedido-do-robo.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

const GPS = { lat: -22.8795, lng: -42.019 };

console.log("\n1) Frete grátis com a régua do SITE (freeShippingActive === true)");
conferir("ligado + mínimo", minimoDoFreteGratis({ freeShippingActive: true, freeShippingMinValue: 60 }) === 60);
conferir("ligado como texto 'true' (o site aceita)", minimoDoFreteGratis({ freeShippingActive: "true", freeShippingMinValue: "60.00" }) === 60);
conferir("SEM o interruptor: o 60,00 de padrão da tela NÃO vale (o bug do prompt)",
  minimoDoFreteGratis({ freeShippingMinValue: 60 }) === null);
conferir("desligado", minimoDoFreteGratis({ freeShippingActive: false, freeShippingMinValue: 60 }) === null);
conferir("ligado com mínimo zero ou lixo = sem frete grátis",
  minimoDoFreteGratis({ freeShippingActive: true, freeShippingMinValue: 0 }) === null &&
  minimoDoFreteGratis({ freeShippingActive: true, freeShippingMinValue: "abc" }) === null);
conferir("config ausente", minimoDoFreteGratis(null) === null && minimoDoFreteGratis(undefined) === null);
conferir("o campo antigo freeDeliveryMinValue não vale (o site não lê)",
  minimoDoFreteGratis({ freeShippingActive: true, freeDeliveryMinValue: 50 }) === null);
conferir("subtotal alcança o mínimo (igual vale)", freteGratisQueVale({ freeShippingActive: true, freeShippingMinValue: 60 }, 60) === 60);
conferir("subtotal abaixo não ganha", freteGratisQueVale({ freeShippingActive: true, freeShippingMinValue: 60 }, 59.99) === null);

console.log("\n2) O ponto que vai gravado no pedido");
{
  const doMotor = pontoParaGravar({ resultado: "ATENDE", ponto: { lat: -22.88, lng: -42.02, origem: "mapa" }, medida: "rota" }, null);
  conferir("o ponto do veredito, com origem e medida", doMotor && doMotor.lat === -22.88 && doMotor.origem === "mapa" && doMotor.medida === "rota", doMotor);
  const estimado = pontoParaGravar({ resultado: "ATENDE", ponto: { lat: -22.88, lng: -42.02, origem: "bairro" }, medida: "estimada" }, null);
  conferir("medida 'estimada' vai junto", estimado && estimado.medida === "estimada" && estimado.origem === "bairro", estimado);
  const gps = pontoParaGravar({ resultado: "ATENDE", medida: "rota" }, GPS);
  conferir("sem ponto no veredito, a localização do cliente (origem gps)", gps && gps.lat === GPS.lat && gps.origem === "gps" && gps.medida === "rota", gps);
  const semVeredito = pontoParaGravar(null, GPS);
  conferir("rascunho (sem veredito) com localização grava o ponto do cliente", semVeredito && semVeredito.origem === "gps" && !("medida" in semVeredito), semVeredito);
  conferir("FORA não grava ponto", pontoParaGravar({ resultado: "FORA", ponto: { lat: 1, lng: 1, origem: "mapa" } }, GPS) === null);
  conferir("DESCONHECIDO não grava ponto", pontoParaGravar({ resultado: "DESCONHECIDO" }, null) === null);
  conferir("nada conhecido: nada gravado (nunca um ponto inventado)", pontoParaGravar({ resultado: "ATENDE" }, null) === null);
  conferir("(0,0) não é ponto", pontoParaGravar({ resultado: "ATENDE", ponto: { lat: 0, lng: 0, origem: "mapa" } }, null) === null);
  const legivel = pontoParaGravar({ resultado: "ATENDE", ponto: { lat: -22.88, lng: -42.02, origem: "pino" } }, null);
  conferir("continua legível por quem só lê {lat,lng}", typeof legivel.lat === "number" && typeof legivel.lng === "number");
}

console.log("\n3) O ponto já gravado no rascunho");
conferir("GPS do cliente é reaproveitado", pontoDoClienteGravado({ lat: -22.88, lng: -42.02, origem: "gps" })?.lat === -22.88);
conferir("pino também", pontoDoClienteGravado({ lat: -22.88, lng: -42.02, origem: "pino", medida: "rota" })?.lng === -42.02);
conferir("ponto do MAPA não é herdado (recalcula)", pontoDoClienteGravado({ lat: -22.88, lng: -42.02, origem: "mapa" }) === null);
conferir("formato antigo {lat,lng} sem origem não é herdado", pontoDoClienteGravado({ lat: -22.88, lng: -42.02 }) === null);
conferir("lixo", pontoDoClienteGravado(null) === null && pontoDoClienteGravado("x") === null && pontoDoClienteGravado({ origem: "gps" }) === null);
conferir("mesmo endereço ignora caixa/acento/pontuação", mesmoEnderecoDeEntrega("Rua Itajurú, 120 - Centro", "rua itajuru 120 centro"));
conferir("endereço diferente", !mesmoEnderecoDeEntrega("Rua Itajuru, 120", "Rua Itajuru, 12"));
conferir("vazio nunca é 'o mesmo'", !mesmoEnderecoDeEntrega("", "") && !mesmoEnderecoDeEntrega(null, undefined));
// Revisão de 25/09/2026: o modelo reescreve o endereço a cada tag, e o ponto do
// aparelho guardado no rascunho se perdia por uma vírgula ou pela cidade.
conferir("o modelo acrescentou a cidade: o mesmo lugar",
  mesmoEnderecoDeEntrega("Travessa Canaã, 6 - Boca do Mato", "Travessa Canaã, 6, Boca do Mato, Cabo Frio"));
conferir("acrescentou o complemento: o mesmo lugar", mesmoEnderecoDeEntrega("Rua X, 10", "Rua X, 10, casa 2"));
conferir("outra rua não é o mesmo lugar", !mesmoEnderecoDeEntrega("Rua A, 10", "Rua B, 10"));
conferir("uma palavra só não basta ('Centro' dentro de qualquer endereço do Centro)", !mesmoEnderecoDeEntrega("Centro", "Rua A, 10, Centro"));

console.log("\n4) Quando pedir a localização do cliente (R2/R3)");
conferir("ROTA/KM: o mapa não achou → pede", motivoParaPedirLocalizacao({ modo: "KM", resultado: "DESCONHECIDO" }, false) === "desconhecido");
conferir("área desenhada: não achou → pede", motivoParaPedirLocalizacao({ modo: "POLIGONO", resultado: "DESCONHECIDO" }, false) === "desconhecido");
conferir("ATENDE com pedeConfirmacao → pede", motivoParaPedirLocalizacao({ modo: "KM", resultado: "ATENDE", pedeConfirmacao: true }, false) === "aproximado");
conferir("ATENDE pelo centro do bairro (aproximado) → pede", motivoParaPedirLocalizacao({ modo: "KM", resultado: "ATENDE", aproximado: true }, false) === "aproximado");
conferir("ATENDE exato → não pede", motivoParaPedirLocalizacao({ modo: "KM", resultado: "ATENDE" }, false) === null);
conferir("com a localização do cliente NUNCA pede de novo (sem laço)",
  motivoParaPedirLocalizacao({ modo: "KM", resultado: "DESCONHECIDO" }, true) === null &&
  motivoParaPedirLocalizacao({ modo: "KM", resultado: "ATENDE", pedeConfirmacao: true }, true) === null);
conferir("loja por bairro: o ponto não ajuda, não pede", motivoParaPedirLocalizacao({ modo: "BAIRRO", resultado: "DESCONHECIDO" }, false) === null);
conferir("FORA não pede", motivoParaPedirLocalizacao({ modo: "KM", resultado: "FORA" }, false) === null);
conferir("sem veredito", motivoParaPedirLocalizacao(null, false) === null);
// Revisão de 25/09/2026: quem não tem ponto no mapa é a LOJA — a localização do
// cliente não resolve, e pedir era um turno inútil antes de segurar.
{
  // A forma que o motor (lib/area-de-entrega.ts) devolve: o campo decide, o
  // motivo em texto é para o log.
  const MOTIVO_SEM_PONTO = "loja sem localização no mapa (storeLatLng)";
  const semPontoDaLoja = { modo: "KM", resultado: "DESCONHECIDO", semPontoDaLoja: true, motivo: MOTIVO_SEM_PONTO };
  conferir("loja sem ponto no mapa: reconhecido pelo campo semPontoDaLoja", faltaOPontoDaLoja(semPontoDaLoja));
  conferir("loja sem ponto no mapa: NÃO pede a localização do cliente", motivoParaPedirLocalizacao(semPontoDaLoja, false) === null);
  // O defeito que o campo fecha: a frase do log era a regra — reescrita, o
  // robô voltava a pedir o 📎 de quem não tem como ser medido.
  conferir("o campo decide mesmo com o motivo reescrito",
    faltaOPontoDaLoja({ resultado: "DESCONHECIDO", semPontoDaLoja: true, motivo: "a loja não marcou o ponto" }) &&
    motivoParaPedirLocalizacao({ modo: "KM", resultado: "DESCONHECIDO", semPontoDaLoja: true, motivo: "a loja não marcou o ponto" }, false) === null);
  conferir("semPontoDaLoja: false vence o texto (o campo presente é a palavra do motor)",
    !faltaOPontoDaLoja({ resultado: "DESCONHECIDO", semPontoDaLoja: false, motivo: MOTIVO_SEM_PONTO }) &&
    motivoParaPedirLocalizacao({ modo: "KM", resultado: "DESCONHECIDO", semPontoDaLoja: false, motivo: MOTIVO_SEM_PONTO }, false) === "desconhecido");
  conferir("sem o campo, o texto do motivo ainda vale (reserva)",
    faltaOPontoDaLoja({ resultado: "DESCONHECIDO", motivo: MOTIVO_SEM_PONTO }) &&
    motivoParaPedirLocalizacao({ modo: "KM", resultado: "DESCONHECIDO", motivo: MOTIVO_SEM_PONTO }, false) === null);
  conferir("endereço não achado (a loja tem ponto) continua pedindo",
    !faltaOPontoDaLoja({ resultado: "DESCONHECIDO", motivo: "endereço não localizado no mapa" }) &&
    motivoParaPedirLocalizacao({ modo: "KM", resultado: "DESCONHECIDO", motivo: "endereço não localizado no mapa" }, false) === "desconhecido");
  conferir("ATENDE nunca é 'falta o ponto da loja'",
    !faltaOPontoDaLoja({ resultado: "ATENDE", semPontoDaLoja: true, motivo: MOTIVO_SEM_PONTO }) &&
    !faltaOPontoDaLoja({ resultado: "ATENDE", motivo: "loja sem localização no mapa" }) && !faltaOPontoDaLoja(null));
}

console.log("\n5) O que a nota do pedido conta (R7)");
{
  const estimada = avisosDaEntregaNaNota({ resultado: "ATENDE", medida: "estimada" }, false);
  conferir("distância ESTIMADA aparece", estimada.some((a) => /estimada/.test(a)), estimada);
  const aprox = avisosDaEntregaNaNota({ resultado: "ATENDE", pedeConfirmacao: true, medida: "rota" }, false);
  conferir("ponto APROXIMADO aparece", aprox.some((a) => /aproximado/.test(a)), aprox);
  const comGps = avisosDaEntregaNaNota({ resultado: "ATENDE", pedeConfirmacao: true, medida: "rota" }, true);
  conferir("com a localização do cliente não é aproximado", !comGps.some((a) => /aproximado/.test(a)) && comGps.some((a) => /localização enviada/.test(a)), comGps);
  conferir("rota exata sem aviso", avisosDaEntregaNaNota({ resultado: "ATENDE", medida: "rota" }, false).length === 0);
  conferir("fora da área não vira nota de entrega", avisosDaEntregaNaNota({ resultado: "FORA", medida: "estimada" }, false).length === 0);
}

console.log("\n6) Endereço em partes da tag");
{
  const p = partesDoEnderecoDaTag({ address: "Rua Itajuru, 120 - Centro", street: "Rua Itajuru", number: 120, neighborhood: "Centro" });
  conferir("inglês", p && p.street === "Rua Itajuru" && p.number === "120" && p.neighborhood === "Centro" && !("city" in p), p);
  const pt = partesDoEnderecoDaTag({ rua: "Travessa Canaã", numero: "6", bairro: "Boca do Mato", cidade: "Cabo Frio" });
  conferir("português", pt && pt.street === "Travessa Canaã" && pt.number === "6" && pt.neighborhood === "Boca do Mato" && pt.city === "Cabo Frio", pt);
  conferir("só o texto corrido: sem partes", partesDoEnderecoDaTag({ address: "Rua X, 10" }) === undefined);
  conferir("campos vazios não contam", partesDoEnderecoDaTag({ street: "  ", number: "" }) === undefined);
  conferir("lixo", partesDoEnderecoDaTag(null) === undefined && partesDoEnderecoDaTag("x") === undefined);
}

console.log("\n7) Como a distância é dita (ROTA não é raio)");
{
  const rota = frasesDaDistancia({ distanciaKm: 2.5, raioMaxKm: 5, medida: "rota" }, true);
  conferir("ROTA fala em percurso da moto", rota && /percurso da moto pelas ruas/.test(rota.distancia) && rota.distancia.startsWith("2,5 km") && /até 5 km de percurso/.test(rota.limite), rota);
  conferir("ROTA nunca diz 'raio'", rota && !/raio/i.test(rota.distancia + rota.limite));
  const est = frasesDaDistancia({ distanciaKm: 3.14, raioMaxKm: 5, medida: "estimada" }, true);
  conferir("ROTA estimada avisa", est && /estimada/.test(est.distancia) && est.distancia.startsWith("3,14 km"), est);
  const km = frasesDaDistancia({ distanciaKm: 0.84, raioMaxKm: 5 }, false);
  conferir("KM (linha reta) fala 'da loja'", km && km.distancia === "0,84 km da loja" && km.limite === "a loja entrega até 5 km", km);
  conferir("km inteiro sem ',00'", frasesDaDistancia({ distanciaKm: 2, raioMaxKm: 4.5 }, true)?.distancia.startsWith("2 km") && frasesDaDistancia({ distanciaKm: 2, raioMaxKm: 4.5 }, true)?.limite.includes("4,5 km"));
  conferir("sem distância, nada a dizer", frasesDaDistancia({ raioMaxKm: 5 }, true) === null && frasesDaDistancia(null, true) === null);
  const semMax = frasesDaDistancia({ distanciaKm: 1 }, true);
  conferir("sem limite cadastrado, limite vazio", semMax && semMax.limite === "", semMax);
}

console.log("\n8) Rua, número e bairro do que o cliente DIGITOU (cotação da conversa)");
{
  const caso = (texto, esperado, cidade = "Cabo Frio") => {
    const p = partesDoEnderecoDigitado(texto, cidade);
    const ok = esperado === undefined
      ? p === undefined
      : Boolean(p) && Object.entries(esperado).every(([k, v]) => p[k] === v) && Object.keys(p).every((k) => k === "city" || k in esperado);
    conferir(`"${texto}"`, ok, p);
  };
  // O caso da auditoria: sem o bairro separado, a conversa dizia "não achei" e a gravação achava.
  caso("Travessa canaã, 6 - Boca do mato", { street: "Travessa canaã", number: "6", neighborhood: "Boca do mato" });
  caso("Rua das Palmeiras, 45, casa 2, Jardim Excelsior", { street: "Rua das Palmeiras", number: "45", neighborhood: "Jardim Excelsior" });
  caso("rua itajuru 120 centro", { street: "rua itajuru", number: "120", neighborhood: "centro" });
  caso("Moro na Rua Sol Nascente, 23, bairro Aquários, Cabo Frio", { street: "Rua Sol Nascente", number: "23", neighborhood: "Aquários" });
  caso("Av. Brasil 500 apto 302", { street: "Av. Brasil", number: "500" });
  caso("Rua 7, 45, Jardim Excelsior", { street: "Rua 7", number: "45", neighborhood: "Jardim Excelsior" });
  caso("Rua Tal 45, Centro, 1 x-burguer, pix, pode fechar", { street: "Rua Tal", number: "45", neighborhood: "Centro" });
  caso("Rua X, 10, Cabo Frio - RJ", { street: "Rua X", number: "10" });
  caso("Estrada da Usina, s/n, perto da escola", { street: "Estrada da Usina", number: "s/n" });
  caso("bairro Centro", { neighborhood: "Centro" });
  caso("vcs entregam no meu bairro?", undefined);
  caso("quero 2 x-tudo", undefined);
  caso("Jardim Esperança, 45", undefined);
  conferir("não-texto", partesDoEnderecoDigitado(undefined) === undefined && partesDoEnderecoDigitado("") === undefined);
  const comCidade = partesDoEnderecoDigitado("Rua X, 10 - Centro", "Cabo Frio");
  conferir("a cidade da loja vai junto", comCidade?.city === "Cabo Frio", comCidade);
}

console.log("\n9) A régua do 'escreveu um endereço' depois da localização");
for (const t of ["Travessa Canaã, 6 - Boca do Mato", "Rua das Palmeiras 45", "Jardim Esperança, 45", "Av. Brasil 500", "WE 62, 150", "nº 45, casa 2", "quadra 5 lote 10", "bairro Centro 45"]) {
  conferir(`endereço: "${t}"`, pareceEnderecoEscrito(t));
}
for (const t of ["vcs entregam no meu bairro?", "quantos km dá?", "pix", "pode fechar", "quero 2 x-tudo", "ruas alagadas hoje?", ""]) {
  conferir(`não é endereço: "${t}"`, !pareceEnderecoEscrito(t));
}

console.log("\n10) Localização do aparelho x endereço digitado DEPOIS dela");
{
  const GPS_CASA = { lat: -22.874512, lng: -42.018733 };
  const perto = { lat: -22.8780, lng: -42.0190 }; // ~390 m: a rua achada no meio do trecho
  const longe = { lat: -22.8930, lng: -42.0400 }; // ~2,7 km: outro lugar
  const achou = (ponto, extra = {}) => ({ modo: "KM", resultado: "ATENDE", taxa: 12, ponto: { ...ponto, origem: "mapa" }, pedeConfirmacao: false, ...extra });
  conferir(`o limite é ${DISTANCIA_QUE_TROCA_O_PONTO_KM} km`, DISTANCIA_QUE_TROCA_O_PONTO_KM === 1);
  conferir("o mapa não achou o texto: vale a localização", pontoDaEntregaDoRobo({ resultado: "DESCONHECIDO" }, GPS_CASA) === "gps");
  conferir("o texto caiu PERTO: é complemento, vale a localização", pontoDaEntregaDoRobo(achou(perto), GPS_CASA) === "gps");
  conferir("o texto caiu LONGE, achado com certeza: é outro lugar, vale o texto", pontoDaEntregaDoRobo(achou(longe), GPS_CASA) === "texto");
  conferir("longe mas APROXIMADO (centro do bairro): vale a localização",
    pontoDaEntregaDoRobo(achou(longe, { aproximado: true, ponto: { ...longe, origem: "bairro" } }), GPS_CASA) === "gps");
  conferir("longe mas pede confirmação (rua homônima): vale a localização", pontoDaEntregaDoRobo(achou(longe, { pedeConfirmacao: true }), GPS_CASA) === "gps");
  conferir("longe e FORA da área, achado com certeza: vale o texto (o cliente pediu em outro lugar)",
    pontoDaEntregaDoRobo({ modo: "KM", resultado: "FORA", ponto: { ...longe, origem: "mapa" } }, GPS_CASA) === "texto");
  conferir("sem ponto no veredito: vale a localização", pontoDaEntregaDoRobo({ modo: "KM", resultado: "ATENDE" }, GPS_CASA) === "gps");
  conferir("sem localização: vale o texto", pontoDaEntregaDoRobo(achou(perto), null) === "texto");

  // A avaliação de verdade, com o avaliador simulado: o que mede com a
  // coordenada devolve o ponto do aparelho; o texto, o que o "mapa" achar.
  const chamadas = [];
  const mapa = new Map([
    ["Travessa Canaã, 6 - Boca do Mato", { modo: "KM", resultado: "DESCONHECIDO", taxa: null, tempoMin: null, motivo: "endereço não localizado no mapa" }],
    ["Rua das Palmeiras, 45", achou(perto, { taxa: 5 })],
    ["Jardim Esperança, 45", achou(longe, { taxa: 18 })],
  ]);
  const avaliar = async (p) => {
    chamadas.push(p);
    if (p.coords) return { modo: "KM", resultado: "ATENDE", taxa: 5, tempoMin: 30, ponto: { ...p.coords, origem: "gps" }, medida: "rota", motivo: "gps" };
    return mapa.get(p.endereco) || { modo: "KM", resultado: "DESCONHECIDO", taxa: null, tempoMin: null, motivo: "endereço não localizado no mapa" };
  };
  const r1 = await avaliarEntregaDoRobo(avaliar, { endereco: "Travessa Canaã, 6 - Boca do Mato", gps: GPS_CASA, textoDepoisDoPonto: "Travessa Canaã, 6 - Boca do Mato" });
  conferir("Divinos: localização → rua que o mapa não acha → mede pela LOCALIZAÇÃO (não pede de novo)",
    r1.veredito.resultado === "ATENDE" && r1.veredito.ponto.origem === "gps" && r1.coords?.lat === GPS_CASA.lat && !r1.trocouPeloTexto &&
    motivoParaPedirLocalizacao(r1.veredito, Boolean(r1.coords)) === null, r1);
  const r2 = await avaliarEntregaDoRobo(avaliar, { endereco: "Rua das Palmeiras, 45", gps: GPS_CASA, textoDepoisDoPonto: "Rua das Palmeiras, 45" });
  conferir("rua achada perto do ponto → mede pela localização", r2.veredito.ponto.origem === "gps" && !r2.trocouPeloTexto, r2);
  const r3 = await avaliarEntregaDoRobo(avaliar, { endereco: "Jardim Esperança, 45", gps: GPS_CASA, textoDepoisDoPonto: "Jardim Esperança, 45" });
  conferir("endereço novo achado LONGE → mede pelo endereço digitado (casa da mãe), e o ponto do aparelho sai",
    r3.trocouPeloTexto && r3.coords === null && r3.veredito.taxa === 18 && pontoParaGravar(r3.veredito, r3.coords)?.origem === "mapa", r3);
  chamadas.length = 0;
  const r4 = await avaliarEntregaDoRobo(avaliar, { endereco: "Rua das Palmeiras, 45", gps: GPS_CASA, textoDepoisDoPonto: null });
  conferir("sem texto depois do ponto: uma avaliação só, pela localização", chamadas.length === 1 && chamadas[0].coords && r4.coords, chamadas);
  chamadas.length = 0;
  const r5 = await avaliarEntregaDoRobo(avaliar, { endereco: "Rua das Palmeiras, 45", gps: null, textoDepoisDoPonto: "Rua das Palmeiras, 45" });
  conferir("sem localização: pelo texto, uma avaliação só", chamadas.length === 1 && !chamadas[0].coords && r5.coords === null, chamadas);
  const partes = { street: "Rua das Palmeiras", number: "45", neighborhood: "Centro" };
  chamadas.length = 0;
  await avaliarEntregaDoRobo(avaliar, { endereco: "Rua das Palmeiras, 45", bairro: "Centro", partes, gps: GPS_CASA, textoDepoisDoPonto: "Rua das Palmeiras, 45" });
  conferir("as partes e o bairro vão nas DUAS medidas (a do texto sem coordenada)",
    chamadas.length === 2 && chamadas.every((c) => c.partes === partes && c.bairro === "Centro") && chamadas.filter((c) => !c.coords).length === 1, chamadas);
  const quebrado = async (p) => { if (!p.coords) throw new Error("mapa fora"); return avaliar(p); };
  const r6 = await avaliarEntregaDoRobo(quebrado, { endereco: "Rua X", gps: GPS_CASA, textoDepoisDoPonto: "Rua X" });
  conferir("o texto falhou no mapa: segue pela localização", r6.coords && r6.veredito.ponto.origem === "gps", r6);
}

console.log("\n11) Quem só mandou a localização: entrega ou retirada?");
{
  const loc = { lat: -22.874512, lng: -42.018733 };
  const tipoCom = (sinais) => {
    const reserva = levaEnderecoDaLocalizacao({ temLocalizacao: true, ...sinais }) ? enderecoDaLocalizacaoDoCliente(loc) : "";
    return tipoDoPedidoDoRobo({ enderecoDoPayload: "", enderecoDoRascunho: reserva, tipoInformado: sinais.tipoInformado, frete: sinais.frete });
  };
  const gratis = tipoCom({ frete: 0, tipoInformado: "DELIVERY", freteGratisVale: true });
  conferir("frete GRÁTIS (tag com frete 0 e 'DELIVERY'): ENTREGA, com o endereço de reserva", gratis.tipo === "DELIVERY" && ehEnderecoDaLocalizacao(gratis.endereco), gratis);
  conferir("frete grátis valendo, tag sem tipo: ENTREGA", tipoCom({ frete: 0, freteGratisVale: true }).tipo === "DELIVERY");
  conferir("tag dizendo 'DELIVERY' com frete 0 e sem frete grátis: ENTREGA", tipoCom({ frete: 0, tipoInformado: "DELIVERY", freteGratisVale: false }).tipo === "DELIVERY");
  conferir("frete cobrado: ENTREGA", tipoCom({ frete: 5, freteGratisVale: false }).tipo === "DELIVERY");
  conferir("mandou a localização e decidiu BUSCAR (tag 'RETIRADA'): RETIRADA", tipoCom({ frete: 0, tipoInformado: "RETIRADA", freteGratisVale: true }).tipo === "RETIRADA");
  conferir("sem nenhum sinal (frete 0, sem tipo, sem frete grátis): RETIRADA, como antes", tipoCom({ frete: 0, freteGratisVale: false }).tipo === "RETIRADA");
  conferir("sem localização não há reserva", !levaEnderecoDaLocalizacao({ temLocalizacao: false, frete: 5, freteGratisVale: true }));
  conferir("o endereço de reserva leva o ponto e o que o WhatsApp anexou",
    enderecoDaLocalizacaoDoCliente({ ...loc, endereco: "R. das Palmeiras, 45" }) === "📍 Localização enviada pelo WhatsApp: R. das Palmeiras, 45 (-22.874512, -42.018733)");
  conferir("endereço digitado não é o de reserva", !ehEnderecoDaLocalizacao("Rua X, 10") && !ehEnderecoDaLocalizacao(null));
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
