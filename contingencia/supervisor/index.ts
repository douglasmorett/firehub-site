/**
 * SUPERVISOR DO MODO CONTINGÊNCIA — roda no computador do caixa, ligado pelo
 * Assistente de impressão (Obsidian: Projetos/FireHub - Modo Contingência.md).
 *
 * O ciclo, a cada 3 s:
 *
 *   NORMAL        a nuvem responde. A cópia acompanha (espelho a cada ~6 s),
 *                 a tela da TV e do garçom ficam na nuvem, o FireHub local
 *                 fica desligado (sobe na primeira falha, para estar pronto,
 *                 e só desce 10 min depois da ÚLTIMA falha).
 *   CONTINGÊNCIA  a nuvem fora há ~30 s (LIMIAR_DA_QUEDA_MS, regras.ts). O
 *                 FireHub local atende pela porta da loja; tudo o que a loja
 *                 faz vai para a saída.
 *   VOLTANDO      a nuvem respondeu 7 vezes seguidas (~20 s). A saída sobe
 *                 em lotes; vazia, a cópia se atualiza e volta o NORMAL.
 *                 Se a subida falhar 5 vezes seguidas, volta o NORMAL assim
 *                 mesmo (as telas não ficam presas na cópia): a saída fica
 *                 guardada, sobe no normal e o erro aparece no módulo.
 *
 *   REVOGADA      a nuvem recusa a chave da loja há mais de 1 min (a
 *                 contingência foi ativada noutro computador ou desativada):
 *                 o FireHub local desliga e a porta só devolve para a nuvem.
 *                 O que estiver na saída fica guardado — nada é apagado.
 *
 * A porta da loja (0.0.0.0:7890) atende a TV, o garçom e o navegador do
 * caixa; `/__contingencia/estado` diz em que pé está tudo — o Assistente
 * pergunta ali para saber de que fila imprimir. Ela abre antes do banco
 * (modo "iniciando"): a tela que chega na troca de versão não dá de cara
 * com a porta fechada.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { lerConfig, lerEstado, gravarEstado, ipsDaRede, PORTAS, type EstadoGuardado } from "./config";
import { BancoLocal } from "./banco";
import { ErroDaNuvem, Nuvem } from "./nuvem";
import { aplicarEsquema, hashDoEsquema, pendentesNaSaida, type EsquemaDoBanco } from "./esquema";
import { esquecerColunas, fazerFoto, puxarEspelho } from "./copia";
import { FireHubLocal } from "./firehub-local";
import { FALHAS_DA_SUBIDA_ATE_DESISTIR, passoDaVolta, subirSaida } from "./subida";
import { abrirPortaDaLoja, paginaDaEntrada, type DecisaoDaPorta } from "./porta-da-loja";
import { garantirAtalho, origensDaNuvem } from "./atalho";
import {
  chaveRecusada,
  decidirRota,
  deveDesligarLocal,
  emContingencia as modoEmContingencia,
  LIMIAR_DA_QUEDA_MS,
  MANTER_LIGADO_NA_ENTRADA_MS,
  nuvemCaiu,
  type ModoDoSupervisor,
} from "./regras";

const VERSAO = "0.1.0";

type Modo = ModoDoSupervisor;

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
  /** Quando veio a primeira falha da série atual (a queda conta no relógio, não em falhas). */
  let primeiraFalhaEm = 0;
  /** A última falha da nuvem, em qualquer série: o FireHub local só desce 10 min depois dela. */
  let ultimaFalhaEm = 0;
  let ultimoOkEm = 0;
  /** Um aparelho chegou à porta com o supervisor vendo falhas: o local fica ligado ao menos até aqui. */
  let manterLigadoAte = 0;
  // Cópia já pronta de antes (supervisor reiniciado): conta da foto até o primeiro espelho.
  let copiaEm: string | null = estado.fotoEm || null;
  // Lido do banco assim que ele sobe (a porta abre antes).
  let pendentes = 0;
  let normalDesde = Date.now();
  let ultimoRelato = 0;
  // Da foto que já estava aqui: sem isto, cada religada do supervisor refazia a
  // foto de clientes no primeiro ciclo (achado foto-1).
  let ultimaFotoDeClientes = Date.parse(estado.fotoEm || "") || 0;
  let tique = 0;
  let ultimoErro = "";
  /** Falha ao ligar o FireHub local: fica até ele subir (o ciclo apaga o ultimoErro a cada volta). */
  let erroDoLocal = "";
  /**
   * A volta que não sobe: fica à vista (tela do módulo, relato) até a saída
   * esvaziar. As falhas seguidas contam só no modo "voltando" (passoDaVolta).
   */
  let erroDaVolta = "";
  let falhasDaSubida = 0;
  /** No modo normal, a saída que falhou espera 1 minuto para tentar de novo (não martela a nuvem a cada 3 s). */
  let proximaSubidaEm = 0;
  const ligarLocal = () => {
    local.ligar().then(
      () => { if (local.pronto()) erroDoLocal = ""; },
      (e) => { erroDoLocal = `FireHub local: ${String(e?.message || e)}`; registro(erroDoLocal); },
    );
  };
  /** "Testar agora" (tela do módulo → Assistente): até esta hora, a nuvem conta como fora. */
  let simularQuedaAte = 0;
  /** Chave recusada: o motivo fica à vista na tela do módulo enquanto durar. */
  let erroDaRevogacao = "";
  let ultimaTentativaRevogada = 0;

  // Pronta = a foto foi feita neste esquema. (O cursor pode ser "0" com a
  // cópia pronta: loja recém-ativada ainda sem nada no diário.)
  const copiaPronta = () => !!estado.fotoEm && !!estado.esquema;

  /** O banco subindo (a porta abre antes dele): quem pede para parar nessa hora espera ele terminar, para não deixar o Postgres órfão. */
  let bancoSubindo: Promise<void> | null = null;

  async function sair(): Promise<void> {
    registro("Supervisor encerrando…");
    if (bancoSubindo) await Promise.race([bancoSubindo.catch(() => {}), new Promise((r) => setTimeout(r, 60_000))]);
    await local.desligar();
    await banco.desligar();
    process.exit(0);
  }
  const emContingencia = () => modoEmContingencia(modo);

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
    ultimoErro: erroDaRevogacao || ultimoErro || erroDaVolta || erroDoLocal || null,
    // Para a página de entrada (porta-da-loja.ts) e as telas da nuvem:
    /** Falhas seguidas da nuvem vistas daqui (0 = em paz). */
    falhas,
    ultimoOkEm: ultimoOkEm ? new Date(ultimoOkEm).toISOString() : null,
    /** Para onde uma tela pode voltar (com e sem "www"). */
    origensDaNuvem: origensDaNuvem(cfg.nuvem),
    origemDoPainel: estado.origemDoPainel || null,
    revogada: modo === "revogada",
  });

  // ── A porta da loja ────────────────────────────────────────────────────────

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

    // A tela do painel aberta NESTE computador conta em que endereço a loja usa
    // o FireHub (com ou sem "www" — cada um guarda a própria entrada). O atalho
    // da área de trabalho passa a abrir esse. Página https chamando a rede
    // local: precisa da licença de CORS e de rede privada (Chrome).
    if (url.startsWith("/__contingencia/origem")) {
      const cors = {
        "access-control-allow-origin": String(req.headers.origin || "*"),
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-allow-private-network": "true",
        vary: "origin",
      };
      if (req.method === "OPTIONS") return { tipo: "responder", status: 204, corpo: undefined, cabecalhos: cors };
      const remoto = req.socket.remoteAddress || "";
      const daqui = remoto === "127.0.0.1" || remoto === "::1" || remoto === "::ffff:127.0.0.1";
      if (!daqui || req.method !== "POST") return { tipo: "responder", status: 403, corpo: { error: "Só do computador da loja." }, cabecalhos: cors };
      const de = new URL(url, "http://loja").searchParams.get("de") || "";
      if (!origensDaNuvem(cfg.nuvem).includes(de)) return { tipo: "responder", status: 400, corpo: { error: "Endereço desconhecido." }, cabecalhos: cors };
      if (estado.origemDoPainel !== de) {
        estado.origemDoPainel = de;
        gravarEstado(cfg, estado);
        registro(`O painel deste computador usa ${de}: o atalho passa a abrir esse endereço.`);
        void garantirAtalho({ nuvem: de, appDir: cfg.appDir, pasta: cfg.pasta }, registro);
      }
      return { tipo: "responder", status: 200, corpo: { ok: true }, cabecalhos: cors };
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

    // O resto (a TV, o garçom, a entrada com o bilhete) segue a regra de regras.ts.
    const d = decidirRota({
      url,
      metodo: req.method || "GET",
      html: String(req.headers.accept || "").includes("text/html"),
      modo,
      localPronto: local.pronto(),
      // No "Testar agora" a falha é de mentira, mas conta desde já: o aparelho
      // que chega antes do ciclo acorda o FireHub local e espera.
      falhas: Date.now() < simularQuedaAte ? Math.max(falhas, 1) : falhas,
      nuvem: cfg.nuvem,
    });
    switch (d.tipo) {
      case "entrada":
        // O aparelho percebeu a queda antes deste computador: o FireHub local
        // sobe já e fica ligado uns minutos, para a contingência que vem.
        if (d.acordarLocal) {
          manterLigadoAte = Math.max(manterLigadoAte, Date.now() + MANTER_LIGADO_NA_ENTRADA_MS);
          ligarLocal();
        }
        return { tipo: "pagina", status: 200, html: paginaDaEntrada() };
      case "na-nuvem":
        return { tipo: "responder", status: 503, corpo: { error: "O FireHub está na nuvem agora.", modo } };
      default:
        return d;
    }
  };

  // A porta abre ANTES do banco: na troca de versão do supervisor ela ficava
  // fechada ~17 s, e a tela que pulava nessa hora caía no erro do navegador.
  abrirPortaDaLoja({ host: "0.0.0.0", porta: PORTAS.loja, destino: { host: "127.0.0.1", porta: PORTAS.firehub }, decidir, registro });
  registro(`Porta da loja aberta em 0.0.0.0:${PORTAS.loja} (${ipsDaRede().join(", ") || "sem rede"}).`);
  // O ícone "FireHub" na área de trabalho: o jeito de abrir que sempre dá certo (atalho.ts),
  // no endereço que o painel deste computador usa (com ou sem "www").
  void garantirAtalho({ nuvem: estado.origemDoPainel || cfg.nuvem, appDir: cfg.appDir, pasta: cfg.pasta }, registro);

  bancoSubindo = banco.ligar();
  await bancoSubindo;
  bancoSubindo = null;
  const pool = banco.pool!;
  pendentes = await pendentesNaSaida(pool);

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
      // A chave recusada vários minutos seguidos: este computador não é mais
      // o da contingência da loja (ativada noutro, ou desativada). Antes ele
      // ficava "zumbi": entrava em contingência com cópia velha e preso no
      // "voltando". Com vendas na saída, NADA é apagado — ficam aqui e o
      // aviso aparece na tela do módulo.
      if (modo !== "revogada" && chaveRecusada({ recusas: nuvem.recusasSeguidas, primeiraRecusaEm: nuvem.primeiraRecusaEm, agora: Date.now() })) {
        modo = "revogada";
        ultimaTentativaRevogada = Date.now();
        erroDaRevogacao = pendentes > 0
          ? `A nuvem recusou a chave deste computador: a contingência da loja não está mais aqui. ${pendentes} mudança(s) feitas aqui numa queda seguem guardadas — chame o suporte para subir.`
          : "A nuvem recusou a chave deste computador: a contingência da loja não está mais aqui.";
        registro(`Chave recusada pela nuvem ${nuvem.recusasSeguidas} vezes: modo REVOGADA (FireHub local desligado, a porta só devolve para a nuvem; ${pendentes} pendente(s) guardado(s)).`);
        await local.desligar();
      }

      const agora = Date.now();
      const ok = agora < simularQuedaAte ? false : await nuvem.deEstaDePe();
      if (ok) {
        sucessos++;
        falhas = 0;
        primeiraFalhaEm = 0;
        ultimoOkEm = Date.now();
      } else {
        if (falhas === 0) primeiraFalhaEm = Date.now();
        falhas++;
        sucessos = 0;
        ultimaFalhaEm = Date.now();
      }
      pendentes = await pendentesNaSaida(pool);
      const caiu = nuvemCaiu({ falhas, primeiraFalhaEm, agora: Date.now() });
      const foraHa = () => Math.round((Date.now() - primeiraFalhaEm) / 1000);

      switch (modo) {
        case "iniciando":
        case "sem-copia":
          if (ok) {
            await prepararCopia();
            modo = copiaPronta() ? "normal" : "sem-copia";
            normalDesde = Date.now();
            if (modo === "normal") registro("Cópia pronta. Modo normal.");
          } else if (copiaPronta() && caiu) {
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
            // A subida no normal (o que sobrou de uma volta que desistiu de
            // esperar) não pode impedir o espelho: cada uma no seu try.
            if (pendentes > 0 && Date.now() >= proximaSubidaEm) {
              try {
                await subirSaida(pool, nuvem, estado.episodio, registro);
                pendentes = await pendentesNaSaida(pool);
                if (pendentes === 0 && (erroDaVolta || estado.episodio)) {
                  erroDaVolta = "";
                  estado.episodio = null;
                  gravarEstado(cfg, estado);
                  registro("O que tinha ficado da volta subiu. Saída vazia.");
                }
              } catch (e: any) {
                proximaSubidaEm = Date.now() + 60_000;
                erroDaVolta = `${pendentes} mudança(s) da loja ainda não subiram para a nuvem: ${String(e?.message || e)}`;
                registro(erroDaVolta);
              }
            }
            if (tique % 2 === 0) await espelhar();
            if (Date.now() - ultimaFotoDeClientes > 60 * 60_000) {
              await fazerFoto(pool, nuvem, registro, (t) => t === "StoreCustomer");
              ultimaFotoDeClientes = Date.now();
            }
            // Desliga só 10 min depois da ÚLTIMA falha (antes contava da entrada
            // no normal: subia num soluço e morria 2 a 5 s depois, a noite toda).
            if (deveDesligarLocal({
              ligado: local.ligado(),
              subindo: local.subindoAgora(),
              agora: Date.now(),
              normalDesde,
              ultimaFalhaEm,
              manterLigadoAte,
            })) await local.desligar();
          } else {
            if (falhas >= 1) ligarLocal();
            if (caiu) {
              modo = "contingencia";
              estado.episodio = { inicio: new Date().toISOString(), fim: null };
              gravarEstado(cfg, estado);
              registro(`Nuvem fora há ${foraHa()} s (${falhas} falhas; limiar ${LIMIAR_DA_QUEDA_MS / 1000} s): CONTINGÊNCIA. A loja segue no computador.`);
            }
          }
          break;

        case "contingencia":
          // Ligado mas sem responder e sem ninguém esperando por ele: volta a esperar (e reinicia se travou).
          if (!local.ligado() || (!local.pronto() && !local.subindoAgora())) ligarLocal();
          if (ok && sucessos >= 7) {
            modo = "voltando";
            if (estado.episodio) estado.episodio.fim = new Date().toISOString();
            gravarEstado(cfg, estado);
            registro(`Nuvem de volta. Subindo ${pendentes} mudança(s) da loja…`);
          }
          break;

        case "voltando": {
          if (!ok) {
            modo = "contingencia";
            falhasDaSubida = 0;
            registro("A nuvem caiu de novo durante a volta: CONTINGÊNCIA.");
            break;
          }
          let subiu = true;
          let falha = "";
          try {
            await subirSaida(pool, nuvem, estado.episodio, registro);
            falhasDaSubida = 0;
          } catch (e: any) {
            subiu = false;
            falhasDaSubida++;
            falha = String(e?.message || e);
            registro(`A volta não subiu (${falhasDaSubida}ª vez seguida): ${falha}`);
          }
          pendentes = await pendentesNaSaida(pool);
          const passo = passoDaVolta({ subiu, falhasSeguidas: falhasDaSubida, pendentes });
          if (passo === "normal") {
            await espelhar();
            modo = "normal";
            normalDesde = Date.now();
            estado.episodio = null;
            erroDaVolta = "";
            gravarEstado(cfg, estado);
            registro("Tudo subiu. Modo normal — as telas voltam para a nuvem.");
          } else if (passo === "normal-com-pendentes") {
            // A nuvem está de pé e a loja não pode ficar presa na cópia
            // congelada esperando a subida. NADA é apagado: a saída fica aqui
            // (com o episódio) e segue tentando no modo normal, com o erro à
            // vista na tela do módulo.
            modo = "normal";
            normalDesde = Date.now();
            falhasDaSubida = 0;
            proximaSubidaEm = Date.now() + 60_000;
            erroDaVolta = `${pendentes} mudança(s) da loja não subiram para a nuvem (${falha}). Seguem guardadas neste computador e sobem sozinhas quando der.`;
            registro(`A volta falhou ${FALHAS_DA_SUBIDA_ATE_DESISTIR} vezes seguidas: modo normal, as telas voltam para a nuvem. ${erroDaVolta}`);
          }
          break;
        }

        case "revogada":
          // A cada 5 min, confere se a chave voltou a valer (o relato é o
          // pedido mais leve com a chave). Valeu: recomeça do zero.
          if (ok && Date.now() - ultimaTentativaRevogada > 5 * 60_000) {
            ultimaTentativaRevogada = Date.now();
            try {
              await relatar();
              modo = "iniciando";
              erroDaRevogacao = "";
              registro("A nuvem voltou a aceitar a chave deste computador: recomeçando.");
            } catch (e) {
              if (!(e instanceof ErroDaNuvem && e.status === 401)) throw e;
            }
          }
          break;
      }

      // O relato também prova à nuvem que a internet da loja está de pé — por
      // isso segue durante o "Testar agora" (a queda é só de mentira): sem ele,
      // a proteção "loja sem conexão" pausaria o iFood por causa do teste.
      const testando = Date.now() < simularQuedaAte;
      if (modo !== "revogada" && (ok || testando) && Date.now() - ultimoRelato > 30_000) {
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

  // setTimeout encadeado, não setInterval: um ciclo demorado não engole o seguinte.
  const girar = async () => {
    await ciclo();
    setTimeout(girar, 3000);
  };
  await girar();

  process.on("SIGINT", sair);
  process.on("SIGTERM", sair);
}

principal().catch((e) => {
  registro(`Falha ao iniciar o supervisor: ${e?.stack || e}`);
  process.exit(1);
});
