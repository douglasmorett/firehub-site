/**
 * Trava a MARCA DE VOLTA do Modo Contingência (lib/contingencia/troca.ts):
 * quem manda a tela de volta para a nuvem usa
 *   origem (da lista) + caminho + "#fh-voltou=<ms>&n=<pulos>"
 * e a nuvem lê a marca, espera 1, 3, 10 min antes de pular de novo e limpa o
 * fragmento sem tocar na query. Também confere que a página de troca do
 * service worker (public/sw-contingencia.js) é JavaScript válido.
 *
 * Por quê: na noite de 14/10/2026 (Hakim Centro) a trava de 60 s contra o
 * vaivém era gravada no sessionStorage do endereço da loja e lida no da
 * nuvem — outro armazenamento — e nunca funcionou.
 *
 *   npx tsx scripts/teste-marca-de-volta.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ESPERAS_ENTRE_PULOS_MS, ORIGENS_DA_NUVEM, VOLTA_PADRAO, esperaDepoisDaVolta, gravarPreferencias, lerMarcaDeVolta,
  lerPreferencias, lerVoltaGuardada, origemValida, preferenciasDoFragmento, preferenciasValidas, urlDeVolta, voltaSegura,
} from "../src/lib/contingencia/troca";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};

/** Um localStorage de mentira. */
function armazenamento(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    tudo: () => Object.fromEntries(m),
  };
}

const EM = 1_760_000_000_000;

console.log("— Montar e ler a marca —");
{
  const kds = "/store/kds/tela?stage=finishing&nome=Finaliza%C3%A7%C3%A3o&id=abc";
  const url = urlDeVolta({ origem: "https://www.firehubfood.com.br", volta: kds, em: EM, n: 2 });
  const u = new URL(url);
  confere("volta para o mesmo endereço com www de onde saiu", u.origin === "https://www.firehubfood.com.br", url);
  confere("preserva o caminho e a query do KDS (?stage=finishing&…)", u.pathname + u.search === kds, u.pathname + u.search);
  confere("a marca vai no fragmento", u.hash === `#fh-voltou=${EM}&n=2`, u.hash);
  const marca = lerMarcaDeVolta(u.hash);
  confere("lê a marca de volta", marca?.em === EM && marca?.n === 2, marca);
  // O que a nuvem faz depois de ler: history.replaceState(…, pathname + search).
  confere("limpar o fragmento deixa a query intacta", `${u.pathname}${u.search}` === kds && !`${u.pathname}${u.search}`.includes("fh-voltou"));
  confere("sem marca: null", lerMarcaDeVolta("") === null && lerMarcaDeVolta("#bilhete=x&volta=/store") === null);
  confere("marca com hora inválida: null", lerMarcaDeVolta("#fh-voltou=abc&n=1") === null);
  confere("marca sem n conta como 1º pulo", lerMarcaDeVolta(`#fh-voltou=${EM}`)?.n === 1);
  const semWww = urlDeVolta({ origem: "https://firehubfood.com.br", volta: "/store", em: EM, n: 1 });
  confere("sem www volta sem www", semWww.startsWith("https://firehubfood.com.br/store#fh-voltou="), semWww);
  confere("um # que estivesse no caminho não duplica o fragmento", urlDeVolta({ origem: ORIGENS_DA_NUVEM[0], volta: "/store#x", em: EM, n: 1 }).split("#").length === 2);
}

console.log("\n— Nada de redirecionar para fora —");
{
  const evil = urlDeVolta({ origem: ORIGENS_DA_NUVEM[0], volta: "//evil.com/x", em: EM, n: 1 });
  confere("volta=//evil vira o caminho padrão", new URL(evil).origin === ORIGENS_DA_NUVEM[0] && new URL(evil).pathname === VOLTA_PADRAO, evil);
  confere("voltaSegura rejeita //evil, /\\evil, https://evil e vazio", [
    "//evil.com", "/\\evil.com", "https://evil.com/store", "", "store",
  ].every((v) => voltaSegura(v) === null));
  confere("voltaSegura aceita caminho do site", voltaSegura("/store/kds/tela?stage=finishing") === "/store/kds/tela?stage=finishing");
  const fora = urlDeVolta({ origem: "https://evil.com", volta: "/store", em: EM, n: 1 });
  confere("origem fora da lista vira a de sempre", fora.startsWith(`${ORIGENS_DA_NUVEM[0]}/store#`), fora);
  const parecida = urlDeVolta({ origem: "https://firehubfood.com.br.evil.com", volta: "/store", em: EM, n: 1 });
  confere("origem parecida (firehubfood.com.br.evil.com) também não passa", parecida.startsWith(`${ORIGENS_DA_NUVEM[0]}/store#`), parecida);
  confere("http sem s também não passa", origemValida("http://firehubfood.com.br") === null);
  const reserva = urlDeVolta({ origem: null, reserva: "https://www.firehubfood.com.br", volta: "/store", em: EM, n: 1 });
  confere("sem origem da tela: usa a reserva do supervisor (se estiver na lista)", reserva.startsWith("https://www.firehubfood.com.br/store#"), reserva);
  const reservaRuim = urlDeVolta({ origem: null, reserva: "https://evil.com", volta: "/store", em: EM, n: 1 });
  confere("reserva fora da lista também não passa", reservaRuim.startsWith(`${ORIGENS_DA_NUVEM[0]}/store#`), reservaRuim);
  confere("origem que o supervisor conhece (nuvem de teste) passa", origemValida("http://127.0.0.1:3999", ["http://127.0.0.1:3999"]) === "http://127.0.0.1:3999");
  confere("barra no fim da origem não atrapalha", origemValida("https://www.firehubfood.com.br/") === "https://www.firehubfood.com.br");
}

console.log("\n— Espera crescente entre pulos —");
{
  confere("esperas de 1, 3 e 10 min", JSON.stringify(ESPERAS_ENTRE_PULOS_MS) === JSON.stringify([60_000, 180_000, 600_000]));
  confere("1º pulo: espera 1 min", esperaDepoisDaVolta({ em: EM, n: 1 }, EM + 10_000) === 50_000);
  confere("2º pulo: espera 3 min", esperaDepoisDaVolta({ em: EM, n: 2 }, EM + 60_000) === 120_000);
  confere("3º pulo: espera 10 min", esperaDepoisDaVolta({ em: EM, n: 3 }, EM + 60_000) === 540_000);
  confere("7º pulo: continua 10 min", esperaDepoisDaVolta({ em: EM, n: 7 }, EM) === 600_000);
  confere("passou a espera: livre", esperaDepoisDaVolta({ em: EM, n: 1 }, EM + 61_000) === 0);
  confere("sem marca: livre", esperaDepoisDaVolta(null, EM) === 0);
  confere("relógio do aparelho atrás da marca: espera inteira, não negativa nem infinita", esperaDepoisDaVolta({ em: EM + 30_000, n: 1 }, EM) === 60_000);
  const guardado = armazenamento({ firehub_contingencia_voltou: JSON.stringify({ em: EM, n: 2 }) });
  confere("lê a marca guardada no localStorage da nuvem", JSON.stringify(lerVoltaGuardada(guardado)) === JSON.stringify({ em: EM, n: 2 }));
  confere("marca guardada ilegível: null", lerVoltaGuardada(armazenamento({ firehub_contingencia_voltou: "{" })) === null);
}

console.log("\n— Som e posição do KDS vão junto —");
{
  const tv = armazenamento({ "kds-som": "1", "kds-rotacao:tela-123": "90", "kds-rotacao:producao:Cozinha": "270", firehub_contingencia: "{}", "outra-coisa": "1" });
  const prefs = lerPreferencias(tv);
  confere("lê só kds-som e kds-rotacao:<tela>", JSON.stringify(prefs) === JSON.stringify({ "kds-som": "1", "kds-rotacao:tela-123": "90", "kds-rotacao:producao:Cozinha": "270" }), prefs);
  const url = urlDeVolta({ origem: ORIGENS_DA_NUVEM[0], volta: "/store/kds/tela?stage=production", em: EM, n: 1, preferencias: prefs });
  const lidas = lerMarcaDeVolta(new URL(url).hash)?.preferencias;
  confere("as preferências vão e voltam no fragmento", JSON.stringify(lidas) === JSON.stringify(prefs), lidas);
  const destino = armazenamento();
  gravarPreferencias(destino, lidas);
  confere("e são gravadas na origem de destino", destino.getItem("kds-som") === "1" && destino.getItem("kds-rotacao:tela-123") === "90");
  const malicioso = new URLSearchParams({ p: JSON.stringify({ firehub_contingencia: "{}", "kds-som": "<script>", "kds-rotacao:x": "45", "kds-rotacao:y": "270" }) });
  confere("do link só entra chave e valor conhecidos", JSON.stringify(preferenciasDoFragmento(malicioso)) === JSON.stringify({ "kds-rotacao:y": "270" }), preferenciasDoFragmento(malicioso));
  const comEspaco = preferenciasValidas({ "kds-rotacao:production:Cozinha Quente": "90", "kds-rotacao:x\ny": "90" });
  confere("tela sem id (nome com espaço) também leva a posição; quebra de linha não", JSON.stringify(comEspaco) === JSON.stringify({ "kds-rotacao:production:Cozinha Quente": "90" }), comEspaco);
  confere("p ilegível: nada", JSON.stringify(preferenciasDoFragmento(new URLSearchParams("p=%7B"))) === "{}");
  confere("sem preferências, o fragmento fica só com a marca", !urlDeVolta({ origem: ORIGENS_DA_NUVEM[0], volta: "/store", em: EM, n: 1 }).includes("&p="));
}

console.log("\n— A página de troca do service worker —");
{
  const sw = readFileSync(join(__dirname, "..", "public", "sw-contingencia.js"), "utf8");
  const inicio = sw.indexOf("<script>") + "<script>".length;
  const fim = sw.indexOf("</script>");
  const script = sw.slice(inicio, fim).replace("__QUEDA_MS__", "45000").replace("__QUEDA_DESDE__", "0");
  let ok = true;
  try {
    // Só compila (não roda): um erro de sintaxe deixaria a TV no branco.
    new Function(script);
  } catch (e) {
    ok = false;
    console.log(String(e));
  }
  confere("o script da página compila", ok);
  confere("os dois marcadores são trocados", sw.includes('PAGINA.replace("__QUEDA_MS__"') && sw.includes('.replace("__QUEDA_DESDE__"'));
  confere("a página leva origem, n e as preferências no pulo", sw.includes('"&origem="') && sw.includes('"&n="') && sw.includes('"&p="'));
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
