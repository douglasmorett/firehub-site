/**
 * SUPERVISOR DO MODO CONTINGÊNCIA — roda no computador do caixa, ligado pelo
 * Assistente de impressão (Obsidian: Projetos/FireHub - Modo Contingência.md).
 *
 * O ciclo, a cada 3 s:
 *
 *   NORMAL        a nuvem responde. A cópia acompanha (espelho a cada ~6 s),
 *                 a tela da TV e do garçom ficam na nuvem, o FireHub local
 *                 fica desligado (sobe na primeira falha, para estar pronto).
 *   CONTINGÊNCIA  4 falhas seguidas (~12 s). O FireHub local atende pela
 *                 porta da loja; tudo o que a loja faz vai para a saída.
 *   VOLTANDO      a nuvem respondeu 7 vezes seguidas (~20 s). A saída sobe
 *                 em lotes; vazia, a cópia se atualiza e volta o NORMAL.
 *
 * A porta da loja (0.0.0.0:7890) atende a TV, o garçom e o navegador do
 * caixa; `/__contingencia/estado` diz em que pé está tudo — o Assistente
 * pergunta ali para saber de que fila imprimir.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { lerConfig, lerEstado, gravarEstado, ipsDaRede, PORTAS, type EstadoGuardado } from "./config";
import { BancoLocal } from "./banco";
import { Nuvem } from "./nuvem";
import { aplicarEsquema, hashDoEsquema, pendentesNaSaida, type EsquemaDoBanco } from "./esquema";
import { esquecerColunas, fazerFoto, puxarEspelho } from "./copia";
import { FireHubLocal } from "./firehub-local";
import { subirSaida } from "./subida";
import { abrirPortaDaLoja, type DecisaoDaPorta } from "./porta-da-loja";
import { garantirAtalho } from "./atalho";

const VERSAO = "0.1.0";

type Modo = "iniciando" | "sem-copia" | "normal" | "contingencia" | "voltando";

function registro(linha: string): void {
  console.log(`[${new Date().toISOString()}] ${linha}`);
}

async function principal(): Promise<void> {
  const cfg = lerConfig();
  // A versão do FireHub que este supervisor roda (o BUILD_ID do pacote): o
  // Assistente reiniciado reconhece por ela o supervisor que segue de pé.
  let versaoDoApp: string | null = null;
  try {
    versaoDoApp = fs.readFileSync(path.join(cfg.appDir, ".next", "BUILD_ID"), "utf8").trim() || null;
  } catch {
    /* pacote sem build do Next: não acontece na loja */
  }
  const estado: EstadoGuardado = lerEstado(cfg);
  gravarEstado(cfg, estado);

  const banco = new BancoLocal(cfg.pgBin, path.join(cfg.pasta, "banco"), PORTAS.banco, cfg.nomeDoBanco, registro);
  await banco.ligar();
  const pool = banco.pool!;
  const nuvem = new Nuvem(cfg.nuvem, cfg.chave);
  const local = new FireHubLocal(
    {
      appDir: cfg.appDir,
      node: cfg.node,
      porta: PORTAS.firehub,
      portaDaLoja: PORTAS.loja,
      bancoUrl: banco.url(),
      segredoLocal: estado.segredoLocal,
      segredoDoBilhete: cfg.segredoDoBilhete,
      loja: cfg.loja,
      pasta: cfg.pasta,
    },
    registro,
  );

  let modo: Modo = "iniciando";
  let falhas = 0;
  let sucessos = 0;
  // Cópia já pronta de antes (supervisor reiniciado): conta da foto até o primeiro espelho.
  let copiaEm: string | null = estado.fotoEm || null;
  let pendentes = await pendentesNaSaida(pool);
  let normalDesde = Date.now();
  let ultimoRelato = 0;
  let ultimaFotoDeClientes = 0;
  let tique = 0;
  let ultimoErro = "";
  /** Falha ao ligar o FireHub local: fica até ele subir (o ciclo apaga o ultimoErro a cada volta). */
  let erroDoLocal = "";
  const ligarLocal = () => {
    local.ligar().then(
      () => { if (local.pronto()) erroDoLocal = ""; },
      (e) => { erroDoLocal = `FireHub local: ${String(e?.message || e)}`; registro(erroDoLocal); },
    );
  };
  /** "Testar agora" (tela do módulo → Assistente): até esta hora, a nuvem conta como fora. */
  let simularQuedaAte = 0;

  // Pronta = a foto foi feita neste esquema. (O cursor pode ser "0" com a
  // cópia pronta: loja recém-ativada ainda sem nada no diário.)
  const copiaPronta = () => !!estado.fotoEm && !!estado.esquema;

  async function sair(): Promise<void> {
    registro("Supervisor encerrando…");
    await local.desligar();
    await banco.desligar();
    process.exit(0);
  }
  const emContingencia = () => modo === "contingencia" || modo === "voltando";

  const estadoPublico = () => ({
    modo,
    pronta: copiaPronta() && local.pronto(),
    testando: Date.now() < simularQuedaAte,
    copiaPronta: copiaPronta(),
    porta: PORTAS.loja,
    nuvem: cfg.nuvem,
    loja: cfg.loja,
    copiaEm,
    pendentes,
    versao: VERSAO,
    app: versaoDoApp,
    ultimoErro: ultimoErro || erroDoLocal || null,
  });

  // ── A porta da loja ────────────────────────────────────────────────────────
  const liberadoSempre = (url: string) =>
    url.startsWith("/contingencia/entrar") ||
    url.startsWith("/api/contingencia/entrar") ||
    url.startsWith("/api/contingencia/sinal") ||
    url.startsWith("/_next/") ||
    url.startsWith("/favicon") ||
    url.startsWith("/firehub-");

  const decidir = (req: http.IncomingMessage): DecisaoDaPorta => {
    const url = req.url || "/";
    if (url.startsWith("/__contingencia/estado")) return { tipo: "responder", status: 200, corpo: estadoPublico() };

    // "Testar agora": só do próprio computador (o Assistente pede, a tela do
    // módulo manda). A nuvem passa a contar como fora por 2 minutos, e o ciclo
    // inteiro roda de verdade — a queda, as telas, a volta e a subida.
    if (url.startsWith("/__contingencia/testar")) {
      const remoto = req.socket.remoteAddress || "";
      const daqui = remoto === "127.0.0.1" || remoto === "::1" || remoto === "::ffff:127.0.0.1";
      if (!daqui || req.method !== "POST") return { tipo: "responder", status: 403, corpo: { error: "Só do computador da loja." } };
      if (!copiaPronta()) return { tipo: "responder", status: 409, corpo: { error: "A cópia da loja ainda está sendo preparada." } };
      simularQuedaAte = Date.now() + 2 * 60_000;
      registro("Teste da contingência: nuvem tratada como fora por 2 minutos.");
      return { tipo: "responder", status: 200, corpo: { ok: true, ate: new Date(simularQuedaAte).toISOString() } };
    }

    // Parar com cuidado (o Assistente pede antes de atualizar ou desativar):
    // desliga o FireHub local e o banco, sem deixar processo órfão.
    if (url.startsWith("/__contingencia/parar")) {
      const remoto = req.socket.remoteAddress || "";
      const daqui = remoto === "127.0.0.1" || remoto === "::1" || remoto === "::ffff:127.0.0.1";
      if (!daqui || req.method !== "POST") return { tipo: "responder", status: 403, corpo: { error: "Só do computador da loja." } };
      setTimeout(() => void sair(), 100);
      return { tipo: "responder", status: 200, corpo: { ok: true, pendentes } };
    }

    // Endereço curto para digitar no controle da TV: leva ao KDS — na nuvem
    // quando ela está de pé, aqui quando caiu.
    if (url === "/tv" || url === "/tv/") {
      return { tipo: "redirecionar", para: `${emContingencia() ? "" : cfg.nuvem}/store/kds/tela` };
    }

    if (emContingencia() || liberadoSempre(url)) return local.pronto() ? { tipo: "repassar" } : { tipo: "esperar" };

    // Nuvem de pé: o computador da loja não atende — a tela volta para a nuvem.
    const html = String(req.headers.accept || "").includes("text/html");
    if (html && req.method === "GET") return { tipo: "redirecionar", para: `${cfg.nuvem}${url}` };
    return { tipo: "responder", status: 503, corpo: { error: "O FireHub está na nuvem agora.", modo } };
  };

  abrirPortaDaLoja({ host: "0.0.0.0", porta: PORTAS.loja, destino: { host: "127.0.0.1", porta: PORTAS.firehub }, decidir });
  registro(`Porta da loja aberta em 0.0.0.0:${PORTAS.loja} (${ipsDaRede().join(", ") || "sem rede"}).`);
  // O ícone "FireHub" na área de trabalho: o jeito de abrir que sempre dá certo (atalho.ts).
  void garantirAtalho({ nuvem: cfg.nuvem, appDir: cfg.appDir, pasta: cfg.pasta }, registro);

  // ── A cópia ────────────────────────────────────────────────────────────────
  const prepararCopia = async () => {
    const esquema = await nuvem.json<EsquemaDoBanco>("/api/contingencia/esquema", { prazoMs: 60_000 });
    const hash = hashDoEsquema(esquema);
    if (hash !== estado.esquema) {
      if (pendentes > 0) {
        registro("O esquema da nuvem mudou, mas há mudanças para subir: a cópia espera a volta.");
      } else {
        if (estado.esquema) {
          registro("O esquema da nuvem mudou: refazendo a cópia.");
          await banco.zerar();
        }
        esquecerColunas();
        await aplicarEsquema(pool, esquema, registro);
        estado.esquema = hash;
        estado.cursor = "0";
        estado.fotoEm = null;
        gravarEstado(cfg, estado);
      }
    }
    if (!estado.fotoEm && pendentes === 0) {
      estado.cursor = await fazerFoto(pool, nuvem, registro);
      estado.fotoEm = new Date().toISOString();
      copiaEm = estado.fotoEm;
      ultimaFotoDeClientes = Date.now();
      gravarEstado(cfg, estado);
    }
  };

  const espelhar = async () => {
    const r = await puxarEspelho(pool, nuvem, estado.cursor);
    if (!r) {
      if (pendentes === 0) {
        registro("A cópia ficou muito tempo parada: foto nova.");
        estado.cursor = "0";
        estado.fotoEm = null;
        await prepararCopia();
      }
      return;
    }
    if (r.cursor !== estado.cursor) {
      estado.cursor = r.cursor;
      gravarEstado(cfg, estado);
    }
    copiaEm = new Date().toISOString();
  };

  const relatar = async () => {
    await nuvem.enviar("/api/contingencia/relato", {
      ...estadoPublico(),
      ips: ipsDaRede(),
      episodio: estado.episodio,
      fotoEm: estado.fotoEm,
    }, 10_000);
  };

  // ── O ciclo ────────────────────────────────────────────────────────────────
  // A primeira vez que uma versão nova do FireHub local sobe neste computador
  // leva quase 1 minuto (o antivírus do Windows examina os arquivos recém-
  // baixados; depois sobe em ~4 s). Por isso ele é ligado uma vez assim que a
  // cópia fica pronta — com a nuvem de pé — e desliga sozinho após 10 min
  // estáveis. De quebra, se ele não subir, o problema aparece na tela do
  // módulo antes de uma queda de verdade.
  let aquecido = false;

  let rodando = false;
  const ciclo = async () => {
    if (rodando) return;
    rodando = true;
    tique++;
    try {
      const ok = Date.now() < simularQuedaAte ? false : await nuvem.deEstaDePe();
      if (ok) { sucessos++; falhas = 0; } else { falhas++; sucessos = 0; }
      pendentes = await pendentesNaSaida(pool);

      switch (modo) {
        case "iniciando":
        case "sem-copia":
          if (ok) {
            await prepararCopia();
            modo = copiaPronta() ? "normal" : "sem-copia";
            normalDesde = Date.now();
            if (modo === "normal") registro("Cópia pronta. Modo normal.");
          } else if (copiaPronta() && falhas >= 4) {
            // Ligou sem internet, mas a cópia de antes está aqui.
            modo = "contingencia";
            estado.episodio = { inicio: new Date().toISOString(), fim: null };
            gravarEstado(cfg, estado);
            registro("Sem conexão desde o início: CONTINGÊNCIA com a cópia que já estava aqui.");
          }
          break;

        case "normal":
          if (ok) {
            if (!aquecido) {
              aquecido = true;
              ligarLocal();
            }
            if (pendentes > 0) await subirSaida(pool, nuvem, null, registro);
            if (tique % 2 === 0) await espelhar();
            if (Date.now() - ultimaFotoDeClientes > 60 * 60_000) {
              await fazerFoto(pool, nuvem, registro, (t) => t === "StoreCustomer");
              ultimaFotoDeClientes = Date.now();
            }
            if (local.ligado() && Date.now() - normalDesde > 10 * 60_000) await local.desligar();
          } else {
            if (falhas >= 1) ligarLocal();
            if (falhas >= 4) {
              modo = "contingencia";
              estado.episodio = { inicio: new Date().toISOString(), fim: null };
              gravarEstado(cfg, estado);
              registro("Nuvem fora há ~12 s: CONTINGÊNCIA. A loja segue no computador.");
            }
          }
          break;

        case "contingencia":
          if (!local.ligado()) ligarLocal();
          if (ok && sucessos >= 7) {
            modo = "voltando";
            if (estado.episodio) estado.episodio.fim = new Date().toISOString();
            gravarEstado(cfg, estado);
            registro(`Nuvem de volta. Subindo ${pendentes} mudança(s) da loja…`);
          }
          break;

        case "voltando":
          if (!ok) {
            modo = "contingencia";
            registro("A nuvem caiu de novo durante a volta: CONTINGÊNCIA.");
            break;
          }
          await subirSaida(pool, nuvem, estado.episodio, registro);
          pendentes = await pendentesNaSaida(pool);
          if (pendentes === 0) {
            await espelhar();
            modo = "normal";
            normalDesde = Date.now();
            estado.episodio = null;
            gravarEstado(cfg, estado);
            registro("Tudo subiu. Modo normal — as telas voltam para a nuvem.");
          }
          break;
      }

      // O relato também prova à nuvem que a internet da loja está de pé — por
      // isso segue durante o "Testar agora" (a queda é só de mentira): sem ele,
      // a proteção "loja sem conexão" pausaria o iFood por causa do teste.
      const testando = Date.now() < simularQuedaAte;
      if ((ok || testando) && Date.now() - ultimoRelato > 30_000) {
        ultimoRelato = Date.now();
        await relatar();
      }
      ultimoErro = "";
    } catch (e: any) {
      ultimoErro = String(e?.message || e);
      registro(`Erro no ciclo: ${ultimoErro}`);
    } finally {
      rodando = false;
    }
  };

  await ciclo();
  setInterval(ciclo, 3000);

  process.on("SIGINT", sair);
  process.on("SIGTERM", sair);
}

principal().catch((e) => {
  registro(`Falha ao iniciar o supervisor: ${e?.stack || e}`);
  process.exit(1);
});
