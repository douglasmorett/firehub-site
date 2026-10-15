/**
 * IMPRESSAO PELO DRIVER DO WINDOWS (perfil "windows", 1.2.39)
 *
 * Para a impressora que NAO fala ESC/POS. O caso que abriu isto: a Diebold
 * IM453H da Bistro Burguer (15/10/2026), com o firmware em "Comandos Padrao".
 * Os bytes RAW do Assistente saiam picotados/lixo, e o MESMO texto mandado
 * pelo Bloco de Notas, pelo driver do Windows, saia perfeito.
 *
 * Entao, neste perfil, a comanda continua sendo montada pelo buildEscPos /
 * buildDanfeEscPos de sempre (o layout, a largura em colunas, os rotulos e o
 * modelo da loja sao os mesmos), e os bytes ESC/POS sao TRADUZIDOS aqui:
 *
 *   bytes ESC/POS  ->  linhas de texto (negrito/tamanho/alinhamento)
 *                  ->  pagina HTML monoespacada, na largura da bobina
 *                  ->  webContents.print() silencioso no driver da impressora
 *
 * Quem desenha e corta o papel e o driver, como no Bloco de Notas. O QR
 * (GS ( k) vira um SVG desenhado com o qr-code.js; a imagem raster (GS v 0,
 * o QR do DANFE no perfil "legacy") vira SVG tambem.
 *
 * Este modulo NAO sobe servidor nem exige o Electron no topo: o teste
 * (scripts/teste-impressao-windows.js) o carrega direto. O Electron so e
 * exigido dentro de imprimirPeloDriver().
 */
const { matrizDoQrCode } = require("./qr-code");

/* ─── Bytes ESC/POS -> linhas ─────────────────────────────────────────── */

function lerEscPos(dados) {
  const buf = Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados || ""), "latin1");
  const blocos = [];           // { tipo: "linha", runs, alinhamento } | { tipo: "imagem", ... }
  const estado = { negrito: false, larg: 1, alt: 1, inverso: false, alinhamento: 0 };
  let runs = [];
  let alinhamentoDaLinha = null;
  let qrGuardado = null;
  let moduloDoQr = 6;

  const acrescentar = (ch) => {
    if (alinhamentoDaLinha === null) alinhamentoDaLinha = estado.alinhamento;
    const ultimo = runs[runs.length - 1];
    const forte = estado.negrito || estado.inverso;
    if (ultimo && ultimo.negrito === forte && ultimo.larg === estado.larg && ultimo.alt === estado.alt) {
      ultimo.texto += ch;
    } else {
      runs.push({ texto: ch, negrito: forte, larg: estado.larg, alt: estado.alt });
    }
  };
  const fecharLinha = () => {
    blocos.push({ tipo: "linha", runs, alinhamento: alinhamentoDaLinha === null ? estado.alinhamento : alinhamentoDaLinha });
    runs = [];
    alinhamentoDaLinha = null;
  };
  const fecharLinhaSeAberta = () => { if (runs.length) fecharLinha(); };

  let i = 0;
  const n = buf.length;
  const byte = (k) => (k < n ? buf[k] : 0);

  while (i < n) {
    const c = buf[i];
    if (c === 0x0a) { fecharLinha(); i++; continue; }
    if (c === 0x1b) {                                     // ESC
      const cmd = byte(i + 1);
      const p = byte(i + 2);
      switch (cmd) {
        case 0x40:                                        // ESC @ reset
          estado.negrito = false; estado.larg = 1; estado.alt = 1; estado.inverso = false; estado.alinhamento = 0;
          i += 2; break;
        case 0x45: case 0x47:                             // ESC E n / ESC G n negrito
          estado.negrito = (p & 1) === 1; i += 3; break;
        case 0x61:                                        // ESC a n alinhamento
          estado.alinhamento = (p & 3) > 2 ? 0 : (p & 3); i += 3; break;
        case 0x21:                                        // ESC ! n modo de impressao
          estado.negrito = (p & 0x08) !== 0;
          estado.alt = (p & 0x10) ? 2 : 1;
          estado.larg = (p & 0x20) ? 2 : 1;
          i += 3; break;
        case 0x64: {                                      // ESC d n avanca n linhas
          fecharLinhaSeAberta();
          for (let k = 0; k < p; k++) fecharLinha();
          i += 3; break;
        }
        case 0x32: i += 2; break;                         // ESC 2 (sem parametro)
        case 0x70: i += 5; break;                         // ESC p m t1 t2 (gaveta)
        case 0x63: i += 4; break;                         // ESC c x n
        default: i += 3;                                  // ESC x n (1 parametro): t M R SP - J 3 ...
      }
      continue;
    }
    if (c === 0x1d) {                                     // GS
      const cmd = byte(i + 1);
      const p = byte(i + 2);
      if (cmd === 0x21) {                                 // GS ! n tamanho
        estado.larg = ((p >> 4) & 7) + 1;
        estado.alt = (p & 7) + 1;
        i += 3;
      } else if (cmd === 0x42) {                          // GS B n inverso
        estado.inverso = (p & 1) === 1; i += 3;
      } else if (cmd === 0x56) {                          // GS V m [n] corte
        i += (p === 0x41 || p === 0x42 || p === 65 || p === 66) ? 4 : 3;
      } else if (cmd === 0x4c || cmd === 0x57) {          // GS L / GS W (2 parametros)
        i += 4;
      } else if (cmd === 0x28) {                          // GS ( x pL pH dados
        const sub = byte(i + 2);
        const tam = byte(i + 3) | (byte(i + 4) << 8);
        const ini = i + 5;
        if (sub === 0x6b && tam >= 3) {                   // GS ( k: QR
          const fn = byte(ini + 1);
          if (fn === 0x43) moduloDoQr = byte(ini + 2) || 6;
          else if (fn === 0x50) qrGuardado = buf.slice(ini + 3, ini + tam).toString("utf8");
          else if (fn === 0x51 && qrGuardado != null) {
            fecharLinhaSeAberta();
            blocos.push({ tipo: "qr", texto: qrGuardado, modulo: moduloDoQr });
            qrGuardado = null;
          }
        }
        i = ini + tam;
      } else if (cmd === 0x76 && byte(i + 2) === 0x30) {  // GS v 0 m xL xH yL yH dados
        const porLinha = byte(i + 4) | (byte(i + 5) << 8);
        const linhas = byte(i + 6) | (byte(i + 7) << 8);
        const ini = i + 8;
        fecharLinhaSeAberta();
        blocos.push({ tipo: "raster", porLinha, linhas, dados: buf.slice(ini, ini + porLinha * linhas) });
        i = ini + porLinha * linhas;
      } else {
        i += 3;                                           // GS x n (1 parametro)
      }
      continue;
    }
    if (c >= 0x20 && c <= 0x7e) { acrescentar(String.fromCharCode(c)); i++; continue; }
    // Qualquer outro controle (CR, NUL, TAB...) e byte alto fica de fora: o
    // texto da comanda ja sai em ASCII do cleanAscii.
    i++;
  }
  fecharLinhaSeAberta();

  // As linhas em branco do avanco final (ESC d 4 antes do corte) nao vao:
  // quem avanca e corta e o driver.
  while (blocos.length) {
    const u = blocos[blocos.length - 1];
    if (u.tipo === "linha" && !u.runs.some(r => r.texto.trim())) blocos.pop();
    else break;
  }
  return blocos;
}

/* ─── Texto puro ─────────────────────────────────────────────────────── */

/**
 * A comanda em texto puro, na largura `columns`: so ASCII imprimivel e "\n".
 * Negrito/ampliado viram MAIUSCULAS; centralizado/direita viram espacos.
 * QR e imagem ficam de fora.
 */
function textoDaComanda(dados, columns = 48) {
  const cols = Math.max(24, Math.min(64, Math.floor(Number(columns) || 48)));
  const saida = [];
  for (const b of lerEscPos(dados)) {
    if (b.tipo !== "linha") continue;
    let t = b.runs.map(r => (r.negrito || r.larg > 1 || r.alt > 1) ? r.texto.toUpperCase() : r.texto).join("");
    if (b.alinhamento && t.trim().length < cols) {
      const nu = t.trim();
      const folga = cols - nu.length;
      t = " ".repeat(b.alinhamento === 1 ? Math.floor(folga / 2) : folga) + nu;
    }
    saida.push(t.replace(/\s+$/, ""));
  }
  return saida.join("\n") + "\n";
}

/* ─── HTML ───────────────────────────────────────────────────────────── */

const escaparHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 203 dpi ~ 8 pontos por mm: e a escala em que o QR/imagem sairiam no RAW.
const PONTOS_POR_MM = 8;

function svgDeModulos(lado, escuro, larguraMm, alturaMm) {
  let d = "";
  for (let y = 0; y < lado.linhas; y++) {
    for (let x = 0; x < lado.colunas; x++) {
      if (escuro(x, y)) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado.colunas} ${lado.linhas}" `
    + `width="${larguraMm.toFixed(2)}mm" height="${alturaMm.toFixed(2)}mm" shape-rendering="crispEdges">`
    + `<path d="${d}" fill="#000"/></svg>`;
}

function svgDoQr(texto, modulo) {
  try {
    const q = matrizDoQrCode(texto);
    const zona = 2;
    const lado = q.tamanho + zona * 2;
    const mm = Math.max(18, Math.min(45, (lado * (modulo || 6)) / PONTOS_POR_MM));
    return svgDeModulos({ colunas: lado, linhas: lado },
      (x, y) => {
        const c = x - zona, l = y - zona;
        return l >= 0 && c >= 0 && l < q.tamanho && c < q.tamanho && q.modulos[l][c];
      }, mm, mm);
  } catch (e) {
    return "";
  }
}

function svgDoRaster(b) {
  const colunas = b.porLinha * 8;
  return svgDeModulos({ colunas, linhas: b.linhas },
    (x, y) => {
      const v = b.dados[y * b.porLinha + (x >> 3)];
      return v != null && (v & (0x80 >> (x & 7))) !== 0;
    }, colunas / PONTOS_POR_MM, b.linhas / PONTOS_POR_MM);
}

/**
 * A pagina que vai para o driver. Largura util da bobina centralizada na
 * pagina (80 mm -> 72 mm, 58 mm -> 48 mm), e a letra no tamanho em que
 * `columns` caracteres da fonte monoespacada (0,6 em) ocupam essa largura.
 */
function htmlDaComanda(dados, { columns = 48, paperWidth = "80mm" } = {}) {
  const cols = Math.max(24, Math.min(64, Math.floor(Number(columns) || 48)));
  const larguraMm = paperWidth === "58mm" ? 48 : 72;
  const letraMm = Math.min(3.2, larguraMm / (cols * 0.6));

  const partes = [];
  let pre = [];
  const fecharPre = () => {
    if (pre.length) partes.push(`<pre>${pre.join("\n")}</pre>`);
    pre = [];
  };

  for (const b of lerEscPos(dados)) {
    if (b.tipo === "linha") {
      // Recuo do alinhamento em colunas NORMAIS, contando a largura ampliada.
      const visivel = b.runs.reduce((s, r) => s + r.texto.length * r.larg, 0);
      let recuo = "";
      if (b.alinhamento && visivel < cols) {
        const folga = cols - visivel;
        recuo = " ".repeat(b.alinhamento === 1 ? Math.floor(folga / 2) : folga);
      }
      const html = b.runs.map(r => {
        const estilo = [];
        if (r.negrito || r.alt > r.larg) estilo.push("font-weight:bold");
        if (r.larg > 1) estilo.push(`font-size:${r.larg * 100}%`);
        const t = escaparHtml(r.texto);
        return estilo.length ? `<span style="${estilo.join(";")}">${t}</span>` : t;
      }).join("");
      pre.push(recuo + html);
    } else {
      fecharPre();
      const svg = b.tipo === "qr" ? svgDoQr(b.texto, b.modulo) : svgDoRaster(b);
      if (svg) partes.push(`<div class="img">${svg}</div>`);
    }
  }
  fecharPre();

  return `<!doctype html><html><head><meta charset="utf-8"><title>FireHub</title><style>
@page { margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: ${larguraMm}mm; margin: 0 auto; padding: 1mm 0 2mm;
  font-family: "Courier New", Courier, Consolas, monospace; font-size: ${letraMm.toFixed(3)}mm; }
pre { margin: 0; font: inherit; white-space: pre; line-height: 1.15; overflow: hidden; }
.img { text-align: center; line-height: 0; }
.img + pre { margin-top: 1mm; }
</style></head><body>${partes.join("")}</body></html>`;
}

/* ─── Impressao pelo Electron ────────────────────────────────────────── */

/**
 * Imprime a pagina no driver de `printerName`, sem dialogo. Resolve quando o
 * Windows aceitou o trabalho; rejeita com o motivo (impressora inexistente,
 * driver recusou, prazo) — o chamador trata como o rawPrint: vira pendente.
 */
async function imprimirPeloDriver(printerName, html, { prazoMs = 30_000 } = {}) {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 420,
    height: 900,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true },
  });
  try {
    try {
      const impressoras = await win.webContents.getPrintersAsync();
      const alvo = String(printerName || "").toLowerCase().trim();
      if (impressoras.length && !impressoras.some(p => String(p.name || "").toLowerCase().trim() === alvo)) {
        throw new Error(`impressora "${printerName}" nao encontrada no Windows`);
      }
    } catch (e) {
      if (/nao encontrada/.test(e.message)) throw e;
      // Lista indisponivel: segue e deixa o print() dizer.
    }
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`driver do Windows nao respondeu em ${Math.round(prazoMs / 1000)} s`)), prazoMs);
      win.webContents.print({
        silent: true,
        deviceName: printerName,
        printBackground: false,
        margins: { marginType: "none" },
      }, (ok, motivo) => {
        clearTimeout(timer);
        if (ok) resolve(true);
        else reject(new Error(`driver do Windows recusou: ${motivo || "sem motivo"}`));
      });
    });
    console.log("[Print] OK (driver do Windows) ->", printerName);
    return true;
  } finally {
    try { win.destroy(); } catch (_) {}
  }
}

module.exports = { lerEscPos, textoDaComanda, htmlDaComanda, imprimirPeloDriver };
