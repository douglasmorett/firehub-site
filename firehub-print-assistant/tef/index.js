/**
 * ─────────────────────────────────────────────────────────────
 *  TEF NO TOTEM (pinpad PayGo Web) dentro do Assistente
 *  (Obsidian: Projetos/FireHub - TEF no totem.md)
 * ─────────────────────────────────────────────────────────────
 *
 * Quem fala com a PGWebLib.dll é um PROCESSO FILHO (o "motor"):
 *   - motor "paygo":     PowerShell de 32 bits (SysWOW64) compilando
 *                        tef/PayGoHost.cs com Add-Type e fazendo P/Invoke na
 *                        DLL do kit — o Electron é 64 bits e não carrega DLL
 *                        de 32. As chamadas da DLL bloqueiam; fora do
 *                        processo do Assistente, a impressão nunca espera
 *                        pelo cartão.
 *   - motor "simulador": tef/simulador.js, o MESMO protocolo em JS puro. É o
 *                        que roda até o kit chegar (e nos testes).
 * Uma transação por vez. Se o motor cair, o supervisor daqui sobe de novo.
 *
 * ── Protocolo (JSON, uma linha por mensagem) ────────────────────────────────
 *   Assistente → motor (stdin):
 *     {cmd:"iniciar", dll, pastaDeTrabalho, ambiente, idleProcSegundos, k}
 *     {cmd:"venda", id, operacao, params:[{id,valor}], respostas, resultados:{nome:PWINFO}}
 *     {cmd:"cancelar"}                       (PW_iPPAbort no laço do pinpad)
 *     {cmd:"responder", valor}               (menu/digitação; null = cancela)
 *     {cmd:"confirmar", id, status, ref:{reqNum,locRef,extRef,virtMerch,authSyst}}
 *     {cmd:"sair"}
 *   motor → Assistente (stdout):
 *     {ev:"pronto", motor, arquitetura} | {ev:"falhou", erro}
 *     {ev:"display", id, mensagem}           (mensagem do pinpad p/ a tela)
 *     {ev:"pergunta", id, identificador, tipo:"menu"|"digitar", prompt, opcoes}
 *     {ev:"resultado", id, ret, aprovado, mensagem, requerConfirmacao,
 *        confirmacao:{...}, info:{...}, pendenteNoHost?:{...}}
 *     {ev:"confirmado", id, ok, ret} | {ev:"erro", id, erro} | {ev:"log", mensagem}
 *
 * ── Regra de ouro (doc PayGo "8 Confirmação de transação") ──────────────────
 *   1. ExecTransac voltou APROVADA → grava em disco (tef-pendente.json) ANTES
 *      de qualquer outra coisa;
 *   2. imprime as vias (comprovante é obrigatório; falhou → desfaz);
 *   3. conta ao FireHub (POST /api/totem/tef/resultado, Bearer da chave do
 *      pareamento). Só com 200 + acao CONFIRMAR → PW_iConfirmation(CNF).
 *      DESFAZER (pedido cancelado, de outra loja, já pago...) → desfaz.
 *      Sem resposta → fica pendente e tenta de novo; NUNCA confirma no escuro.
 *   4. Na volta (Assistente reiniciou com pendência em disco) → pergunta ao
 *      FireHub (GET /api/totem/tef/pedido): confirma só se ESTA transação é o
 *      pagamento gravado do pedido; senão desfaz (PWCNF_REV_PWR_AUT).
 *   Venda nova não começa com pendência não resolvida.
 *
 * ── Segurança ───────────────────────────────────────────────────────────────
 *   O servidor do Assistente responde CORS "*" (impressão). As rotas /tef NÃO:
 *   exigem o header `x-firehub-tef` com o segredo local do pareamento (o totem
 *   recebe do /api/totem/auth), Origin do FireHub e, por padrão, pedido feito
 *   NESTE computador. /tef/parear e /tef/desparear: este computador + Origin do
 *   FireHub (a tela do painel, como a contingência).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const K = require("./constantes");

const ORIGENS_OFICIAIS = ["https://firehubfood.com.br", "https://www.firehubfood.com.br"];

/** Fora do instalador (prova/dev), aceita a origem/nuvem de teste do ambiente. */
function deTeste(variavel) {
  try {
    const { app } = require("electron");
    if (app && app.isPackaged !== false) return null;
  } catch {
    /* fora do Electron */
  }
  return process.env[variavel] || null;
}

const RESULTADOS = {
  mensagem: K.PWINFO.RESULTMSG,
  autorizacao: K.PWINFO.AUTHCODE,
  nsu: K.PWINFO.AUTLOCREF,
  nsuHost: K.PWINFO.AUTEXTREF,
  rede: K.PWINFO.AUTHSYST,
  bandeira: K.PWINFO.CARDNAME,
  bandeiraPadrao: K.PWINFO.CARDNAMESTD,
  cartao: K.PWINFO.CARDPARCPAN,
  tipo: K.PWINFO.CARDTYPE,
  parcelas: K.PWINFO.INSTALLMENTS,
  valor: K.PWINFO.TOTAMNT,
  codigoResposta: K.PWINFO.AUTRESPCODE,
  comprovanteLoja: K.PWINFO.RCPTMERCH,
  comprovanteCliente: K.PWINFO.RCPTCHOLDER,
  comprovanteCompleto: K.PWINFO.RCPTFULL,
  comprovanteReduzido: K.PWINFO.RCPTCHSHORT,
};

const FASES_FINAIS = new Set(["aprovado", "recusado", "cancelado", "desfeito", "erro"]);

function versaoDoAssistente() {
  try {
    return require("../package.json").version;
  } catch {
    return "desconhecida";
  }
}

function mesmoSegredo(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function daqui(req) {
  const r = (req.socket && req.socket.remoteAddress) || "";
  return r === "127.0.0.1" || r === "::1" || r === "::ffff:127.0.0.1";
}

/**
 * Cria o TEF. `opcoes` existe para os testes: pasta, impressão, fetch e
 * relógio falsos. Em produção, `registrar`/`iniciar` lá embaixo usam o padrão.
 */
function criarTef(opcoes = {}) {
  const PASTA = opcoes.pasta || path.join(process.env.APPDATA || os.homedir(), "FireHub");
  const ARQ_CONFIG = path.join(PASTA, "tef.json");
  const ARQ_PAREAMENTO = path.join(PASTA, "tef.bin");
  const ARQ_PAREAMENTO_ABERTO = path.join(PASTA, "tef-pareamento.json");
  const ARQ_PENDENTE = path.join(PASTA, "tef-pendente.json");
  const PASTA_DO_MOTOR = path.join(PASTA, "tef");
  const fetchFn = opcoes.fetch || ((...a) => fetch(...a));
  const imprimir = opcoes.imprimir || (async () => {
    throw new Error("Impressão do comprovante não configurada.");
  });
  const registro = opcoes.log || ((m) => console.log(`[TEF] ${m}`));
  const semCofre = opcoes.semCofre ?? process.env.FIREHUB_TEF_SEM_COFRE === "1";

  const origemDeTeste = deTeste("FIREHUB_TEF_ORIGEM_DE_TESTE");
  const ORIGENS = origemDeTeste ? [...ORIGENS_OFICIAIS, origemDeTeste] : ORIGENS_OFICIAIS;
  const nuvemDeTeste = deTeste("FIREHUB_TEF_NUVEM_DE_TESTE");
  const NUVENS = nuvemDeTeste ? [...ORIGENS_OFICIAIS, nuvemDeTeste] : ORIGENS_OFICIAIS;

  /** Marca as pendências criadas NESTA execução (as da anterior = queda/reinício). */
  const EXECUCAO = crypto.randomBytes(6).toString("hex");

  // ── Config, pareamento e pendências em disco ──────────────────────────────
  const CONFIG_PADRAO = {
    motor: "simulador",
    dll: path.join(PASTA, "paygo", "PGWebLib.dll"),
    arquitetura: "x86",
    pastaDeTrabalho: path.join(PASTA, "paygo", "trabalho"),
    ambiente: null,
    idleProcSegundos: 30,
    impressora: "",
    exigirImpressao: true,
    aceitarRede: false,
    respostas: {},
  };
  let config = { ...CONFIG_PADRAO };
  function lerConfig() {
    try {
      config = { ...CONFIG_PADRAO, ...JSON.parse(fs.readFileSync(ARQ_CONFIG, "utf8")) };
    } catch {
      config = { ...CONFIG_PADRAO };
    }
    return config;
  }
  function gravarConfig(mudancas) {
    config = { ...lerConfig(), ...mudancas };
    fs.mkdirSync(PASTA, { recursive: true });
    fs.writeFileSync(ARQ_CONFIG, JSON.stringify(config, null, 2));
  }

  function cofre() {
    try {
      const { safeStorage } = require("electron");
      return safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage : null;
    } catch {
      return null;
    }
  }
  function lerPareamento() {
    try {
      let p;
      if (semCofre) {
        if (!fs.existsSync(ARQ_PAREAMENTO_ABERTO)) return null;
        p = JSON.parse(fs.readFileSync(ARQ_PAREAMENTO_ABERTO, "utf8"));
      } else {
        if (!fs.existsSync(ARQ_PAREAMENTO)) return null;
        const c = cofre();
        if (!c) return null;
        p = JSON.parse(c.decryptString(fs.readFileSync(ARQ_PAREAMENTO)));
      }
      return p && p.chave && p.segredoLocal && p.licencaId && NUVENS.includes(p.nuvem) ? p : null;
    } catch (e) {
      registro(`Pareamento ilegível: ${e && e.message}`);
      return null;
    }
  }
  function gravarPareamento(p) {
    fs.mkdirSync(PASTA, { recursive: true });
    if (semCofre) return fs.writeFileSync(ARQ_PAREAMENTO_ABERTO, JSON.stringify(p));
    const c = cofre();
    if (!c) throw new Error("O cofre do Windows não está disponível neste computador.");
    fs.writeFileSync(ARQ_PAREAMENTO, c.encryptString(JSON.stringify(p)));
  }

  let pendentes = [];
  function lerPendentes() {
    try {
      const l = JSON.parse(fs.readFileSync(ARQ_PENDENTE, "utf8"));
      pendentes = Array.isArray(l) ? l : [];
    } catch {
      pendentes = [];
    }
  }
  /** Gravação atômica: arquivo novo e rename — queda no meio não deixa JSON pela metade. */
  function salvarPendentes() {
    fs.mkdirSync(PASTA, { recursive: true });
    const tmp = `${ARQ_PENDENTE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(pendentes, null, 2));
    fs.renameSync(tmp, ARQ_PENDENTE);
  }

  let pareamento = null;

  // ── O motor (processo filho) e o supervisor ───────────────────────────────
  let filho = null;
  let motor = { estado: "parado", erro: null, tipo: null, arquitetura: null };
  let parando = false;
  let quedasSeguidas = 0;
  let religar = null;
  const esperandoConfirmacao = new Map(); // id → resolve({ok, ret})

  /**
   * Os arquivos do motor saem de dentro do instalador (app.asar, que o
   * PowerShell não enxerga) para %APPDATA%\FireHub\tef a cada subida.
   */
  function prepararArquivosDoMotor() {
    fs.mkdirSync(PASTA_DO_MOTOR, { recursive: true });
    for (const arq of ["PayGoHost.cs", "motor-paygo.ps1", "simulador.js", "constantes.js"]) {
      fs.writeFileSync(path.join(PASTA_DO_MOTOR, arq), fs.readFileSync(path.join(__dirname, arq)));
    }
  }

  function powershellDa(arquitetura) {
    const sistema = process.env.SystemRoot || "C:\\Windows";
    // Assistente x64: o PowerShell de 32 bits mora em SysWOW64. (Num Windows
    // de 32 bits, System32 já é o de 32.)
    if (arquitetura === "x64") return path.join(sistema, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const wow = path.join(sistema, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe");
    return fs.existsSync(wow) ? wow : path.join(sistema, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  }

  function subirMotor() {
    if (filho || parando || !pareamento) return;
    lerConfig();
    try {
      prepararArquivosDoMotor();
    } catch (e) {
      motor = { estado: "falhou", erro: `Não consegui preparar o motor TEF: ${e.message}`, tipo: config.motor, arquitetura: null };
      return agendarReligar();
    }
    let cmd;
    let args;
    const env = { ...process.env };
    if (config.motor === "paygo") {
      cmd = powershellDa(config.arquitetura);
      args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(PASTA_DO_MOTOR, "motor-paygo.ps1"), "-Fonte", path.join(PASTA_DO_MOTOR, "PayGoHost.cs")];
    } else {
      cmd = process.execPath;
      args = [path.join(PASTA_DO_MOTOR, "simulador.js")];
      env.ELECTRON_RUN_AS_NODE = "1";
    }
    motor = { estado: "subindo", erro: null, tipo: config.motor, arquitetura: null };
    registro(`Subindo o motor TEF (${config.motor}).`);
    const p = spawn(cmd, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    filho = p;
    let buffer = "";
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (pedaco) => {
      buffer += pedaco;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!linha) continue;
        let ev;
        try {
          ev = JSON.parse(linha);
        } catch {
          registro(`Motor disse algo fora do protocolo: ${linha.slice(0, 200)}`);
          continue;
        }
        try {
          aoEvento(ev);
        } catch (e) {
          registro(`Erro tratando evento do motor: ${e && e.stack}`);
        }
      }
    });
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (t) => registro(`motor (stderr): ${String(t).trim().slice(0, 500)}`));
    p.stdin.on("error", () => {});
    p.on("error", (e) => registro(`Motor não subiu: ${e.message}`));
    p.on("exit", (codigo) => {
      if (filho !== p) return;
      filho = null;
      aoMotorCair(codigo);
    });
    enviar({
      cmd: "iniciar",
      dll: config.motor === "paygo" ? config.dll : config.dll === "falhar" ? "falhar" : "simulador",
      pastaDeTrabalho: config.motor === "paygo" ? config.pastaDeTrabalho : path.join(PASTA_DO_MOTOR, "simulador"),
      ambiente: config.ambiente,
      idleProcSegundos: config.idleProcSegundos,
      k: { PWRET: K.PWRET, PWINFO: K.PWINFO, PWDAT: K.PWDAT, PWCNF: K.PWCNF },
    });
  }

  function enviar(m) {
    if (!filho) return false;
    try {
      filho.stdin.write(JSON.stringify(m) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  function agendarReligar() {
    if (parando || religar || !pareamento) return;
    const espera = [2000, 5000, 15000, 30000][Math.min(quedasSeguidas, 3)];
    quedasSeguidas += 1;
    religar = setTimeout(() => {
      religar = null;
      subirMotor();
    }, opcoes.esperaReligarMs ?? espera);
  }

  function aoMotorCair(codigo) {
    const estavaPronto = motor.estado === "pronto";
    motor = { ...motor, estado: parando ? "parado" : "caiu", erro: parando ? null : `O motor TEF parou (código ${codigo}).` };
    for (const [, resolver] of esperandoConfirmacao) resolver({ ok: false, ret: null, caiu: true });
    esperandoConfirmacao.clear();
    if (atual && !FASES_FINAIS.has(atual.fase) && atual.fase !== "registrando") {
      // Se a PayGo chegou a aprovar, a transação ficou pendente lá e volta como
      // FROMHOSTPENDTRN na próxima venda — e é desfeita (ninguém a gravou).
      fim(atual, "erro", "O pinpad parou no meio. Se o cartão chegou a ser aprovado, o pagamento será desfeito sozinho. Tente de novo.");
    }
    if (!parando) {
      if (estavaPronto) quedasSeguidas = 0;
      registro(`Motor TEF caiu (código ${codigo}); subindo de novo.`);
      agendarReligar();
    }
  }

  // ── A transação em andamento e as que acabaram ────────────────────────────
  let atual = null;
  const recentes = new Map(); // id → transação (as últimas 20)

  function guardar(t) {
    recentes.set(t.id, t);
    while (recentes.size > 20) recentes.delete(recentes.keys().next().value);
  }

  function fim(t, fase, mensagem, extra = {}) {
    Object.assign(t, { fase, mensagem, pergunta: null, atualizadaEm: Date.now() }, extra);
    if (atual === t) atual = null;
  }

  function publico(t) {
    return {
      id: t.id,
      pedidoId: t.pedidoId,
      valorCentavos: t.valorCentavos,
      fase: t.fase,
      final: FASES_FINAIS.has(t.fase),
      mensagem: t.mensagem,
      pergunta: t.pergunta || null,
      aprovado: t.fase === "aprovado",
      podeCancelar: ["iniciando", "pinpad", "pergunta"].includes(t.fase),
      numero: t.numero ?? null,
      atualizadaEm: t.atualizadaEm,
    };
  }

  function aoEvento(ev) {
    if (ev.ev === "log") return registro(`motor: ${ev.mensagem}`);
    if (ev.ev === "pronto") {
      motor = { estado: "pronto", erro: null, tipo: ev.motor, arquitetura: ev.arquitetura || null };
      registro(`Motor TEF pronto (${ev.motor}, ${ev.arquitetura || "?"}).`);
      void resolverPendencias();
      return;
    }
    if (ev.ev === "falhou") {
      motor = { ...motor, estado: "falhou", erro: ev.erro };
      registro(`Motor TEF não iniciou: ${ev.erro}`);
      // Sem DLL/pinpad não adianta insistir a cada 2 s: o supervisor espera.
      const p = filho;
      filho = null;
      if (p) {
        try {
          p.kill();
        } catch {}
      }
      quedasSeguidas = Math.max(quedasSeguidas, 3);
      agendarReligar();
      return;
    }
    if (ev.ev === "confirmado") {
      const r = esperandoConfirmacao.get(ev.id);
      if (r) {
        esperandoConfirmacao.delete(ev.id);
        r({ ok: !!ev.ok, ret: ev.ret });
      }
      return;
    }
    const t = ev.id ? recentes.get(ev.id) : null;
    if (ev.ev === "erro") {
      registro(`Motor: erro no comando ${ev.id || "?"}: ${ev.erro}`);
      if (t && !FASES_FINAIS.has(t.fase) && t.fase !== "registrando") fim(t, "erro", "O pinpad não respondeu. Tente de novo.");
      return;
    }
    if (!t) return;
    if (ev.ev === "display") {
      if (t.fase === "iniciando" || t.fase === "pinpad" || t.fase === "pergunta") {
        t.fase = "pinpad";
        t.mensagem = String(ev.mensagem || "").replace(/\r/g, "\n").trim();
        t.pergunta = null;
        t.atualizadaEm = Date.now();
      }
      return;
    }
    if (ev.ev === "pergunta") {
      t.fase = "pergunta";
      t.pergunta = {
        tipo: ev.tipo,
        prompt: ev.prompt,
        opcoes: Array.isArray(ev.opcoes) ? ev.opcoes : [],
        minimo: ev.minimo ?? 0,
        maximo: ev.maximo ?? 0,
        ocultar: !!ev.ocultar,
      };
      t.mensagem = String(ev.prompt || "").trim();
      t.atualizadaEm = Date.now();
      return;
    }
    if (ev.ev === "resultado") void aoResultado(t, ev);
  }

  async function aoResultado(t, ev) {
    const refs = ev.confirmacao || {};
    if (ev.ret === K.PWRET.FROMHOSTPENDTRN) {
      return tratarPendenciaNoHost(t, ev.pendenteNoHost || {});
    }
    if (!ev.aprovado) {
      // Transação que não terminou mas a PayGo pede confirmação: desfaz já.
      if (ev.requerConfirmacao) await enviarConfirmacao(`${t.id}-rev`, K.PWCNF.REV_ABORT, refs);
      const cancelada = ev.ret === K.PWRET.CANCEL;
      fim(t, cancelada ? "cancelado" : "recusado", cancelada ? "Pagamento cancelado. Nada foi cobrado." : String(ev.mensagem || "Pagamento não aprovado.").trim());
      // Melhor esforço: a tela do totem fica sabendo também pelo servidor.
      void chamarNuvem("POST", "/api/totem/tef/resultado", {
        pedidoId: t.pedidoId,
        transacaoId: t.id,
        aprovado: false,
        cancelado: cancelada,
        valorCentavos: t.valorCentavos,
        mensagem: ev.mensagem || null,
      }).catch(() => {});
      return;
    }

    // 1. APROVADA: em disco antes de qualquer outra coisa.
    const info = ev.info || {};
    const pend = {
      transacaoId: t.id,
      pedidoId: t.pedidoId,
      valorCentavos: t.valorCentavos,
      confirmacao: refs,
      info,
      fase: "aguardando_servidor",
      execucao: EXECUCAO,
      impresso: false,
      tentativas: 0,
      criadoEm: new Date().toISOString(),
    };
    pendentes.push(pend);
    salvarPendentes();
    t.fase = "registrando";
    t.mensagem = "Pagamento aprovado no cartão. Registrando o pedido...";
    t.atualizadaEm = Date.now();

    // 2. Comprovante (obrigatório). Sem papel, não há venda: desfaz.
    try {
      await imprimirVias(pend);
      pend.impresso = true;
      salvarPendentes();
    } catch (e) {
      registro(`Comprovante não imprimiu (${e && e.message}).`);
      if (config.exigirImpressao !== false) {
        await desfazer(pend, K.PWCNF.REV_PRN_AUT, "a impressora do comprovante falhou");
        fim(t, "desfeito", "A impressora do comprovante falhou, então o pagamento foi desfeito. Nada foi cobrado. Chame um atendente.");
        return;
      }
    }

    // 3. Conta ao FireHub.
    await enviarAoServidor(pend);
  }

  function textoDaVia(texto) {
    return String(texto || "").replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  }

  async function imprimirVias(pend) {
    if (pend.impresso) return;
    const i = pend.info || {};
    const cliente = textoDaVia(i.comprovanteCliente || i.comprovanteReduzido || i.comprovanteCompleto);
    const loja = textoDaVia(i.comprovanteLoja || i.comprovanteCompleto);
    if (!cliente && !loja) throw new Error("A transação voltou sem comprovante.");
    if (cliente) await imprimir(cliente, { via: "cliente", impressora: config.impressora || "" });
    if (loja && loja !== cliente) await imprimir(loja, { via: "loja", impressora: config.impressora || "" });
  }

  function corpoDoResultado(pend) {
    const i = pend.info || {};
    return {
      pedidoId: pend.pedidoId,
      transacaoId: pend.transacaoId,
      aprovado: true,
      valorCentavos: Number(i.valor) || pend.valorCentavos,
      nsu: i.nsu || pend.confirmacao.locRef || null,
      nsuHost: i.nsuHost || pend.confirmacao.extRef || null,
      autorizacao: i.autorizacao || null,
      bandeira: i.bandeira || i.bandeiraPadrao || null,
      cartao: i.cartao || null,
      tipo: i.tipo || null,
      parcelas: i.parcelas || null,
      rede: i.rede || pend.confirmacao.authSyst || null,
      mensagem: i.mensagem || null,
      comprovanteLoja: i.comprovanteLoja || i.comprovanteCompleto || null,
      comprovanteCliente: i.comprovanteCliente || i.comprovanteReduzido || null,
    };
  }

  async function chamarNuvem(metodo, caminho, corpo) {
    if (!pareamento) throw new Error("TEF sem pareamento.");
    const r = await fetchFn(`${pareamento.nuvem}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${pareamento.chave}`, "content-type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(opcoes.prazoDaNuvemMs ?? 15000),
    });
    const dados = await r.json().catch(() => null);
    return { status: r.status, dados };
  }

  const tentativasAgendadas = new Map();
  function tentarDeNovoDepois(pend) {
    if (tentativasAgendadas.has(pend.transacaoId)) return;
    const espera = opcoes.esperaNovaTentativaMs ?? Math.min(60000, 5000 * 2 ** Math.min(pend.tentativas, 4));
    tentativasAgendadas.set(
      pend.transacaoId,
      setTimeout(() => {
        tentativasAgendadas.delete(pend.transacaoId);
        if (pendentes.includes(pend)) void resolverUma(pend);
      }, espera),
    );
  }

  /** Passo 3: só CONFIRMAR do servidor (200) confirma; DESFAZER desfaz; o resto espera. */
  async function enviarAoServidor(pend) {
    const t = recentes.get(pend.transacaoId);
    let r;
    try {
      r = await chamarNuvem("POST", "/api/totem/tef/resultado", corpoDoResultado(pend));
    } catch (e) {
      r = { status: 0, dados: null, erro: e && e.message };
    }
    const acao = r.dados && r.dados.acao;
    if (r.status === 200 && acao === "CONFIRMAR") {
      // A venda está gravada: para o totem, acabou. Se a confirmação na PayGo
      // não passar agora, ela segue pendente em disco e é refeita em segundo
      // plano (o pinpad não aceita venda nova até lá).
      if (t) fim(t, "aprovado", "Pagamento aprovado!", { numero: r.dados.numero ?? null });
      await confirmarNaPayGo(pend);
      return;
    }
    if (acao === "DESFAZER") {
      await desfazer(pend, K.PWCNF.REV_OTHER_AUT, `o FireHub mandou desfazer (${(r.dados && r.dados.motivo) || r.status})`);
      if (t) {
        fim(t, "desfeito", `${(r.dados && r.dados.mensagem) || "O pedido não pôde receber este pagamento."} O pagamento foi desfeito; nada foi cobrado.`);
      }
      await imprimirAvisoDeDesfeito(pend);
      return;
    }
    pend.tentativas += 1;
    salvarPendentes();
    registro(`FireHub não confirmou a transação ${pend.transacaoId} (HTTP ${r.status}${r.erro ? `, ${r.erro}` : ""}); fica pendente e tento de novo.`);
    if (t && !FASES_FINAIS.has(t.fase)) {
      if (Date.now() - t.criadaEm > (opcoes.limiteNaTelaMs ?? 180000)) {
        // O cliente não pode ficar preso na tela: a pendência segue em
        // segundo plano e o FireHub decide (pedido pago ou cartão desfeito).
        fim(t, "erro", "Não conseguimos registrar o pagamento agora. Chame um atendente — se o pedido não for registrado, o valor é devolvido automaticamente ao cartão.");
      } else {
        t.mensagem = "Pagamento aprovado no cartão. Sem resposta do FireHub, tentando registrar de novo... Não passe o cartão outra vez.";
        t.atualizadaEm = Date.now();
      }
    }
    tentarDeNovoDepois(pend);
  }

  async function imprimirAvisoDeDesfeito(pend) {
    if (!pend.impresso) return;
    const reais = (pend.valorCentavos / 100).toFixed(2).replace(".", ",");
    const aviso = [
      "*** TRANSACAO DESFEITA ***",
      `Valor: R$ ${reais}`,
      `Doc: ${pend.confirmacao.reqNum || ""}  NSU: ${pend.confirmacao.locRef || ""}`,
      "O pagamento acima NAO foi concluido.",
      "Nada foi cobrado do cartao.",
    ].join("\n");
    await imprimir(aviso, { via: "aviso", impressora: config.impressora || "" }).catch(() => {});
  }

  function enviarConfirmacao(id, status, refs) {
    if (motor.estado !== "pronto" || !filho) return Promise.resolve({ ok: false, ret: null, semMotor: true });
    return new Promise((resolve) => {
      const prazo = setTimeout(() => {
        esperandoConfirmacao.delete(id);
        resolve({ ok: false, ret: null, prazo: true });
      }, opcoes.prazoDaConfirmacaoMs ?? 90000);
      esperandoConfirmacao.set(id, (r) => {
        clearTimeout(prazo);
        resolve(r);
      });
      if (!enviar({ cmd: "confirmar", id, status, ref: refs })) {
        esperandoConfirmacao.delete(id);
        clearTimeout(prazo);
        resolve({ ok: false, ret: null, semMotor: true });
      }
    });
  }

  function esquecer(pend) {
    pendentes = pendentes.filter((p) => p !== pend);
    salvarPendentes();
  }

  async function confirmarNaPayGo(pend) {
    pend.fase = "confirmando";
    salvarPendentes();
    const r = await enviarConfirmacao(pend.transacaoId, K.PWCNF.CNF_AUTO, pend.confirmacao);
    if (r.ok) {
      esquecer(pend);
      registro(`Transação ${pend.transacaoId} CONFIRMADA (pedido ${pend.pedidoId}).`);
      return true;
    }
    if (r.ret === -2589) {
      // PWRET_FROMHOSTTRNNFOUND: a PayGo não conhece mais a transação.
      registro(`ATENÇÃO: a PayGo não achou a transação ${pend.transacaoId} para confirmar (pedido ${pend.pedidoId} já está pago no FireHub). Conferir no portal da PayGo.`);
      esquecer(pend);
      return true;
    }
    registro(`Confirmação da transação ${pend.transacaoId} não passou (ret ${r.ret}); tento de novo.`);
    tentarDeNovoDepois(pend);
    return false;
  }

  async function desfazer(pend, status, motivo) {
    pend.fase = "desfazendo";
    pend.statusDesfazer = status;
    salvarPendentes();
    const r = await enviarConfirmacao(`${pend.transacaoId}-rev`, status, pend.confirmacao);
    if (r.ok || r.ret === -2589) {
      esquecer(pend);
      registro(`Transação ${pend.transacaoId} DESFEITA: ${motivo}.`);
      return true;
    }
    registro(`Desfazimento da transação ${pend.transacaoId} não passou (ret ${r.ret}); tento de novo.`);
    tentarDeNovoDepois(pend);
    return false;
  }

  /** Uma pendência, conforme a fase em que parou. */
  async function resolverUma(pend) {
    if (pend.resolvendo) return;
    pend.resolvendo = true;
    try {
      if (pend.fase === "confirmando") return void (await confirmarNaPayGo(pend));
      if (pend.fase === "desfazendo") return void (await desfazer(pend, pend.statusDesfazer || K.PWCNF.REV_OTHER_AUT, "retomada"));
      if (pend.execucao === EXECUCAO) {
        if (!pend.impresso) {
          try {
            await imprimirVias(pend);
            pend.impresso = true;
            salvarPendentes();
          } catch {}
        }
        return void (await enviarAoServidor(pend));
      }
      // Pendência de uma execução anterior (o Assistente caiu/reiniciou):
      // pergunta ao FireHub se ESTA transação virou o pagamento do pedido.
      let r;
      try {
        r = await chamarNuvem("GET", `/api/totem/tef/pedido?id=${encodeURIComponent(pend.pedidoId)}&transacao=${encodeURIComponent(pend.transacaoId)}`);
      } catch (e) {
        r = { status: 0, dados: null };
      }
      const acao = r.dados && r.dados.acao;
      if (r.status === 200 && acao === "CONFIRMAR") return void (await confirmarNaPayGo(pend));
      if (acao === "DESFAZER") {
        await desfazer(pend, K.PWCNF.REV_PWR_AUT, "pendência achada na volta e a venda não está gravada no FireHub");
        await imprimirAvisoDeDesfeito(pend);
        return;
      }
      pend.tentativas += 1;
      salvarPendentes();
      registro(`Pendência ${pend.transacaoId}: FireHub não respondeu (HTTP ${r.status}); tento de novo.`);
      tentarDeNovoDepois(pend);
    } finally {
      pend.resolvendo = false;
    }
  }

  async function resolverPendencias() {
    if (motor.estado !== "pronto") return;
    for (const pend of [...pendentes]) await resolverUma(pend);
  }

  /**
   * A PayGo recusou a venda por haver transação pendente no host. Se é uma das
   * nossas (em disco), resolve pelo caminho normal; se não é (o motor caiu
   * antes de devolver o "aprovado", então ninguém a gravou), desfaz. Depois
   * tenta a venda de novo, uma vez.
   */
  async function tratarPendenciaNoHost(t, refs) {
    const nossa = pendentes.find((p) => p.confirmacao && p.confirmacao.reqNum === refs.reqNum && p.confirmacao.locRef === refs.locRef);
    if (nossa) await resolverUma(nossa);
    else {
      registro(`Pendência desconhecida no host (${refs.reqNum}/${refs.locRef}): desfazendo — nenhuma venda foi gravada com ela.`);
      await enviarConfirmacao(`${t.id}-host`, K.PWCNF.REV_PWR_AUT, refs);
    }
    if (t.repetiuPorPendencia || pendentes.length) {
      return fim(t, "erro", "Havia um pagamento anterior pendente no pinpad. Ele foi resolvido; toque em Tentar de novo.");
    }
    t.repetiuPorPendencia = true;
    t.mensagem = "Preparando o pinpad...";
    t.fase = "iniciando";
    t.atualizadaEm = Date.now();
    mandarVenda(t);
  }

  function paramsDaVenda(t) {
    const P = K.PWINFO;
    const params = [
      { id: P.AUTNAME, valor: "FIREHUB TOTEM" },
      { id: P.AUTVER, valor: versaoDoAssistente() },
      { id: P.AUTDEV, valor: "FIREHUB" },
      { id: P.AUTCAP, valor: String(K.AUTCAP_DO_TOTEM) },
      { id: P.TOTAMNT, valor: String(t.valorCentavos) },
      { id: P.CURRENCY, valor: K.MOEDA_REAL },
      { id: P.CURREXP, valor: K.MOEDA_EXPOENTE },
      { id: P.PAYMNTTYPE, valor: K.PAYMNTTYPE_CARTAO },
      { id: P.FISCALREF, valor: String(t.pedidoId).replace(/[^0-9A-Za-z]/g, "").slice(-10) },
    ];
    if (t.forma === "credito" || t.forma === "debito") params.push({ id: P.CARDTYPE, valor: K.CARDTYPE[t.forma] });
    if (t.forma === "credito") params.push({ id: P.FINTYPE, valor: K.FINTYPE_A_VISTA });
    return params;
  }

  function mandarVenda(t) {
    const ok = enviar({
      cmd: "venda",
      id: t.id,
      operacao: K.PWOPER.SALE,
      params: paramsDaVenda(t),
      respostas: config.respostas || {},
      resultados: RESULTADOS,
    });
    if (!ok) fim(t, "erro", "O pinpad não está pronto. Tente de novo em alguns segundos.");
  }

  // ── API usada pelas rotas ─────────────────────────────────────────────────
  async function iniciarVenda({ pedidoId, valorCentavos, forma }) {
    if (!pareamento) return { status: 409, corpo: { error: "TEF não pareado neste computador.", code: "TEF_SEM_PAREAMENTO" } };
    if (typeof pedidoId !== "string" || !pedidoId || pedidoId.length > 64) return { status: 400, corpo: { error: "pedidoId inválido." } };
    const valor = Number(valorCentavos);
    if (!Number.isInteger(valor) || valor <= 0 || valor > 10_000_000) return { status: 400, corpo: { error: "valorCentavos inválido." } };
    if (forma === "pix") return { status: 400, corpo: { error: "Pix no pinpad ainda não está disponível. Use a maquininha ou o caixa.", code: "TEF_SEM_PIX" } };
    if (forma != null && forma !== "credito" && forma !== "debito") return { status: 400, corpo: { error: "forma inválida." } };
    if (atual) {
      if (atual.pedidoId === pedidoId) return { status: 200, corpo: { id: atual.id, reaproveitada: true } };
      return { status: 409, corpo: { error: "O pinpad está ocupado com outro pagamento.", code: "TEF_OCUPADO" } };
    }
    if (motor.estado !== "pronto") {
      return { status: 503, corpo: { error: motor.erro || "O pinpad ainda está iniciando. Tente em alguns segundos.", code: "TEF_MOTOR_FORA" } };
    }
    if (pendentes.length) {
      await resolverPendencias();
      if (pendentes.length) {
        return { status: 409, corpo: { error: "Há um pagamento anterior sendo finalizado no pinpad. Aguarde um instante ou chame um atendente.", code: "TEF_PENDENCIA" } };
      }
    }
    const t = {
      id: `tef_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
      pedidoId,
      valorCentavos: valor,
      forma: forma || null,
      fase: "iniciando",
      mensagem: "Preparando o pinpad...",
      pergunta: null,
      criadaEm: Date.now(),
      atualizadaEm: Date.now(),
    };
    atual = t;
    guardar(t);
    mandarVenda(t);
    return { status: 200, corpo: { id: t.id } };
  }

  function estadoDe(id) {
    const t = id ? recentes.get(String(id)) : atual;
    return t ? { status: 200, corpo: publico(t) } : { status: 404, corpo: { error: "Transação não encontrada." } };
  }

  function cancelar() {
    if (!atual) return { status: 409, corpo: { error: "Nenhum pagamento no pinpad.", code: "TEF_SEM_TRANSACAO" } };
    if (!["iniciando", "pinpad", "pergunta"].includes(atual.fase)) {
      return { status: 409, corpo: { error: "O pagamento já está sendo finalizado e não pode mais ser cancelado.", code: "TEF_NAO_CANCELA" } };
    }
    enviar({ cmd: "cancelar" });
    atual.mensagem = "Cancelando...";
    atual.atualizadaEm = Date.now();
    return { status: 200, corpo: { ok: true, id: atual.id } };
  }

  function responder(id, valor) {
    if (!atual || atual.id !== id || atual.fase !== "pergunta") return { status: 409, corpo: { error: "Nada a responder." } };
    enviar({ cmd: "responder", valor: valor == null ? null : String(valor) });
    atual.fase = "pinpad";
    atual.pergunta = null;
    atual.mensagem = "Aguarde...";
    atual.atualizadaEm = Date.now();
    return { status: 200, corpo: { ok: true } };
  }

  function status() {
    return {
      versao: versaoDoAssistente(),
      pareado: !!pareamento,
      licencaId: pareamento ? pareamento.licencaId : null,
      motor: motor.estado,
      tipo: motor.tipo || config.motor,
      arquitetura: motor.arquitetura,
      erro: motor.erro,
      pronto: motor.estado === "pronto",
      ocupado: !!atual,
      pendentes: pendentes.length,
    };
  }

  // ── Rotas ─────────────────────────────────────────────────────────────────
  const origemAceita = (req) => ORIGENS.includes(String(req.headers.origin || ""));

  function guarda(req, res, next) {
    if (!config.aceitarRede && !daqui(req)) return res.status(403).json({ error: "O TEF só atende este computador." });
    if (!origemAceita(req)) return res.status(403).json({ error: "Origem não autorizada." });
    if (!pareamento || !mesmoSegredo(req.headers["x-firehub-tef"], pareamento.segredoLocal)) {
      return res.status(401).json({ error: "Segredo do TEF inválido. Abra o totem de novo.", code: "TEF_SEGREDO" });
    }
    next();
  }

  function registrar(app) {
    app.post("/tef/parear", (req, res) => {
      if (!daqui(req) || !origemAceita(req)) return res.status(403).json({ error: "Só pela página do FireHub, neste computador." });
      const { licencaId, chave, segredoLocal, nuvem, motor: tipoDeMotor } = req.body || {};
      if (!licencaId || !chave || !segredoLocal) return res.status(400).json({ error: "Pareamento incompleto." });
      if (!NUVENS.includes(String(nuvem))) return res.status(400).json({ error: "Endereço do FireHub inválido." });
      try {
        gravarPareamento({ licencaId: String(licencaId), chave: String(chave), segredoLocal: String(segredoLocal), nuvem: String(nuvem) });
        if (tipoDeMotor === "paygo" || tipoDeMotor === "simulador") gravarConfig({ motor: tipoDeMotor });
      } catch (e) {
        return res.status(500).json({ error: String((e && e.message) || e) });
      }
      pareamento = lerPareamento();
      registro(`TEF pareado com a licença ${licencaId}.`);
      reiniciarMotor();
      res.json({ ok: true, status: status() });
    });

    app.post("/tef/desparear", async (req, res) => {
      if (!daqui(req) || !origemAceita(req)) return res.status(403).json({ error: "Só pela página do FireHub, neste computador." });
      if (pendentes.length) {
        return res.status(409).json({ error: "Há pagamento pendente no pinpad. Espere ele ser finalizado antes de desligar o TEF.", code: "TEF_PENDENCIA" });
      }
      pareamento = null;
      for (const arq of [ARQ_PAREAMENTO, ARQ_PAREAMENTO_ABERTO]) fs.rmSync(arq, { force: true });
      await pararMotor();
      registro("TEF desligado neste computador.");
      res.json({ ok: true });
    });

    app.get("/tef/status", guarda, (_req, res) => res.json(status()));
    app.post("/tef/venda", guarda, async (req, res) => {
      const r = await iniciarVenda(req.body || {});
      res.status(r.status).json(r.corpo);
    });
    app.get("/tef/estado", guarda, (req, res) => {
      const r = estadoDe(req.query.id);
      res.status(r.status).json(r.corpo);
    });
    app.post("/tef/cancelar", guarda, (_req, res) => {
      const r = cancelar();
      res.status(r.status).json(r.corpo);
    });
    app.post("/tef/responder", guarda, (req, res) => {
      const { id, valor } = req.body || {};
      const r = responder(String(id || ""), valor);
      res.status(r.status).json(r.corpo);
    });
  }

  let vigia = null;
  function iniciar() {
    lerConfig();
    lerPendentes();
    pareamento = lerPareamento();
    if (pendentes.length) registro(`${pendentes.length} transação(ões) TEF pendente(s) em disco: resolvo assim que o motor subir.`);
    if (pareamento) subirMotor();
    // Pendência esquecida (sem tentativa agendada) é retomada a cada 30 s.
    vigia = setInterval(() => {
      if (motor.estado === "pronto" && !atual) for (const p of pendentes) if (!tentativasAgendadas.has(p.transacaoId)) void resolverUma(p);
    }, 30000);
    if (vigia.unref) vigia.unref();
  }

  async function pararMotor() {
    parando = true;
    if (religar) clearTimeout(religar);
    religar = null;
    const p = filho;
    if (p) {
      await new Promise((resolve) => {
        const prazo = setTimeout(() => {
          try {
            p.kill();
          } catch {}
          resolve();
        }, 3000);
        p.once("exit", () => {
          clearTimeout(prazo);
          resolve();
        });
        enviar({ cmd: "sair" });
        try {
          p.stdin.end();
        } catch {}
      });
    }
    filho = null;
    motor = { estado: "parado", erro: null, tipo: null, arquitetura: null };
    parando = false;
  }

  function reiniciarMotor() {
    void pararMotor().then(() => {
      quedasSeguidas = 0;
      subirMotor();
    });
  }

  /** Para os testes: derruba o motor como uma queda de verdade. */
  function matarMotor() {
    if (filho) filho.kill("SIGKILL");
  }

  async function encerrar() {
    if (vigia) clearInterval(vigia);
    for (const [, h] of tentativasAgendadas) clearTimeout(h);
    tentativasAgendadas.clear();
    await pararMotor();
  }

  return {
    registrar,
    iniciar,
    encerrar,
    status,
    iniciarVenda,
    estadoDe,
    cancelar,
    responder,
    matarMotor,
    pendentes: () => pendentes.map(({ resolvendo, ...p }) => p),
    ORIGENS,
    _gravarPareamento: gravarPareamento,
    _gravarConfig: gravarConfig,
  };
}

// ── Instância do Assistente ─────────────────────────────────────────────────
let instancia = null;
function registrar(app, deps = {}) {
  instancia = criarTef(deps);
  instancia.registrar(app);
  return instancia;
}
function iniciar() {
  if (instancia) instancia.iniciar();
}
/** Origens que podem ver a resposta das rotas /tef (server.js ajusta o CORS). */
function origemDoTefAceita(origin) {
  const lista = instancia ? instancia.ORIGENS : ORIGENS_OFICIAIS;
  return lista.includes(String(origin || ""));
}

module.exports = { registrar, iniciar, criarTef, origemDoTefAceita };
