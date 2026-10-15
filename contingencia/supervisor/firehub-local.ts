/**
 * O FireHub local: o MESMO build do site (server.js do Next standalone),
 * rodando no computador da loja com `FIREHUB_LOCAL=1` e apontando para a
 * cópia (src/lib/modo-local.ts diz o que muda lá dentro).
 *
 * Sobe quando a nuvem começa a falhar e desce depois de um tempo em paz:
 * computador de caixa costuma ser fraco, e o Next parado não gasta memória.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";

export type AmbienteDoFireHub = {
  appDir: string;
  node: string;
  porta: number;
  portaDaLoja: number;
  bancoUrl: string;
  segredoLocal: string;
  segredoDoBilhete: string;
  loja: string;
  pasta: string;
};

/** Os PIDs que escutam nesta porta, pelo `netstat -ano` do Windows. */
export function pidsNaPorta(saidaDoNetstat: string, porta: number): string[] {
  const pids = new Set<string>();
  for (const linha of saidaDoNetstat.split("\n")) {
    const m = linha.trim().split(/\s+/);
    if (m.length >= 5 && m[1]?.endsWith(`:${porta}`) && /LISTEN/i.test(m[3] || "") && /^\d+$/.test(m[4])) pids.add(m[4]);
  }
  return [...pids];
}

export class FireHubLocal {
  private processo: ChildProcess | null = null;
  private subindo: Promise<void> | null = null;
  private respondeu = false;

  constructor(private amb: AmbienteDoFireHub, private registro: (l: string) => void) {}

  ligado(): boolean {
    return this.processo !== null;
  }

  pronto(): boolean {
    return this.processo !== null && this.respondeu;
  }

  private async responde(): Promise<boolean> {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 2000);
      const r = await fetch(`http://127.0.0.1:${this.amb.porta}/api/contingencia/sinal`, { signal: c.signal });
      clearTimeout(t);
      return r.status > 0;
    } catch {
      return false;
    }
  }

  /**
   * Um FireHub local de uma execução anterior do supervisor (fechado à força,
   * sem desligar o filho) segura a porta e faria o novo morrer com
   * EADDRINUSE. Só o processo que escuta NA NOSSA porta é encerrado.
   */
  private async encerrarOrfao(): Promise<void> {
    if (process.platform !== "win32" || !(await this.responde())) return;
    const saida: string = await new Promise((ok) =>
      execFile("netstat", ["-ano", "-p", "TCP"], { windowsHide: true }, (_e, out) => ok(String(out || ""))),
    );
    for (const pid of pidsNaPorta(saida, this.amb.porta)) {
      if (pid === String(process.pid)) continue;
      await new Promise((ok) => execFile("taskkill", ["/PID", pid, "/T", "/F"], { windowsHide: true }, () => ok(null)));
      this.registro(`FireHub local antigo (PID ${pid}) encerrado.`);
    }
  }

  /** Esperando ele responder pela primeira vez (o processo pode estar vivo e ainda não pronto). */
  subindoAgora(): boolean {
    return this.subindo !== null;
  }

  /**
   * Liga — ou, com o processo vivo e sem resposta, volta a esperar por ele
   * (antes, passados 90 s, ninguém mais perguntava: o processo ficava vivo,
   * nunca "pronto", e a loja passava a queda inteira na página de espera).
   */
  async ligar(): Promise<void> {
    if (this.subindo) return this.subindo;
    if (this.processo && this.respondeu) return;
    const vivo = this.processo;
    // Uma subida por vez: o ciclo e a porta da loja chamam ligar() juntos, e
    // os dois passariam pela faxina do órfão e subiriam dois processos.
    this.subindo = (async () => {
      let filho = vivo;
      if (!filho) {
        await this.encerrarOrfao();
        filho = this.lancar();
      }
      await this.esperarPronto(filho);
    })().finally(() => {
      this.subindo = null;
    });
    return this.subindo;
  }

  /** Sobe o processo. O filho fica no closure: o exit de um processo antigo não apaga o novo. */
  private lancar(): ChildProcess {
    const servidor = path.join(this.amb.appDir, "server.js");
    if (!fs.existsSync(servidor)) throw new Error(`FireHub local não encontrado em ${servidor}.`);
    const log = fs.openSync(path.join(this.amb.pasta, "firehub-local.log"), "a");
    this.respondeu = false;
    const filho = spawn(this.amb.node, [servidor], {
      cwd: this.amb.appDir,
      stdio: ["ignore", log, log],
      windowsHide: true,
      env: {
        ...process.env,
        FIREHUB_LOCAL: "1",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        PORT: String(this.amb.porta),
        HOSTNAME: "127.0.0.1",
        DATABASE_URL: this.amb.bancoUrl,
        NEXTAUTH_SECRET: this.amb.segredoLocal,
        NEXTAUTH_URL: `http://127.0.0.1:${this.amb.portaDaLoja}`,
        CONTINGENCIA_SEGREDO_DO_BILHETE: this.amb.segredoDoBilhete,
        CONTINGENCIA_LOJA: this.amb.loja,
        // O FireHub local não usa a chave da loja nem nenhuma chave de fora.
        CONTINGENCIA_CHAVE: "",
      },
    });
    // O processo filho já tem a própria cópia do arquivo de registro.
    try { fs.closeSync(log); } catch { /* já fechado */ }
    this.processo = filho;
    this.registro("FireHub local subindo…");
    filho.on("exit", (codigo) => {
      this.registro(`FireHub local parou (código ${codigo}).`);
      if (this.processo === filho) {
        this.processo = null;
        this.respondeu = false;
      }
    });
    // Sem isto, um node que não abre (caminho errado) derrubava o supervisor inteiro.
    filho.on("error", (e) => {
      this.registro(`FireHub local não abriu: ${e.message}`);
      if (this.processo === filho) {
        this.processo = null;
        this.respondeu = false;
      }
    });
    return filho;
  }

  /**
   * Espera o FireHub responder. Passados 90 s, avisa e continua perguntando
   * (a primeira subida de uma versão nova chega a ~1 min, com o antivírus
   * examinando os arquivos). Passados ~180 s, mata e sobe de novo, uma vez.
   */
  private async esperarPronto(primeiro: ChildProcess): Promise<void> {
    let filho = primeiro;
    let inicio = Date.now();
    let avisou = false;
    let reiniciou = false;
    while (this.processo === filho && !(await this.responde())) {
      const passou = Date.now() - inicio;
      if (passou > 90_000 && !avisou) {
        avisou = true;
        this.registro("O FireHub local não respondeu em 90 s: segue esperando.");
      }
      if (passou > 180_000) {
        if (reiniciou) throw new Error("O FireHub local não respondeu em 3 min, nem depois de reiniciar.");
        reiniciou = true;
        this.registro("O FireHub local não respondeu em 3 min: reiniciando.");
        await this.matar(filho);
        if (this.processo !== null) return; // alguém já subiu outro
        filho = this.lancar();
        inicio = Date.now();
        avisou = false;
        continue;
      }
      await new Promise((r) => setTimeout(r, avisou ? 2000 : 500));
    }
    if (this.processo === filho) {
      this.respondeu = true;
      this.registro("FireHub local pronto.");
    }
  }

  /** Encerra este processo e espera ele sair (até ~3 s): a porta fica livre para o próximo. */
  private async matar(filho: ChildProcess): Promise<void> {
    if (this.processo === filho) {
      this.processo = null;
      this.respondeu = false;
    }
    if (filho.exitCode !== null || filho.signalCode !== null) return;
    const saiu = new Promise<void>((ok) => filho.once("exit", () => ok()));
    filho.kill();
    await Promise.race([saiu, new Promise((r) => setTimeout(r, 3000))]);
  }

  async desligar(): Promise<void> {
    const p = this.processo;
    if (!p) return;
    await this.matar(p);
    this.registro("FireHub local desligado (nuvem estável).");
  }
}
