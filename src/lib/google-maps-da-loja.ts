/**
 * A CONTA DO GOOGLE DA LOJA (01/11/2026, decisão do Douglas).
 *
 * Cada loja pode conectar a própria chave da Google Maps Platform. Quem não
 * conecta segue com o mapa aberto (OpenStreetMap/Nominatim) sem mudança
 * nenhuma. Quem conecta passa a ter o ponto do endereço pelo Google ANTES do
 * mapa aberto — na cotação (site, robô, balcão: lib/area-de-entrega.ts →
 * lib/geocoding.ts, `googlePrimeiro`) e na roteirização
 * (lib/geocodificacao-servidor.ts, `resolverPontosNoServidor`). Falhou, cota,
 * chave recusada: cai no fluxo de sempre.
 *
 * Por quê: Divinos Burger (Cabo Frio) — o OSM não tem várias ruas e erra os
 * bairros; o Google acerta. Cada loja usa a cota grátis da PRÓPRIA conta
 * (10 mil consultas por mês no Geocoding API), então nunca acaba para nós.
 *
 * Este arquivo é a parte pura (testada em scripts/teste-google-maps-da-loja.ts):
 * o formato da chave, a URL do teste e a leitura da resposta do teste. O banco
 * (chave cifrada, contador do mês) mora em lib/google-maps-da-loja-servidor.ts.
 */

const URL_DO_GEOCODING = "https://maps.googleapis.com/maps/api/geocode/json";

/** Tira espaço e aspas que vêm junto no copiar e colar. */
export function limparChave(bruta: unknown): string {
  return String(bruta ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}

/** A chave da Google Maps Platform: "AIza" + 35 caracteres. */
export function formatoDeChaveValido(chave: string): boolean {
  return /^AIza[0-9A-Za-z_-]{35}$/.test(chave);
}

/** O que a tela mostra no lugar da chave: só os 4 últimos. */
export function finalDaChave(chave: string): string {
  return chave.slice(-4);
}

/** O mês do contador de uso, no fuso de Brasília ("2026-11"). */
export function mesDoUso(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** As buscas do mês, lidas do contador `{ "2026-11": 123 }`. */
export function buscasNoMes(uso: unknown, mes: string = mesDoUso()): number {
  const n = Number((uso as Record<string, unknown> | null)?.[mes]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * A URL do teste da chave: um endereço da cidade da loja, no Brasil, em
 * português. Uma consulta só (conta 1 das 10 mil do mês).
 */
export function urlDoTesteDaChave(chave: string, cidade: string | null | undefined, estado?: string | null): string {
  const lugar = [String(cidade || "").trim() || "São Paulo", String(estado || "").trim()].filter(Boolean).join(", ");
  const params = new URLSearchParams({
    address: `Centro, ${lugar}`,
    components: "country:BR",
    region: "br",
    language: "pt-BR",
    key: chave,
  });
  return `${URL_DO_GEOCODING}?${params}`;
}

export type ResultadoDoTeste = { ok: true } | { ok: false; erro: string };

/**
 * A resposta do teste em português simples. "OK" e "ZERO_RESULTS" querem dizer
 * que a chave FUNCIONA (o Google respondeu); o resto diz o que falta ligar.
 * As frases são as que o Google devolve em `error_message` (2025–2026).
 */
export function lerTesteDaChave(d: any): ResultadoDoTeste {
  const status = String(d?.status || "");
  if (status === "OK" || status === "ZERO_RESULTS") return { ok: true };
  const msg = String(d?.error_message || "").toLowerCase();

  if (/billing/.test(msg)) {
    return { ok: false, erro: "O faturamento não está ativado no projeto do Google Cloud. Ative o faturamento (cadastre o cartão) — dentro das 10 mil buscas do mês o Google não cobra." };
  }
  if (/referer/.test(msg)) {
    return { ok: false, erro: "A chave está restrita por site (referenciador HTTP), e o FireHub busca os endereços pelo servidor. Em Credenciais → sua chave, deixe Restrições do aplicativo em Nenhum e use só as Restrições de API (Geocoding API e Maps JavaScript API)." };
  }
  if (/ip, site or mobile application|ip address|use this api key/.test(msg)) {
    return { ok: false, erro: "A chave está restrita (por IP, app ou site) e o FireHub não pode usar. Em Credenciais → sua chave, deixe Restrições do aplicativo em Nenhum e use só as Restrições de API (Geocoding API e Maps JavaScript API)." };
  }
  if (/not authorized to use this api|not activated|has not been used|is disabled|api project is not authorized/.test(msg)) {
    return { ok: false, erro: "A Geocoding API não está ativada nesse projeto (ou a chave não permite essa API). No Google Cloud, vá em APIs e serviços → Biblioteca, procure Geocoding API e clique em Ativar; e em Credenciais → sua chave → Restrições de API, deixe a Geocoding API marcada." };
  }
  if (/invalid|expired/.test(msg)) {
    return { ok: false, erro: "Essa chave não é válida (ou foi apagada). Copie de novo a chave em Credenciais no Google Cloud e cole aqui." };
  }
  if (status === "OVER_QUERY_LIMIT" || status === "OVER_DAILY_LIMIT") {
    return { ok: false, erro: "O Google recusou por limite de uso ou faturamento. Confira se o faturamento está ativo e se não há cota diária baixa configurada na Geocoding API." };
  }
  if (status === "REQUEST_DENIED") {
    return { ok: false, erro: `O Google recusou a chave${d?.error_message ? `: ${String(d.error_message).slice(0, 160)}` : "."} Confira se a Geocoding API e o faturamento estão ativos.` };
  }
  return { ok: false, erro: `O Google não respondeu como esperado (${status || "sem resposta"}). Tente de novo em instantes.` };
}

export type OrigemDaChave = "LOJA" | "PLATAFORMA";

/**
 * A escolha da chave (pura; quem lê o banco é chaveGoogleDaLoja): a da loja,
 * quando ela conectou; sem ela, a do FireHub (env) SÓ para as lojas Hakim;
 * senão null — o mapa aberto de sempre.
 */
export function escolherChaveDoGoogle(o: {
  chaveDaLoja: string | null | undefined;
  hakim: boolean;
  chaveDoAmbiente: string | null | undefined;
}): { chave: string; origem: OrigemDaChave } | null {
  if (o.chaveDaLoja) return { chave: o.chaveDaLoja, origem: "LOJA" };
  if (o.hakim && o.chaveDoAmbiente) return { chave: o.chaveDoAmbiente, origem: "PLATAFORMA" };
  return null;
}

/**
 * Na roteirização da loja com a conta do Google: quando o ponto do Google vale
 * (e quando se cai no mapa aberto). Só com a resposta (`ok`), um ponto da CASA
 * ou da RUA — o "só o bairro" do Google não ganha da cascata do mapa aberto,
 * que tem as entregas da loja — e dentro da área da loja (`plausivel`).
 * Qualquer outra coisa: null, segue o fluxo de sempre.
 */
export function pontoDoGoogleQueServe<T extends { precisao: string }>(
  resposta: { ok: true; valor: T | null } | { ok: false; motivo: string } | null | undefined,
  plausivel: (v: T) => boolean,
): T | null {
  if (!resposta || !resposta.ok || !resposta.valor) return null;
  const v = resposta.valor;
  if (v.precisao !== "endereco" && v.precisao !== "rua") return null;
  return plausivel(v) ? v : null;
}

/**
 * O passo a passo de conectar (a tela da roteirização e /tutoriais/google-maps
 * mostram esta mesma lista). `**texto**` sai em negrito.
 */
export const PASSOS_PARA_CONECTAR: string[] = [
  "Entre em **console.cloud.google.com** com a conta do Google da loja e crie um projeto (ex.: \"Mapa da loja\").",
  "Ative o **faturamento**: menu Faturamento → vincular conta de faturamento e cadastre o cartão. Dentro das 10.000 buscas do mês não há cobrança.",
  "Em **APIs e serviços → Biblioteca**, procure e ative a **Geocoding API** e a **Maps JavaScript API**.",
  "Em **APIs e serviços → Credenciais**, clique em **Criar credenciais → Chave de API**. Na chave, em **Restrições de API**, marque \"Restringir chave\" e escolha só a **Geocoding API** e a **Maps JavaScript API** (em \"Restrições do aplicativo\" deixe Nenhum). Salve.",
  "Copie a chave (começa com **AIza**), cole no FireHub (Roteirização → Problemas no mapa? → Conectar mapa do Google) e clique em **Conectar mapa do Google**. O FireHub testa a chave na hora.",
];

/** "a **b** c" → partes para negrito: [{t:"a "}, {t:"b", negrito:true}, {t:" c"}]. */
export function partesDoPasso(passo: string): { t: string; negrito: boolean }[] {
  return passo.split("**").map((t, i) => ({ t, negrito: i % 2 === 1 })).filter((x) => x.t);
}

/** O texto da faixa (Douglas, 01/11/2026). */
export const TEXTO_DA_FAIXA =
  "Use o mapa do Google: conecte a conta do Google da sua loja e o FireHub passa a achar endereços e bairros pelo Google e mostrar suas rotas no mapa do Google. É grátis até 10.000 buscas por mês (uma loja normalmente não chega nisso); o Google só pede um cartão cadastrado.";
