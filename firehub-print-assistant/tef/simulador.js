/**
 * Simulador do motor TEF — fala o MESMO protocolo do PayGoHost.cs (JSON, uma
 * linha por mensagem, stdin/stdout) e roda como processo filho igual a ele,
 * para o Assistente, a tela do totem e os testes passarem pelos mesmos
 * caminhos (inclusive o motor cair no meio) antes de o kit PayGo chegar.
 *
 * tef.json: { "motor": "simulador" }.
 *
 * Regras do simulador (pelo valor em centavos):
 *   termina em 99 → RECUSADA pelo "host" (TRANSACAO NEGADA);
 *   termina em 97 → o motor MORRE no meio, depois de o "host" aprovar e antes
 *                   de devolver o resultado (a PayGo fica com uma pendência e
 *                   devolve FROMHOSTPENDTRN na próxima venda);
 *   o resto       → APROVADA, com comprovante falso (duas vias).
 * Sem CARDTYPE nos parâmetros, pergunta "CREDITO / DEBITO" (como a PayGo faz
 * por menu). Velocidade: FIREHUB_TEF_SIM_PASSO_MS (padrão 1200 ms por tela).
 *
 * O "host" guarda a transação aprovada e não confirmada em
 * <pastaDeTrabalho>/simulador-host.json, e o histórico de confirmações e
 * desfazimentos (os testes conferem por ele).
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const PASSO = Math.max(1, Number(process.env.FIREHUB_TEF_SIM_PASSO_MS) || 1200);

let K = null;
let arquivoHost = null;
let cancelar = false;
let esperaResposta = null;
const fila = [];
let ocupado = false;

const emitir = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function lerHost() {
  try {
    return JSON.parse(fs.readFileSync(arquivoHost, "utf8"));
  } catch {
    return { seq: 0, pendente: null, historico: [] };
  }
}
function gravarHost(h) {
  fs.writeFileSync(arquivoHost, JSON.stringify(h, null, 2));
}

/** Espera `ms` olhando o "cancelar" (tecla CANCELA do pinpad / PW_iPPAbort). */
async function passo(ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cancelar) return false;
    await dormir(Math.min(25, fim - Date.now()));
  }
  return !cancelar;
}

function perguntar(id, m) {
  return new Promise((resolve) => {
    esperaResposta = resolve;
    emitir({ ev: "pergunta", id, ...m });
  });
}

const valorDoParam = (params, pwinfo) => {
  const p = (params || []).find((x) => Number(x.id) === pwinfo);
  return p ? String(p.valor) : null;
};

function comprovante(via, d) {
  const reais = (d.valor / 100).toFixed(2).replace(".", ",");
  return [
    "       *** SIMULADOR - SEM VALOR ***",
    `            ${via}`,
    "REDE SIMULADA            " + new Date().toLocaleString("pt-BR"),
    `${d.bandeira}  ${d.cartao}`,
    `${d.tipo === "2" ? "DEBITO" : "CREDITO A VISTA"}`,
    `VALOR: R$ ${reais}`,
    `NSU: ${d.nsu}   AUT: ${d.autorizacao}`,
    `DOC: ${d.reqNum}`,
    "     TRANSACAO AUTORIZADA MEDIANTE",
    "         USO DE SENHA PESSOAL",
  ].join("\n");
}

async function venda(cmd) {
  const { id } = cmd;
  cancelar = false;
  const R = K.PWRET;
  const I = K.PWINFO;
  const host = lerHost();
  const resultado = (m) => emitir({ ev: "resultado", id, info: {}, confirmacao: {}, requerConfirmacao: false, ...m });

  if (host.pendente) {
    return resultado({
      ret: R.FROMHOSTPENDTRN,
      aprovado: false,
      mensagem: "EXISTE TRANSACAO PENDENTE",
      pendenteNoHost: host.pendente.refs,
    });
  }

  const valor = Number(valorDoParam(cmd.params, I.TOTAMNT) || 0);
  let tipo = valorDoParam(cmd.params, I.CARDTYPE);
  if (!tipo) {
    const ident = String(I.CARDTYPE);
    tipo = cmd.respostas && cmd.respostas[ident] != null ? String(cmd.respostas[ident]) : null;
    if (!tipo) {
      tipo = await perguntar(id, {
        identificador: I.CARDTYPE,
        tipo: "menu",
        prompt: "SELECIONE A FORMA",
        opcoes: [
          { texto: "CREDITO", valor: "1" },
          { texto: "DEBITO", valor: "2" },
        ],
        minimo: 0,
        maximo: 0,
        ocultar: false,
      });
      if (tipo == null) return resultado({ ret: R.CANCEL, aprovado: false, mensagem: "OPERACAO CANCELADA" });
    }
  }

  const telas = ["INSIRA OU APROXIME O CARTAO", "DIGITE A SENHA", "PROCESSANDO..."];
  for (const tela of telas) {
    emitir({ ev: "display", id, mensagem: tela });
    if (!(await passo(PASSO))) {
      cancelar = false;
      return resultado({ ret: R.CANCEL, aprovado: false, mensagem: "OPERACAO CANCELADA" });
    }
  }

  const centavos = valor % 100;
  if (centavos === 99) {
    emitir({ ev: "display", id, mensagem: "TRANSACAO NEGADA" });
    return resultado({ ret: R.FROMHOST, aprovado: false, mensagem: "TRANSACAO NEGADA (SIMULADOR)" });
  }

  host.seq += 1;
  const n = String(host.seq).padStart(6, "0");
  const refs = { reqNum: `REQ${n}`, locRef: `NSU${n}`, extRef: `HOST${n}`, virtMerch: "SIMULADOR", authSyst: "REDE SIMULADA" };
  host.pendente = { refs, valor, aprovadaEm: new Date().toISOString() };
  gravarHost(host);

  if (centavos === 97) {
    // Queda no meio: o "host" aprovou e ninguém vai confirmar.
    process.stderr.write("[simulador] caindo de propósito (valor terminado em 97)\n");
    process.exit(9);
  }

  emitir({ ev: "display", id, mensagem: "RETIRE O CARTAO" });
  await dormir(Math.min(PASSO, 300));

  const d = {
    valor,
    tipo,
    bandeira: "VISA (SIMULADO)",
    cartao: "************1234",
    nsu: refs.locRef,
    autorizacao: `A${n}`,
    reqNum: refs.reqNum,
  };
  const valores = {
    [I.AUTHCODE]: d.autorizacao,
    [I.CARDNAME]: d.bandeira,
    [I.CARDNAMESTD]: "VISA",
    [I.CARDPARCPAN]: d.cartao,
    [I.CARDTYPE]: tipo,
    [I.INSTALLMENTS]: "1",
    [I.TOTAMNT]: String(valor),
    [I.AUTLOCREF]: refs.locRef,
    [I.AUTEXTREF]: refs.extRef,
    [I.AUTHSYST]: refs.authSyst,
    [I.RCPTMERCH]: comprovante("VIA ESTABELECIMENTO", d),
    [I.RCPTCHOLDER]: comprovante("VIA CLIENTE", d),
    [I.RCPTFULL]: comprovante("VIA UNICA", d),
  };
  const info = {};
  for (const [nome, pwinfo] of Object.entries(cmd.resultados || {})) {
    if (valores[pwinfo] != null) info[nome] = valores[pwinfo];
  }
  return resultado({ ret: R.OK, aprovado: true, mensagem: "TRANSACAO APROVADA", requerConfirmacao: true, confirmacao: refs, info });
}

function confirmar(cmd) {
  const host = lerHost();
  const refs = cmd.ref || {};
  const p = host.pendente;
  if (!p || p.refs.reqNum !== refs.reqNum || p.refs.locRef !== refs.locRef) {
    return emitir({ ev: "confirmado", id: cmd.id ?? null, ok: false, ret: -2589 }); // TRNNOTFOUND
  }
  const desfez = Number(cmd.status) !== K.PWCNF.CNF_AUTO;
  host.historico.push({ refs: p.refs, valor: p.valor, acao: desfez ? "DESFEITA" : "CONFIRMADA", status: Number(cmd.status), em: new Date().toISOString() });
  host.pendente = null;
  gravarHost(host);
  emitir({ ev: "confirmado", id: cmd.id ?? null, ok: true, ret: 0 });
}

async function proximo() {
  if (ocupado) return;
  const cmd = fila.shift();
  if (!cmd) return;
  ocupado = true;
  try {
    if (cmd.cmd === "iniciar") {
      K = cmd.k;
      if (cmd.dll === "falhar") emitir({ ev: "falhou", id: null, erro: "Simulador: falha de inicialização pedida." });
      else {
        fs.mkdirSync(cmd.pastaDeTrabalho, { recursive: true });
        arquivoHost = path.join(cmd.pastaDeTrabalho, "simulador-host.json");
        emitir({ ev: "pronto", motor: "simulador", arquitetura: process.arch });
      }
    } else if (cmd.cmd === "venda") await venda(cmd);
    else if (cmd.cmd === "confirmar") confirmar(cmd);
    else if (cmd.cmd === "sair") process.exit(0);
  } catch (e) {
    emitir({ ev: "erro", id: cmd.id ?? null, erro: String((e && e.message) || e) });
  } finally {
    ocupado = false;
    setImmediate(proximo);
  }
}

readline.createInterface({ input: process.stdin }).on("line", (linha) => {
  if (!linha.trim()) return;
  let cmd;
  try {
    cmd = JSON.parse(linha);
  } catch {
    return emitir({ ev: "log", mensagem: "Comando ilegível" });
  }
  if (cmd.cmd === "cancelar") {
    cancelar = true;
    if (esperaResposta) {
      const r = esperaResposta;
      esperaResposta = null;
      r(null);
    }
    return;
  }
  if (cmd.cmd === "responder") {
    if (esperaResposta) {
      const r = esperaResposta;
      esperaResposta = null;
      r(cmd.valor == null ? null : String(cmd.valor));
    }
    return;
  }
  fila.push(cmd);
  proximo();
}).on("close", () => process.exit(0));
