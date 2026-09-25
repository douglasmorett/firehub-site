/**
 * A entrega no checkout (src/lib/entrega-no-checkout.ts): GPS que não se
 * perde, corrida de cotações, pino obrigatório em km/rota, o que vai no pedido
 * e o que o balcão avisa.
 *
 *   npx tsx scripts/teste-entrega-no-checkout.ts
 *
 * Sem rede e sem banco. A última parte confere que a assinatura da tela casa
 * com a chave do servidor (lib/cotacao-de-entrega.ts): se as duas divergirem,
 * a tela manda um token que o POST recusa, ou deixa de recotar quando devia.
 */
process.env.COTACAO_SECRET = "segredo-de-teste";
import {
  assinaturaDaConsulta,
  BOTAO_DO_GPS,
  carimboDoPonto,
  comoAbrirOMapa,
  consultaDaCotacao,
  consultaDoBalcao,
  criarSequenciadorDeCotacoes,
  detalheDaEntrega,
  gpsEhPreciso,
  gpsNoLugarDoMapa,
  lerCotacaoNoBalcao,
  lerRecusaDoPedido,
  lerRespostaDaCotacao,
  oQueFaltaParaFechar,
  painelDaEntrega,
  partesDoEnderecoDigitado,
  pontoValeParaEndereco,
  pontoValido,
  PRECISAO_MAXIMA_DO_GPS_M,
  temOndeAbrirOMapa,
  temRuaOuBairro,
  textoLimpo,
  VALIDADE_DA_COTACAO_NA_TELA_MS,
  avisoDoPontoSemEndereco,
  enderecoDoReverso,
  type EnderecoDigitado,
  type Ponto,
} from "../src/lib/entrega-no-checkout";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chaveDoEndereco, VALIDADE_DA_COTACAO_MS } from "../src/lib/cotacao-de-entrega";
import { entregaDoVeredicto, recusaDoSite } from "../src/lib/entrega-do-pedido";
import type { VeredictoDeEntrega } from "../src/lib/area-de-entrega";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`); }
}

// ── 1. O PONTO DO CLIENTE AINDA VALE? ─────────────────────────────────────
{
  // O "Minha localização" da Divinos: o mapa chama a rua de "Rua Beira Alta" e
  // o bairro de "Vila Monte Alegre", sem número.
  const carimbo = { street: "Rua Beira Alta", number: "", neighborhood: "Vila Monte Alegre" };
  confere("GPS: preencher o número não derruba o ponto",
    pontoValeParaEndereco(carimbo, { ...carimbo, number: "11" }));
  // O número que o reverse geocode escreveu é chute do mapa: não entra no carimbo.
  const doGps = carimboDoPonto({ ...carimbo, number: "250" }, { numeroDoMapa: true });
  confere("GPS: o número que o mapa chutou não vai para o carimbo", doGps.number === "" && doGps.street === "Rua Beira Alta", doGps);
  confere("GPS: corrigir o número que o mapa chutou não derruba o ponto",
    pontoValeParaEndereco(doGps, { ...carimbo, number: "12" }));
  confere("bairro escrito sem 'Vila' é o mesmo bairro",
    pontoValeParaEndereco(carimbo, { ...carimbo, neighborhood: "Monte Alegre" }));
  confere("rua sem o tipo é a mesma rua",
    pontoValeParaEndereco(carimbo, { ...carimbo, street: "Beira Alta" }));
  confere("acento e caixa não mudam nada",
    pontoValeParaEndereco({ street: "Rua São Cristóvão", neighborhood: "Braga" }, { street: "rua sao cristovao", neighborhood: "BRAGA" }));
  // Reverse geocode falhou (429) com o formulário vazio: o carimbo não diz
  // ONDE. O cliente no trabalho digita o endereço de casa — o ponto do
  // trabalho não pode valer para ele.
  confere("carimbo SEM rua e SEM bairro não vale para endereço nenhum (GPS no trabalho, endereço de casa)",
    !pontoValeParaEndereco({ street: "", number: "", neighborhood: "" }, { street: "Rua das Flores", number: "20", neighborhood: "Centro" }));
  confere("carimbo só com número também não", !pontoValeParaEndereco({ street: " ", number: "20", neighborhood: "" }, { street: "Rua das Flores", number: "20", neighborhood: "Centro" }));
  confere("temRuaOuBairro", temRuaOuBairro({ neighborhood: "Centro" }) && temRuaOuBairro({ street: "Rua A" }) && !temRuaOuBairro({ number: "10" }) && !temRuaOuBairro(null));
  confere("o mapa deu só o bairro: a rua preenchida à mão mantém o ponto",
    pontoValeParaEndereco({ street: "", number: "", neighborhood: "Boca do Mato" }, { street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" }));
  confere("campo apagado no meio da edição não derruba (ainda)",
    pontoValeParaEndereco(carimbo, { ...carimbo, street: "" }));
  confere("OUTRA rua derruba o ponto (casa → trabalho)",
    !pontoValeParaEndereco(carimbo, { ...carimbo, street: "Travessa Liberdade" }));
  confere("OUTRO bairro derruba o ponto",
    !pontoValeParaEndereco(carimbo, { ...carimbo, neighborhood: "Centro" }));
  confere("nome curto só vale por igualdade ('A' não está 'dentro' de 'Beira Alta')",
    !pontoValeParaEndereco({ street: "Rua A", neighborhood: "Centro" }, { street: "Rua Beira Alta", neighborhood: "Centro" }));
  confere("sem carimbo não há ponto", !pontoValeParaEndereco(null, carimbo));

  // SÓ GRAFIA. "Um nome contém o outro" juntava ruas e bairros diferentes.
  confere("'Rua Treze' não é 'Rua Treze de Maio'",
    !pontoValeParaEndereco({ street: "Rua Treze de Maio", neighborhood: "Centro" }, { street: "Rua Treze", neighborhood: "Centro" }));
  confere("'Rua Brasil Novo' não é 'Avenida Brasil'",
    !pontoValeParaEndereco({ street: "Avenida Brasil", neighborhood: "Centro" }, { street: "Rua Brasil Novo", neighborhood: "Centro" }));
  confere("'Portinho do Sul' não é 'Portinho'",
    !pontoValeParaEndereco({ street: "Rua A", neighborhood: "Portinho" }, { street: "Rua A", neighborhood: "Portinho do Sul" }));
  confere("abreviação é grafia: 'R. Dr. Júlio Olivier' = 'Rua Doutor Julio Olivier'",
    pontoValeParaEndereco({ street: "Rua Doutor Julio Olivier", neighborhood: "Centro" }, { street: "R. Dr. Júlio Olivier", neighborhood: "Centro" }));
  confere("ligação é grafia: 'Treze Maio' = 'Treze de Maio'",
    pontoValeParaEndereco({ street: "Rua Treze de Maio", neighborhood: "Centro" }, { street: "Treze Maio", neighborhood: "Centro" }));
  confere("'Jd. Esperança' = 'Jardim Esperança' = 'Esperança'",
    pontoValeParaEndereco({ street: "Rua A1", neighborhood: "Jardim Esperança" }, { street: "Rua A1", neighborhood: "Jd. Esperança" })
      && pontoValeParaEndereco({ street: "Rua A1", neighborhood: "Jardim Esperança" }, { street: "Rua A1", neighborhood: "Esperança" }));

  // O NÚMERO que o cliente deu (pino confirmado com "10") entra: na mesma
  // avenida, "1500" é outra casa.
  const doPino = carimboDoPonto({ street: "Avenida Julia Kubitschek", number: "10", neighborhood: "Jardim Flamboyant" });
  confere("pino: outro número na mesma rua derruba o ponto", !pontoValeParaEndereco(doPino, { ...doPino, number: "1500" }));
  confere("pino: o mesmo número (outra grafia) mantém", pontoValeParaEndereco({ ...doPino, number: "S/N" }, { ...doPino, number: "sn" })
    && pontoValeParaEndereco({ ...doPino, number: "12-A" }, { ...doPino, number: "12a" }));

  // REDIGITAÇÃO: o texto no meio da palavra não casa, e isso NÃO pode custar o
  // ponto — a tela pergunta a cada leitura, e o ponto volta a valer quando a
  // palavra termina (o efeito que descartava a cada tecla foi removido).
  const gps = { street: "Rua Beira Alta", number: "", neighborhood: "Jardim Esperança" };
  const teclasDoBairro = ["", "E", "Es", "Esp", "Espe", "Esperança"].map((b) => pontoValeParaEndereco(gps, { ...gps, number: "11", neighborhood: b }));
  confere("redigitando o bairro: vale vazio, não vale no meio, VALE de novo no fim",
    teclasDoBairro[0] && !teclasDoBairro[1] && !teclasDoBairro[2] && teclasDoBairro[5], teclasDoBairro);
  const teclasDaRua = ["R", "Ru", "Rua", "Rua B", "Rua Beira Alta"].map((r) => pontoValeParaEndereco(gps, { ...gps, street: r }));
  confere("redigitando a rua: volta a valer quando a rua é a do carimbo", teclasDaRua[4] && !teclasDaRua[3], teclasDaRua);
}

// ── 1b. A TELA NÃO DESCARTA O PONTO A CADA TECLA ─────────────────────────
{
  // O efeito que chamava definirPontoDoCliente(null) sobre o valor
  // intermediário do campo não pode voltar: o ponto só sai quando o cliente
  // dá outro (GPS/pino) — a validade é decidida na hora de usar.
  const tela = readFileSync(join(process.cwd(), "src/components/customer/CustomerStorePage.tsx"), "utf8");
  confere("CustomerStorePage não derruba o ponto do cliente por tecla", !/definirPontoDoCliente\(\s*null\s*\)/.test(tela));
  confere("CustomerStorePage lê o pino da loja com lerPontoDaLoja (a mesma leitura do servidor)",
    /lerPontoDaLoja\(/.test(tela) && !/pontoDaLojaNaVitrine/.test(tela));
  confere("CustomerStorePage confere a precisão do GPS", /gpsEhPreciso\(pos\.coords\.accuracy\)/.test(tela));
}

// ── 1c. PRECISÃO DO GPS ───────────────────────────────────────────────────
{
  confere("GPS de 12 m é preciso", gpsEhPreciso(12));
  confere("no limite (150 m) ainda vale", gpsEhPreciso(PRECISAO_MAXIMA_DO_GPS_M) && PRECISAO_MAXIMA_DO_GPS_M === 150);
  confere("151 m não vale", !gpsEhPreciso(151));
  confere("'Localização precisa' desligada (~3 km) não vale", !gpsEhPreciso(3000));
  confere("sem precisão informada não vale", !gpsEhPreciso(undefined) && !gpsEhPreciso(null) && !gpsEhPreciso(NaN) && !gpsEhPreciso("12") && !gpsEhPreciso(-1));
}

// ── 1c2. O ENDEREÇO DO PONTO (REVERSE GEOCODE) ────────────────────────────
{
  // A resposta real do Nominatim no teste de ponta a ponta (25/09/2026, E6a):
  // GPS de 20 m a ~1 km da Divinos, sem nome de rua e sem `suburb`.
  const vilaEsperanca = { residential: "Vila Jardim Esperança", city: "Cabo Frio", state: "Rio de Janeiro", country: "Brasil" };
  const lido = enderecoDoReverso(vilaEsperanca);
  confere("bairro só em 'residential' (loteamento) vira o bairro", lido.bairro === "Vila Jardim Esperança" && lido.rua === "" && lido.numero === "", lido);
  // O que a tela faz com isso: o GPS PRECISO vira o ponto do cliente (antes
  // era jogado fora, com o alert "não consegui ler... agora").
  const naTela = { street: lido.rua, number: lido.numero, neighborhood: lido.bairro };
  confere("… e o endereço diz ONDE: o GPS não é descartado", temRuaOuBairro(naTela));
  const carimbo = carimboDoPonto(naTela);
  confere("… o cliente completa rua e número e o ponto continua valendo",
    pontoValeParaEndereco(carimbo, { street: "Rua Abel Gomes dos Santos", number: "15", neighborhood: "Vila Jardim Esperança" }), carimbo);
  confere("… mas trocar o bairro por outro derruba o ponto (casa ≠ trabalho)",
    !pontoValeParaEndereco(carimbo, { street: "Rua X", number: "1", neighborhood: "Centro" }));
  confere("'quarter' e 'hamlet' também valem de bairro",
    enderecoDoReverso({ quarter: "Parque Burle" }).bairro === "Parque Burle" && enderecoDoReverso({ hamlet: "Boca do Mato" }).bairro === "Boca do Mato");
  const completo = enderecoDoReverso({ road: "Rua Beira Alta", house_number: "100", suburb: "Vila Monte Alegre", residential: "Loteamento Tal" });
  confere("com `suburb`, ele manda (a mesma ordem do servidor)", completo.bairro === "Vila Monte Alegre" && completo.rua === "Rua Beira Alta" && completo.numero === "100", completo);
  confere("rua de pedestre/servidão também é rua", enderecoDoReverso({ pedestrian: "Servidão A" }).rua === "Servidão A" && enderecoDoReverso({ footway: "Beco B" }).rua === "Beco B");
  confere("campo em branco não conta (vai para o próximo)", enderecoDoReverso({ suburb: "  ", residential: "Jardim Caiçara" }).bairro === "Jardim Caiçara");
  const vazio = enderecoDoReverso(undefined);
  confere("resposta sem `address` (erro do Nominatim) não quebra", vazio.rua === "" && vazio.bairro === "" && vazio.numero === "", vazio);
  confere("sem rua e sem bairro nenhum, o ponto não vale para endereço (fica de palpite)",
    !temRuaOuBairro({ street: enderecoDoReverso({ city: "Cabo Frio" }).rua, neighborhood: enderecoDoReverso({ city: "Cabo Frio" }).bairro }));
  // O aviso: "agora" é para o mapa que não respondeu; o mapa que respondeu
  // sem nome não melhora tentando de novo.
  confere("mapa respondeu sem nome: o aviso NÃO diz 'agora'", !/agora/.test(avisoDoPontoSemEndereco(true)) && /não tem o nome da rua/.test(avisoDoPontoSemEndereco(true)), avisoDoPontoSemEndereco(true));
  confere("mapa não respondeu: 'agora' (falha passageira)", /agora/.test(avisoDoPontoSemEndereco(false)), avisoDoPontoSemEndereco(false));
  confere("os dois mandam digitar rua, número e bairro", [true, false].every((l) => /Digite rua, número e bairro/.test(avisoDoPontoSemEndereco(l))));
}

// ── 1d. ONDE O MAPA ABRE ──────────────────────────────────────────────────
{
  const CASA = { lat: -22.8531, lng: -42.0301 };
  const CENTRO_DO_BAIRRO = { lat: -22.8497, lng: -42.029 };
  const GPS_BORRADO = { lat: -22.87, lng: -42.05 };
  const endereco = { street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" };
  const base = { gpsAproximado: null, pontoDoCliente: null, endereco, pontoAproximado: null, pontoDescartado: null, precisaConfirmarNoMapa: false, pedeConfirmacao: false };

  const gps = comoAbrirOMapa({ ...base, gpsAproximado: GPS_BORRADO, pontoAproximado: CENTRO_DO_BAIRRO });
  confere("GPS aproximado: abre nele, texto próprio, e só vale depois do toque",
    gps.pontoInicial === GPS_BORRADO && gps.motivo === "gps-aproximado" && gps.exigirToque, gps);

  const valendo = comoAbrirOMapa({ ...base, pontoDoCliente: { ponto: CASA, carimbo: endereco }, pedeConfirmacao: true, pontoAproximado: CENTRO_DO_BAIRRO });
  confere("ponto do cliente deste endereço: conferir, sem exigir toque",
    valendo.pontoInicial === CASA && valendo.motivo === "conferir" && !valendo.exigirToque, valendo);

  const outroNumero = comoAbrirOMapa({ ...base, endereco: { ...endereco, number: "60" }, pontoDoCliente: { ponto: CASA, carimbo: endereco }, pedeConfirmacao: true, pontoAproximado: CENTRO_DO_BAIRRO });
  confere("só o número mudou: abre no pino de antes (melhor que o centro do bairro), mas exige o toque",
    outroNumero.pontoInicial === CASA && outroNumero.motivo === "aproximado" && outroNumero.exigirToque, outroNumero);

  const outraRua = comoAbrirOMapa({ ...base, endereco: { ...endereco, street: "Rua Liberdade" }, pontoDoCliente: { ponto: CASA, carimbo: endereco }, pedeConfirmacao: true, pontoAproximado: CENTRO_DO_BAIRRO });
  confere("outra rua: abre no palpite do servidor para o endereço NOVO, exigindo o toque",
    outraRua.pontoInicial === CENTRO_DO_BAIRRO && outraRua.exigirToque, outraRua);

  const precisoDoServidor = comoAbrirOMapa({ ...base, pontoAproximado: CASA });
  confere("palpite preciso do servidor: conferir sem exigir toque", precisoDoServidor.pontoInicial === CASA && !precisoDoServidor.exigirToque && precisoDoServidor.motivo === "conferir");

  const semNada = comoAbrirOMapa({ ...base, precisaConfirmarNoMapa: true, pontoDescartado: GPS_BORRADO });
  confere("não achou, sem palpite do servidor: abre no ponto guardado, exigindo o toque",
    semNada.pontoInicial === GPS_BORRADO && semNada.motivo === "nao-achou" && semNada.exigirToque, semNada);
  const velho = comoAbrirOMapa({ ...base, endereco: { ...endereco, street: "Rua Liberdade" }, precisaConfirmarNoMapa: true, pontoDoCliente: { ponto: CASA, carimbo: endereco } });
  confere("o ponto que não vale mais ainda serve de palpite (com toque)", velho.pontoInicial === CASA && velho.exigirToque, velho);
  confere("nada de nada: sem ponto inicial (o mapa nasce na loja)", comoAbrirOMapa(base).pontoInicial === null && comoAbrirOMapa(base).exigirToque);
}

// ── 2. PONTO VÁLIDO ───────────────────────────────────────────────────────
confere("ponto normal passa", JSON.stringify(pontoValido({ lat: -22.854, lng: -42.0296 })) === JSON.stringify({ lat: -22.854, lng: -42.0296 }));
confere("texto numérico passa", pontoValido({ lat: "-22.85", lng: "-42.03" })?.lat === -22.85);
confere("(0,0) não é ponto", pontoValido({ lat: 0, lng: 0 }) === null);
confere("lixo não é ponto", pontoValido({ lat: "abc", lng: 1 }) === null && pontoValido(null) === null && pontoValido({ lat: 91, lng: 0 }) === null);

// ── 3. ASSINATURA DA CONSULTA ─────────────────────────────────────────────
{
  const e = { street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" };
  const a = assinaturaDaConsulta(e);
  confere("acento/caixa/espaços não mudam a assinatura",
    assinaturaDaConsulta({ street: " travessa  canaa ", number: "6", neighborhood: "BOCA DO MATO" }) === a);
  confere("número diferente muda a assinatura (o servidor também muda a chave)",
    assinaturaDaConsulta({ ...e, number: "7" }) !== a);
  confere("ponto entra na assinatura", assinaturaDaConsulta(e, { lat: -22.85, lng: -42.03 }) !== a);
  confere("ponto arrastado 1 m não muda a assinatura",
    assinaturaDaConsulta(e, { lat: -22.854031, lng: -42.029652 }) === assinaturaDaConsulta(e, { lat: -22.854034, lng: -42.029654 }));
}

// ── 4. A QUERY DA COTAÇÃO ─────────────────────────────────────────────────
{
  const q = new URLSearchParams(consultaDaCotacao({
    franchiseeId: "loja1", street: "Rua Beira Alta ", number: "11", neighborhood: "Vila Monte Alegre", cidade: "Cabo Frio",
    ponto: { lat: -22.8540331, lng: -42.0296526, origem: "gps" },
  }));
  confere("pino/GPS vai JUNTO das peças do endereço (antes ia sozinho)",
    q.get("street") === "Rua Beira Alta" && q.get("number") === "11" && q.get("neighborhood") === "Vila Monte Alegre" && q.get("lat") === "-22.8540331" && q.get("lng") === "-42.0296526" && q.get("origem") === "gps",
    Object.fromEntries(q));
  confere("texto livre no formato de sempre", q.get("address") === "Rua Beira Alta, 11 - Vila Monte Alegre, Cabo Frio", q.get("address"));
  const semPonto = new URLSearchParams(consultaDaCotacao({ franchiseeId: "l", street: "R", number: "1", neighborhood: "B" }));
  confere("sem ponto, sem lat/lng", !semPonto.has("lat") && !semPonto.has("lng") && !semPonto.has("origem"));
  const semLoja = new URLSearchParams(consultaDaCotacao({ street: "R", number: "1", neighborhood: "B" }));
  confere("sem franchiseeId (balcão/painel) não manda o parâmetro", !semLoja.has("franchiseeId"));

  // O GPS e o pino cotam antes de o cliente digitar número ou bairro: o texto
  // ia "Estrada Nelore,  - Gamboa, Cabo Frio" (teste de ponta a ponta, E6/R4).
  const gps = { lat: -22.8455, lng: -42.027, origem: "gps" as const };
  const texto = (e: EnderecoDigitado) => new URLSearchParams(consultaDaCotacao({ franchiseeId: "l", cidade: "Cabo Frio", ...e, ponto: gps })).get("address");
  confere("sem número: 'Estrada Nelore - Gamboa, Cabo Frio'", texto({ street: "Estrada Nelore", number: "", neighborhood: "Gamboa" }) === "Estrada Nelore - Gamboa, Cabo Frio", texto({ street: "Estrada Nelore", number: "", neighborhood: "Gamboa" }));
  confere("sem número nem bairro: 'Rua Sete de Setembro, Cabo Frio'", texto({ street: "Rua Sete de Setembro", number: " ", neighborhood: "" }) === "Rua Sete de Setembro, Cabo Frio", texto({ street: "Rua Sete de Setembro", number: " ", neighborhood: "" }));
  confere("só o bairro (o GPS sem nome de rua): 'Vila Jardim Esperança, Cabo Frio'", texto({ street: "", number: "", neighborhood: "Vila Jardim Esperança" }) === "Vila Jardim Esperança, Cabo Frio", texto({ street: "", neighborhood: "Vila Jardim Esperança" }));
  confere("número sem rua não entra no texto", texto({ street: "", number: "15", neighborhood: "Gamboa" }) === "Gamboa, Cabo Frio", texto({ street: "", number: "15", neighborhood: "Gamboa" }));
  confere("nada digitado: só a cidade (nada de ',  - ,')", texto({}) === "Cabo Frio", texto({}));
  const semCidade = new URLSearchParams(consultaDaCotacao({ street: "Rua X", number: "", neighborhood: "" })).get("address");
  confere("sem cidade, sem vírgula sobrando", semCidade === "Rua X", semCidade);
}

// ── 5. LENDO A RESPOSTA ───────────────────────────────────────────────────
{
  const atende = lerRespostaDaCotacao({
    fee: 5, available: true, type: "radius", distanceKm: 0.84, maxRadiusKm: 5, tempoMin: 30, medida: "rota", faixaKm: 1,
    taxaDoEntregador: 4, ponto: { lat: -22.8518, lng: -42.0353, origem: "mapa" }, pedeConfirmacao: false, cotacao: "tok.en",
    podeConfirmarNoMapa: true, message: "Distância: 0,84 km pela rua",
  });
  confere("ATENDE em ROTA: taxa, distância, prazo, medida, token",
    atende.disponivel && atende.taxa === 5 && atende.distanciaKm === 0.84 && atende.tempoMin === 30 && atende.medida === "rota" && atende.cotacao === "tok.en" && !atende.pedeConfirmacao,
    atende);
  confere("ATENDE em ROTA com pino da loja permite conferir no mapa", atende.podeConferirNoMapa);
  confere("sem a bandeira do servidor (loja sem pino) não oferece o mapa",
    !lerRespostaDaCotacao({ fee: 5, available: true, type: "radius", distanceKm: 0.84 }).podeConferirNoMapa);
  confere("área desenhada sempre oferece o mapa", lerRespostaDaCotacao({ fee: 5, available: true, type: "poligono" }).podeConferirNoMapa);
  const legado = lerRespostaDaCotacao({ fee: 12, available: true, unknown: true, type: "radius", message: "Não localizamos... a loja confirma" });
  confere("'não localizado, a loja confirma' (loja sem pino): taxa provisória marcada", legado.disponivel && legado.naoLocalizado && legado.taxa === 12);

  const zero = lerRespostaDaCotacao({ fee: 5, available: true, type: "radius", distanceKm: 0 });
  confere("distância 0 é distância (cliente na porta da loja)", zero.distanciaKm === 0);

  const aproximado = lerRespostaDaCotacao({
    fee: 10, available: true, type: "radius", distanceKm: 1.04, medida: "rota", pedeConfirmacao: true,
    ponto: { lat: -22.8497, lng: -42.0290, origem: "bairro" }, cotacao: "tok",
  });
  confere("ponto aproximado: taxa estimada + pino obrigatório + onde abrir o mapa",
    aproximado.disponivel && aproximado.taxa === 10 && aproximado.pedeConfirmacao && aproximado.pontoAproximado?.lat === -22.8497,
    aproximado);

  const semPonto = lerRespostaDaCotacao({ fee: 0, available: false, unknown: true, type: "radius", precisaConfirmarNoMapa: true, message: "Não localizamos..." });
  confere("DESCONHECIDO em KM/ROTA: sem taxa, sem token, pede o mapa (nunca a faixa mais cara)",
    !semPonto.disponivel && semPonto.taxa === null && semPonto.cotacao === null && semPonto.precisaConfirmarNoMapa,
    semPonto);
  const semPontoMasDisponivel = lerRespostaDaCotacao({ fee: 12, available: true, precisaConfirmarNoMapa: true });
  confere("'precisa do mapa' vence 'available: true' (não se cobra a faixa de quem não se sabe onde está)",
    !semPontoMasDisponivel.disponivel && semPontoMasDisponivel.taxa === null);

  const fora = lerRespostaDaCotacao({ fee: 0, available: false, type: "radius", distanceKm: 7.2, maxRadiusKm: 5, message: "Fora" });
  confere("FORA: indisponível com a mensagem", !fora.disponivel && fora.mensagem === "Fora" && !fora.precisaConfirmarNoMapa);

  const semTaxa = lerRespostaDaCotacao({ available: true, type: "radius" }, 7);
  confere("sem 'fee' usa a taxa padrão da loja", semTaxa.taxa === 7);
  const lixo = lerRespostaDaCotacao("html de erro");
  confere("resposta que não é objeto não quebra", lixo.disponivel === true && lixo.cotacao === null);
  const medidaEstranha = lerRespostaDaCotacao({ fee: 5, available: true, medida: "chute", tempoMin: -3 });
  confere("medida desconhecida e prazo negativo viram null", medidaEstranha.medida === null && medidaEstranha.tempoMin === null);
  confere("token indisponível não é aproveitado", lerRespostaDaCotacao({ available: false, cotacao: "x" }).cotacao === null);
}

// ── 6. O QUE A TELA MOSTRA ────────────────────────────────────────────────
confere("detalhe pela rua com prazo", detalheDaEntrega({ distanciaKm: 0.84, medida: "rota", tempoMin: 30 }) === "0,84 km pela rua · chega em até ~30 min");
confere("detalhe estimado diz que é estimado", detalheDaEntrega({ distanciaKm: 2.5, medida: "estimada", tempoMin: null }) === "~2,5 km (distância estimada)");
confere("detalhe em linha reta (modo KM)", detalheDaEntrega({ distanciaKm: 1, medida: "linha-reta", tempoMin: null }) === "1 km da loja");
confere("sem distância nem prazo, nada", detalheDaEntrega({ distanciaKm: null, medida: null, tempoMin: null }) === "");
{
  const base = {
    bairroLocal: false, calculando: false, calculada: true, disponivel: true, erro: false, taxaEfetiva: 5,
    freteGratisPorMinimo: false, precisaConfirmarNoMapa: false, pedeConfirmacao: false, podeConferirNoMapa: true,
    temPontoDoCliente: false, distanciaKm: 0.84, medida: "rota" as const, tempoMin: 30, mensagem: "Distância aproximada: 0.84 km",
  };
  const p = painelDaEntrega(base);
  confere("painel ATENDE: taxa, detalhe, mapa opcional, sem repetir a mensagem do servidor",
    p.tom === "ok" && p.titulo === "Taxa de Entrega: R$ 5,00" && p.detalhe.includes("pela rua") && p.botaoDoMapa === "opcional" && p.mensagem === "",
    p);
  const est = painelDaEntrega({ ...base, pedeConfirmacao: true, taxaEfetiva: 10 });
  confere("painel aproximado: 'Taxa estimada' + mapa obrigatório",
    est.tom === "alerta" && est.titulo === "Taxa estimada: R$ 10,00" && est.botaoDoMapa === "obrigatorio", est);
  const estConfirmado = painelDaEntrega({ ...base, pedeConfirmacao: true, temPontoDoCliente: true });
  confere("painel aproximado mas com pino do cliente: não pede de novo", estConfirmado.tom === "ok" && estConfirmado.botaoDoMapa === "opcional");
  const precisa = painelDaEntrega({ ...base, disponivel: false, precisaConfirmarNoMapa: true, taxaEfetiva: 0, mensagem: "" });
  confere("painel sem ponto: NÃO diz 'fora da área', pede o mapa",
    precisa.tom === "alerta" && precisa.titulo === "Marque no mapa onde você mora" && precisa.botaoDoMapa === "obrigatorio" && !!precisa.mensagem, precisa);
  const fora = painelDaEntrega({ ...base, disponivel: false, podeConferirNoMapa: false, mensagem: "Fora do raio" });
  confere("painel fora", fora.tom === "erro" && fora.titulo === "Fora da área de entrega" && fora.botaoDoMapa === null);
  const calc = painelDaEntrega({ ...base, calculando: true });
  confere("painel calculando", calc.tom === "calculando");
  const erro = painelDaEntrega({ ...base, disponivel: false, calculada: false, erro: true, mensagem: "Toque em Recalcular" });
  confere("painel erro de rede não diz 'fora da área'", erro.tom === "erro" && erro.titulo === "Não consegui calcular a entrega");
  const gratis = painelDaEntrega({ ...base, taxaEfetiva: 0, freteGratisPorMinimo: true });
  confere("frete grátis por mínimo", gratis.titulo.startsWith("Frete Grátis"));
  const vazio = painelDaEntrega({ ...base, calculada: false, distanciaKm: null, mensagem: "" });
  confere("antes de preencher", vazio.tom === "neutro" && vazio.titulo.startsWith("Preencha"));
  const provisoria = painelDaEntrega({ ...base, naoLocalizado: true, distanciaKm: null, podeConferirNoMapa: false, taxaEfetiva: 12, mensagem: "a loja confirma" });
  confere("taxa provisória (não localizado, loja sem pino): âmbar, com a mensagem",
    provisoria.tom === "alerta" && provisoria.titulo === "Taxa de Entrega: R$ 12,00" && provisoria.mensagem === "a loja confirma", provisoria);
}

// ── 7. FECHAR O PEDIDO ────────────────────────────────────────────────────
{
  const ass = assinaturaDaConsulta({ street: "R", number: "1", neighborhood: "B" });
  const base = {
    calculando: false, cotadaPeloServidor: true, assinaturaCotada: ass, assinaturaAtual: ass, idadeDaCotacaoMs: 60_000,
    erro: false, calculada: true, disponivel: true, precisaConfirmarNoMapa: false, pedeConfirmacao: false,
    temPontoDoCliente: false, freteGratis: false, mensagem: "",
  };
  confere("tudo certo: fecha", oQueFaltaParaFechar(base) === null);
  confere("cotação em voo: espera", oQueFaltaParaFechar({ ...base, calculando: true })?.acao === "aguardar");
  confere("endereço mudou depois da cotação: cota de novo (a taxa na tela é de outro endereço)",
    oQueFaltaParaFechar({ ...base, assinaturaAtual: assinaturaDaConsulta({ street: "R", number: "2", neighborhood: "B" }) })?.acao === "recotar");
  confere("nunca cotado: cota", oQueFaltaParaFechar({ ...base, assinaturaCotada: null })?.acao === "recotar");
  confere("cotação velha (token venceria no servidor): cota de novo",
    oQueFaltaParaFechar({ ...base, idadeDaCotacaoMs: VALIDADE_DA_COTACAO_NA_TELA_MS + 1 })?.acao === "recotar");
  confere("a validade da tela é menor que a do servidor", VALIDADE_DA_COTACAO_NA_TELA_MS < VALIDADE_DA_COTACAO_MS);
  confere("erro de rede: cota de novo", oQueFaltaParaFechar({ ...base, erro: true, disponivel: false })?.acao === "recotar");
  confere("sem ponto em KM/ROTA: abre o mapa (não recusa como 'fora')",
    oQueFaltaParaFechar({ ...base, disponivel: false, precisaConfirmarNoMapa: true })?.acao === "abrir-mapa");
  confere("ponto aproximado sem pino: abre o mapa",
    oQueFaltaParaFechar({ ...base, pedeConfirmacao: true })?.acao === "abrir-mapa");
  confere("ponto aproximado COM pino do cliente: fecha",
    oQueFaltaParaFechar({ ...base, pedeConfirmacao: true, temPontoDoCliente: true }) === null);
  confere("fora: recusa com a mensagem do servidor",
    (() => { const r = oQueFaltaParaFechar({ ...base, disponivel: false, mensagem: "Fora do raio (7 km)" }); return r?.acao === "recusar" && r.mensagem === "Fora do raio (7 km)"; })());
  confere("modo bairro (taxa da lista) não exige cotação do servidor",
    oQueFaltaParaFechar({ ...base, cotadaPeloServidor: false, assinaturaCotada: null }) === null);
  confere("taxa não calculada e sem frete grátis: espera",
    oQueFaltaParaFechar({ ...base, cotadaPeloServidor: false, calculada: false })?.acao === "aguardar");
  confere("taxa não calculada mas frete grátis: fecha",
    oQueFaltaParaFechar({ ...base, cotadaPeloServidor: false, calculada: false, freteGratis: true }) === null);
}

// ── 8. CORRIDA DE COTAÇÕES ────────────────────────────────────────────────
async function corrida() {
  const seq = criarSequenciadorDeCotacoes();
  let tela = "";
  const cotar = (endereco: string, demoraMs: number) => {
    const { id, signal } = seq.nova();
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => { if (seq.vale(id)) tela = endereco; resolve(); }, demoraMs);
      signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); });
    });
  };
  // O cliente digita "10", corrige para "100": a primeira resposta é mais lenta.
  const lenta = cotar("Rua X, 10", 60);
  const rapida = cotar("Rua X, 100", 10);
  await Promise.all([lenta, rapida]);
  confere("resposta velha não pinta a tela", tela === "Rua X, 100", tela);

  // Mesmo sem o cancelamento chegar (fetch que ignora o signal), o número manda.
  const seq2 = criarSequenciadorDeCotacoes();
  const a = seq2.nova();
  const b = seq2.nova();
  confere("a primeira foi cancelada", a.signal?.aborted === true && b.signal?.aborted === false);
  confere("só a última vale", !seq2.vale(a.id) && seq2.vale(b.id));
  seq2.cancelar();
  confere("cancelar (escolheu retirada) invalida a que estava em voo", !seq2.vale(b.id) && b.signal?.aborted === true);
}

// ── 9. BALCÃO ─────────────────────────────────────────────────────────────
{
  const ok1 = lerCotacaoNoBalcao({ fee: 8, available: true, type: "radius", distanceKm: 1.24, medida: "rota", faixaKm: 1.5, tempoMin: 30, cotacao: "tk" });
  confere("balcão ATENDE: taxa, token e detalhe (km, faixa, prazo)",
    ok1.taxa === "8.00" && ok1.tom === "ok" && ok1.cotacao === "tk" && ok1.texto.includes("1,24 km pela rua") && ok1.texto.includes("faixa até 1,5 km") && ok1.texto.includes("~30 min"),
    ok1);
  const aprox = lerCotacaoNoBalcao({ fee: 10, available: true, type: "radius", distanceKm: 1.04, medida: "rota", pedeConfirmacao: true, cotacao: "tk2" });
  confere("balcão aproximado: preenche a taxa mas AVISA que é estimada",
    aprox.taxa === "10.00" && aprox.tom === "alerta" && /ESTIMADA/.test(aprox.texto) && aprox.cotacao === "tk2", aprox);
  const est = lerCotacaoNoBalcao({ fee: 12, available: true, type: "radius", distanceKm: 4.2, medida: "estimada", cotacao: "tk3" });
  confere("balcão distância estimada: avisa", est.tom === "alerta" && /Distância ESTIMADA/.test(est.texto) && est.texto.includes("~4,2 km"), est);
  const desc = lerCotacaoNoBalcao({ fee: 0, available: false, precisaConfirmarNoMapa: true, unknown: true });
  confere("balcão não localizado: campo vazio (o atendente decide), sem token",
    desc.taxa === null && desc.tom === "alerta" && desc.cotacao === null && /não localizado/.test(desc.texto), desc);
  const fora = lerCotacaoNoBalcao({ fee: 0, available: false, message: "Endereço fora do raio de entrega (7 km. Raio máximo: 5 km)." });
  confere("balcão fora: não bloqueia, avisa e deixa digitar", fora.taxa === null && fora.texto.includes("digite a taxa na mão"));
  confere("balcão sem resposta: erro", lerCotacaoNoBalcao(null).tom === "erro");
  const limite = lerCotacaoNoBalcao(null, "Muitas consultas de frete seguidas. Espere 20 s e tente de novo.");
  confere("balcão no limite (429): diz o motivo", limite.tom === "erro" && limite.texto.startsWith("Muitas consultas") && limite.texto.endsWith("Digite o valor na mão."), limite);
  const aproxSemTaxa = lerCotacaoNoBalcao({ fee: 0, available: false, precisaConfirmarNoMapa: true, ponto: { lat: -22.85, lng: -42.03, origem: "bairro" } });
  confere("balcão: aproximado sem taxa diz 'aproximada', não 'não localizado'", aproxSemTaxa.taxa === null && /aproximada/.test(aproxSemTaxa.texto), aproxSemTaxa);
  // Loja por km SEM pino: o servidor manda a faixa MAIS CARA como taxa
  // provisória do cardápio ("a loja confirma"). No balcão isso não é taxa (R2).
  const semPinoDaLoja = lerCotacaoNoBalcao({ fee: 20, available: true, unknown: true, type: "radius", maxRadiusKm: 5, message: "Não localizamos esse endereço no mapa... Por enquanto a taxa é R$ 20,00" });
  confere("balcão: 'não localizado' de loja sem pino NÃO preenche a faixa mais cara",
    semPinoDaLoja.taxa === null && semPinoDaLoja.tom === "alerta" && semPinoDaLoja.cotacao === null && /digite a taxa/.test(semPinoDaLoja.texto), semPinoDaLoja);

  // Endereço de uma linha → partes (para o servidor ter o centro do bairro).
  const p = (t: string) => JSON.stringify(partesDoEnderecoDigitado(t));
  confere("balcão: 'rua, número - bairro'",
    p("Travessa Canaã, 6 - Boca do Mato") === JSON.stringify({ street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" }), p("Travessa Canaã, 6 - Boca do Mato"));
  confere("balcão: 'rua, número, bairro, cidade - UF' pega o bairro",
    p("Rua Beira Alta, 11, Vila Monte Alegre, Cabo Frio - RJ") === JSON.stringify({ street: "Rua Beira Alta", number: "11", neighborhood: "Vila Monte Alegre" }));
  confere("balcão: complemento não vira bairro",
    p("Rua X, 10 - apto 201 - Centro") === JSON.stringify({ street: "Rua X", number: "10", neighborhood: "Centro" }), p("Rua X, 10 - apto 201 - Centro"));
  confere("balcão: rua com número no nome",
    p("Rua 7 de Setembro, 100 - Centro") === JSON.stringify({ street: "Rua 7 de Setembro", number: "100", neighborhood: "Centro" }));
  confere("balcão: S/N e nº",
    p("Estrada do Guriri, S/N - Peró") === JSON.stringify({ street: "Estrada do Guriri", number: "S/N", neighborhood: "Peró" })
      && p("Rua A1, nº 25 - Braga") === JSON.stringify({ street: "Rua A1", number: "25", neighborhood: "Braga" }), [p("Estrada do Guriri, S/N - Peró"), p("Rua A1, nº 25 - Braga")]);
  confere("balcão: bairro com hífen no nome não é cortado",
    p("Rua X, 10 - Jardim Bela-Vista") === JSON.stringify({ street: "Rua X", number: "10", neighborhood: "Jardim Bela-Vista" }), p("Rua X, 10 - Jardim Bela-Vista"));
  confere("balcão: sem bairro, vale o texto livre", partesDoEnderecoDigitado("Av. Brasil, 500") === null);
  confere("balcão: sem vírgula, vale o texto livre", partesDoEnderecoDigitado("Rua Diamante 19 Monte Alegre") === null);
  confere("balcão: vazio", partesDoEnderecoDigitado("") === null && partesDoEnderecoDigitado(undefined) === null);

  // REFERÊNCIA não é bairro: com ela no lugar do bairro, o mapa filtrava a
  // rua por "perto do Shopping..." e, achando o shopping, cobrava a faixa dele.
  confere("balcão: 'perto do X' não vira bairro", partesDoEnderecoDigitado("Rua Beira Alta, 100 - perto do Shopping Park Lagos") === null, p("Rua Beira Alta, 100 - perto do Shopping Park Lagos"));
  confere("balcão: 'próximo ao X' não vira bairro", partesDoEnderecoDigitado("Rua X, 10 - próximo ao mercado") === null, p("Rua X, 10 - próximo ao mercado"));
  const referencias = ["Rua X, 10 - em frente à padaria", "Rua X, 10, ao lado da igreja", "Rua X, 10 - esquina com a Rua Y", "Rua X, 10 - ref. mercado", "Rua X, 10 - atrás do posto"];
  confere("balcão: 'em frente à X', 'ao lado da X', 'esquina com', 'ref.' e 'atrás do' também não",
    referencias.every((t) => partesDoEnderecoDigitado(t) === null), referencias.map(p));
  confere("balcão: referência no meio do segmento também ('Boca do Mato perto da igreja')", partesDoEnderecoDigitado("Rua X, 10 - Boca do Mato perto da igreja") === null);
  confere("balcão: descrição da casa não vira bairro ('sobrado verde', 'portão azul')",
    partesDoEnderecoDigitado("Rua X, 10 - sobrado verde") === null && partesDoEnderecoDigitado("Rua X, 10 - portão azul") === null);
  confere("balcão: descrição da casa é pulada quando o bairro vem depois",
    p("Rua X, 10 - sobrado verde - Centro") === JSON.stringify({ street: "Rua X", number: "10", neighborhood: "Centro" }), p("Rua X, 10 - sobrado verde - Centro"));
  confere("balcão: referência DEPOIS do bairro não atrapalha",
    p("Rua X, 10 - Centro - perto da igreja") === JSON.stringify({ street: "Rua X", number: "10", neighborhood: "Centro" }), p("Rua X, 10 - Centro - perto da igreja"));

  // A CIDADE da loja não é bairro ("centro do bairro" = centro da cidade).
  const pc = (t: string, c: string) => JSON.stringify(partesDoEnderecoDigitado(t, c));
  confere("balcão: 'Rua X, 10 - Cabo Frio' com a loja em Cabo Frio: sem bairro (vale o texto livre)",
    partesDoEnderecoDigitado("Rua X, 10 - Cabo Frio", "Cabo Frio - RJ") === null, pc("Rua X, 10 - Cabo Frio", "Cabo Frio - RJ"));
  confere("balcão: 'Cabo Frio/RJ' e 'CABO FRIO' também são a cidade",
    partesDoEnderecoDigitado("Rua X, 10, Cabo Frio/RJ", "Cabo Frio") === null && partesDoEnderecoDigitado("Rua X, 10 - CABO FRIO", "Cabo Frio/RJ") === null);
  confere("balcão: depois da cidade vem UF — 'Rio de Janeiro' (estado) não vira bairro",
    partesDoEnderecoDigitado("Rua X, 10 - Cabo Frio - Rio de Janeiro", "Cabo Frio - RJ") === null);
  confere("balcão: bairro antes da cidade continua valendo",
    pc("Rua Beira Alta, 11, Vila Monte Alegre, Cabo Frio - RJ", "Cabo Frio - RJ") === JSON.stringify({ street: "Rua Beira Alta", number: "11", neighborhood: "Vila Monte Alegre" }));
  confere("balcão: cidade com hífen no nome ('Embu-Guaçu - SP')", partesDoEnderecoDigitado("Rua X, 10 - Embu-Guaçu", "Embu-Guaçu - SP") === null);
  confere("balcão: bairro com nome parecido com a cidade não é a cidade ('Cabo Frio Sul')",
    pc("Rua X, 10 - Cabo Frio Sul", "Cabo Frio - RJ") === JSON.stringify({ street: "Rua X", number: "10", neighborhood: "Cabo Frio Sul" }));
  const qb = new URLSearchParams(consultaDoBalcao("Rua X, 10 - Cabo Frio", "Cabo Frio - RJ"));
  confere("balcão: a consulta com a cidade vai só com o texto livre", qb.get("address") === "Rua X, 10 - Cabo Frio" && !qb.has("neighborhood"), Object.fromEntries(qb));
}

// ── 10. A TELA E O SERVIDOR CONCORDAM SOBRE "O MESMO ENDEREÇO" ─────────────
{
  // Pares que o servidor considera o mesmo endereço têm de ter a mesma
  // assinatura na tela, e pares diferentes, assinaturas diferentes.
  const casos: [any, any][] = [
    [{ street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" }, { street: "travessa  canaa", number: "6", neighborhood: "BOCA DO MATO" }],
    [{ street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" }, { street: "Travessa Canaã", number: "7", neighborhood: "Boca do Mato" }],
    [{ street: "R", number: "1", neighborhood: "B", lat: -22.854031, lng: -42.029652 }, { street: "R", number: "1", neighborhood: "B", lat: -22.854034, lng: -42.029654 }],
    [{ street: "R", number: "1", neighborhood: "B", lat: -22.854, lng: -42.0296 }, { street: "R", number: "1", neighborhood: "B", lat: -22.86, lng: -42.0296 }],
    [{ street: "R", number: "1", neighborhood: "B" }, { street: "R", number: "1", neighborhood: "B", lat: -22.86, lng: -42.0296 }],
  ];
  for (const [a, b] of casos) {
    const servidorIgual = chaveDoEndereco(a) === chaveDoEndereco(b);
    const telaIgual = assinaturaDaConsulta(a, a.lat != null ? a : null) === assinaturaDaConsulta(b, b.lat != null ? b : null);
    confere(`tela e servidor concordam: ${JSON.stringify(a)} × ${JSON.stringify(b)}`, servidorIgual === telaIgual, { servidorIgual, telaIgual });
  }
  confere("textoLimpo = limpo do servidor (acentos, pontuação)", textoLimpo("  Av. São  João,  nº 10 ") === "av sao joao n 10");
}

// ── 11. SEM ONDE ABRIR O MAPA: O GPS (pedirGps) ───────────────────────────
// Loja por km SEM pino e endereço que o mapa não achou (nem palpite): o
// servidor manda `pedirGps`. A tela mostrava "Marcar no mapa" obrigatório; o
// toque dava "Não consegui abrir o mapa agora", e a recusa do pedido dava DOIS
// alertas seguidos. Agora: UM aviso e o botão do GPS no lugar do mapa.
{
  const CASA: Ponto = { lat: -22.8531, lng: -42.0301 };
  const PINO_DA_LOJA: Ponto = { lat: -22.8792, lng: -42.0187 };
  // A resposta de /api/delivery-fee nesse caso (ramo `soGps` da rota).
  const respostaSoGps = {
    fee: 0, available: false, unknown: true, type: "radius", distanceKm: null, ponto: null,
    precisaConfirmarNoMapa: true, podeConfirmarNoMapa: true, pedirGps: true,
    message: `Não localizamos esse endereço no mapa. Toque em "${BOTAO_DO_GPS}" para calcular a entrega.`,
  };
  const c = lerRespostaDaCotacao(respostaSoGps);
  confere("cotação: lê pedirGps (sem taxa, sem palpite, pede o ponto)",
    c.pedirGps && c.precisaConfirmarNoMapa && c.pontoAproximado === null && c.taxa === null && c.cotacao === null, c);
  confere("cotação: pedirGps sem pedido de mapa não vale (ATENDE)", !lerRespostaDaCotacao({ fee: 5, available: true, pedirGps: true }).pedirGps);
  confere("cotação: sem a bandeira, pedirGps é false", !lerRespostaDaCotacao({ available: false, precisaConfirmarNoMapa: true }).pedirGps);

  // ONDE ABRIR — a tela decide com o que ela tem; sem ela dizer, vale a bandeira.
  confere("temOndeAbrirOMapa: nada que preste", !temOndeAbrirOMapa([null, undefined, { lat: 0, lng: 0 }, { lat: "x", lng: 1 }]));
  confere("temOndeAbrirOMapa: um ponto basta", temOndeAbrirOMapa([null, CASA]));
  confere("gpsNoLugarDoMapa: a bandeira, quando a tela não diz", gpsNoLugarDoMapa({ pedirGps: true }) && !gpsNoLugarDoMapa({}));
  confere("gpsNoLugarDoMapa: com um ponto guardado na tela, o mapa abre ali (GPS de novo daria o mesmo ponto)",
    !gpsNoLugarDoMapa({ pedirGps: true, temOndeAbrirOMapa: true }));
  confere("gpsNoLugarDoMapa: sem onde abrir, GPS mesmo sem a bandeira (o mapa não abriria)",
    gpsNoLugarDoMapa({ pedirGps: false, temOndeAbrirOMapa: false }));

  // O PAINEL.
  const base = {
    bairroLocal: false, calculando: false, calculada: true, disponivel: c.disponivel, erro: false, taxaEfetiva: 0,
    freteGratisPorMinimo: false, precisaConfirmarNoMapa: c.precisaConfirmarNoMapa, pedeConfirmacao: c.pedeConfirmacao,
    podeConferirNoMapa: c.podeConferirNoMapa, temPontoDoCliente: false, distanciaKm: c.distanciaKm, medida: c.medida,
    tempoMin: c.tempoMin, mensagem: c.mensagem,
  };
  const p = painelDaEntrega({ ...base, pedirGps: c.pedirGps, temOndeAbrirOMapa: false });
  confere("painel com pedirGps e sem onde abrir: botão do GPS, NENHUM botão de mapa, a frase do servidor",
    p.botaoDoGps && p.botaoDoMapa === null && p.tom === "alerta" && p.mensagem === respostaSoGps.message, p);
  confere("…e a frase aponta para o botão que está na tela", p.mensagem.includes(`"${BOTAO_DO_GPS}"`), p.mensagem);
  const pSoBandeira = painelDaEntrega({ ...base, pedirGps: true });
  confere("painel só com a bandeira (a tela não disse): GPS", pSoBandeira.botaoDoGps && pSoBandeira.botaoDoMapa === null, pSoBandeira);
  const pComPonto = painelDaEntrega({ ...base, pedirGps: true, temOndeAbrirOMapa: true });
  confere("painel com a bandeira mas um ponto guardado: mapa obrigatório, sem a frase do GPS",
    pComPonto.botaoDoMapa === "obrigatorio" && !pComPonto.botaoDoGps && !pComPonto.mensagem.includes(BOTAO_DO_GPS), pComPonto);
  const pSemBandeira = painelDaEntrega({ ...base, mensagem: "Não localizamos. Confirme no mapa onde fica a sua casa.", temOndeAbrirOMapa: false });
  confere("sem onde abrir e sem a bandeira: GPS, com a frase da tela (a do servidor mandava para o mapa)",
    pSemBandeira.botaoDoGps && pSemBandeira.mensagem.includes(`"${BOTAO_DO_GPS}"`) && !/Confirme no mapa/.test(pSemBandeira.mensagem), pSemBandeira);
  const pAprox = painelDaEntrega({ ...base, disponivel: true, precisaConfirmarNoMapa: false, pedeConfirmacao: true, taxaEfetiva: 10, temOndeAbrirOMapa: false });
  confere("aproximado sem onde abrir: 'Taxa estimada' + GPS",
    pAprox.titulo === "Taxa estimada: R$ 10,00" && pAprox.botaoDoGps && pAprox.botaoDoMapa === null && pAprox.mensagem.includes(BOTAO_DO_GPS), pAprox);
  const pFora = painelDaEntrega({ ...base, precisaConfirmarNoMapa: false, mensagem: "Fora", temOndeAbrirOMapa: false });
  confere("fora da área sem onde abrir: sem o 'conferir no mapa' que não abriria", pFora.botaoDoMapa === null && !pFora.botaoDoGps, pFora);
  const pDepois = painelDaEntrega({
    ...base, disponivel: true, precisaConfirmarNoMapa: false, taxaEfetiva: 5, temPontoDoCliente: true, temOndeAbrirOMapa: true,
    distanciaKm: 0.84, medida: "rota", tempoMin: 30,
  });
  confere("depois do GPS (ATENDE pelo ponto do cliente): taxa em verde, sem o botão do GPS",
    pDepois.tom === "ok" && pDepois.titulo === "Taxa de Entrega: R$ 5,00" && !pDepois.botaoDoGps && pDepois.botaoDoMapa === "opcional", pDepois);
  // Nenhuma combinação mostra os dois botões — nem o de mapa quando não há onde abrir.
  const b = [false, true];
  let doisBotoes = 0, mapaSemOndeAbrir = 0;
  for (const precisa of b) for (const pede of b) for (const disp of b) for (const ponto of b) for (const gps of b) for (const onde of b) {
    const x = painelDaEntrega({ ...base, precisaConfirmarNoMapa: precisa, pedeConfirmacao: pede, disponivel: disp, temPontoDoCliente: ponto, pedirGps: gps, temOndeAbrirOMapa: onde });
    if (x.botaoDoGps && x.botaoDoMapa) doisBotoes++;
    if (!onde && x.botaoDoMapa) mapaSemOndeAbrir++;
  }
  confere("nenhum painel mostra o botão do GPS e o do mapa juntos", doisBotoes === 0, doisBotoes);
  confere("nenhum painel oferece o mapa quando ele não tem onde abrir", mapaSemOndeAbrir === 0, mapaSemOndeAbrir);

  // FINALIZAR.
  const ass = assinaturaDaConsulta({ street: "R", number: "1", neighborhood: "B" });
  const fechar = {
    calculando: false, cotadaPeloServidor: true, assinaturaCotada: ass, assinaturaAtual: ass, idadeDaCotacaoMs: 1000,
    erro: false, calculada: true, disponivel: false, precisaConfirmarNoMapa: true, pedeConfirmacao: false,
    temPontoDoCliente: false, freteGratis: false, mensagem: respostaSoGps.message,
  };
  const f = oQueFaltaParaFechar({ ...fechar, pedirGps: true, temOndeAbrirOMapa: false });
  confere("Finalizar com pedirGps: 'pedir-gps' (UM aviso, a frase do servidor), não 'abrir-mapa'",
    f?.acao === "pedir-gps" && f.mensagem === respostaSoGps.message, f);
  const fComPonto = oQueFaltaParaFechar({ ...fechar, pedirGps: true, temOndeAbrirOMapa: true });
  confere("Finalizar com a bandeira e um ponto guardado: abre o mapa, sem a frase do GPS",
    fComPonto?.acao === "abrir-mapa" && !fComPonto.mensagem.includes(BOTAO_DO_GPS), fComPonto);
  const fAprox = oQueFaltaParaFechar({ ...fechar, disponivel: true, precisaConfirmarNoMapa: false, pedeConfirmacao: true, temOndeAbrirOMapa: false });
  confere("Finalizar aproximado sem onde abrir: GPS", fAprox?.acao === "pedir-gps" && fAprox.mensagem.includes(BOTAO_DO_GPS), fAprox);
  confere("sem as entradas novas, nada muda (abrir-mapa)", oQueFaltaParaFechar(fechar)?.acao === "abrir-mapa");

  // A RECUSA DO POST — a de verdade (lib/entrega-do-pedido.ts, recusaDoSite).
  const veredicto = (v: Partial<VeredictoDeEntrega>): VeredictoDeEntrega =>
    ({ modo: "KM", resultado: "ATENDE", taxa: 5, tempoMin: 30, motivo: "teste", ...v }) as VeredictoDeEntrega;
  const naoSei = entregaDoVeredicto(veredicto({ resultado: "DESCONHECIDO", taxa: null, motivo: "endereço não localizado no mapa" }), null);
  const rs = recusaDoSite(naoSei, { temCoordenadaDoCliente: false, lojaTemPonto: false });
  confere("(pré-condição) o servidor recusa com pedirGps", rs?.corpo.pedirGps === true, rs);
  const telaVazia = [null, undefined, null, null, null];
  const r = lerRecusaDoPedido(rs?.corpo, telaVazia);
  confere("recusa com pedirGps e a tela sem onde abrir: o aviso é a frase do servidor, e depois o GPS (sem mapa)",
    r?.depois === "mostrar-gps" && r.pedirGps && r.precisaConfirmarNoMapa && r.mensagem === rs?.corpo.error, r);
  confere("…e a frase do servidor cita o botão da tela pelo nome", Boolean(rs?.corpo.error.includes(`"${BOTAO_DO_GPS}"`)), rs?.corpo.error);
  const rComPonto = lerRecusaDoPedido(rs?.corpo, [null, CASA]);
  confere("recusa com pedirGps mas um ponto guardado na tela: abre o mapa ali, com a frase do mapa",
    rComPonto?.depois === "abrir-mapa" && !rComPonto.mensagem.includes(BOTAO_DO_GPS), rComPonto);
  const comPalpite = entregaDoVeredicto(veredicto({
    resultado: "DESCONHECIDO", taxa: null, distanciaKm: 5.4, pedeConfirmacao: true, aproximado: true,
    ponto: { lat: -22.8801, lng: -42.0102, origem: "bairro" },
  } as Partial<VeredictoDeEntrega>), null);
  const recusaComPalpite = recusaDoSite(comPalpite, { temCoordenadaDoCliente: false, lojaTemPonto: false });
  const rp = lerRecusaDoPedido(recusaComPalpite?.corpo, telaVazia);
  confere("recusa com palpite: o mapa abre no palpite, mesmo com a tela vazia",
    rp?.depois === "abrir-mapa" && rp.pontoAproximado?.lat === -22.8801 && !rp.pedirGps, rp);
  const recusaComPino = recusaDoSite(naoSei, { temCoordenadaDoCliente: false, lojaTemPonto: true });
  const rComPino = lerRecusaDoPedido(recusaComPino?.corpo, [PINO_DA_LOJA]);
  confere("loja com pino: mapa, sem GPS", rComPino?.depois === "abrir-mapa" && !rComPino.pedirGps, rComPino);
  confere("recusa sem a tela dizer: vale a bandeira", lerRecusaDoPedido(rs?.corpo)?.depois === "mostrar-gps");
  confere("outra recusa (loja fechada, estoque) não é da entrega",
    lerRecusaDoPedido({ error: "Loja fechada" }) === null && lerRecusaDoPedido(null) === null && lerRecusaDoPedido("x") === null);

  // UM AVISO SÓ — a tela como ela é: o aviso da recusa e depois o mapa (que
  // só avisa de novo se não tiver onde abrir) ou o painel do GPS. Para toda
  // recusa da entrega e todo estado da tela, sai exatamente um aviso.
  const corpos: unknown[] = [
    rs?.corpo,
    recusaComPalpite?.corpo,
    recusaComPino?.corpo,
    { error: "Achamos só aproximado. Confirme no mapa.", precisaConfirmarNoMapa: true },
    { error: "x", pedeConfirmacao: true, pedirGps: true },
  ];
  const telas: (Ponto | null)[][] = [[], [null], [CASA], [PINO_DA_LOJA, null]];
  let avisosErrados = 0;
  for (const corpo of corpos) for (const t of telas) {
    const rec = lerRecusaDoPedido(corpo, t);
    if (!rec) { avisosErrados++; continue; }
    let avisos = 1; // alert(recusa.mensagem)
    // abrirMapaDeConfirmacao(palpite) avisa de novo quando o mapa não tem onde abrir.
    if (rec.depois === "abrir-mapa" && !temOndeAbrirOMapa([...t, rec.pontoAproximado])) avisos++;
    if (avisos !== 1) avisosErrados++;
  }
  confere("toda recusa da entrega dá UM aviso só (nunca o 'não consegui abrir o mapa' em seguida)", avisosErrados === 0, avisosErrados);

  // As duas pontas usam o mesmo nome de botão.
  const rotaDaCotacao = readFileSync(join(process.cwd(), "src/app/api/delivery-fee/route.ts"), "utf8");
  confere("/api/delivery-fee cita o botão da tela pelo nome", rotaDaCotacao.includes(`Toque em "${BOTAO_DO_GPS}"`));

  // A tela liga tudo (sem navegador: o texto do componente).
  const tela = readFileSync(join(process.cwd(), "src/components/customer/CustomerStorePage.tsx"), "utf8");
  confere("CustomerStorePage lê a recusa por lerRecusaDoPedido e só abre o mapa quando ele tem onde abrir",
    /lerRecusaDoPedido\(d, ondeOMapaPodeAbrir\(\)\)/.test(tela) && /recusa\.depois === "abrir-mapa"/.test(tela));
  confere("CustomerStorePage trata 'pedir-gps' no Finalizar", /falta\.acao === "pedir-gps"/.test(tela));
  confere("CustomerStorePage mostra o botão do GPS no painel", /painel\.botaoDoGps && \(/.test(tela) && /onClick=\{handleUseGpsLocation\}/.test(tela));
  confere("CustomerStorePage passa pedirGps e onde abrir ao painel e ao Finalizar",
    /pedirGps,\s*temOndeAbrirOMapa: mapaPodeAbrir/.test(tela) && /pedirGps,\s*temOndeAbrirOMapa: temOndeAbrirOMapa\(ondeOMapaPodeAbrir\(\)\)/.test(tela));
  confere("CustomerStorePage guarda a bandeira da cotação", /setPedirGps\(c\.pedirGps\)/.test(tela));
}

corrida().then(() => {
  console.log(`\n${ok} ok, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
});
