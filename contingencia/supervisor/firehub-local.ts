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

  async ligar(): Promise<void> {
    if (this.processo) return this.subindo ?? undefined;
    await this.encerrarOrfao();
    const servidor = path.join(this.amb.appDir, "server.js");
    if (!fs.existsSync(servidor)) throw new Error(`FireHub local não encontrado em ${servidor}.`);
    const log = fs.openSync(path.join(this.amb.pasta, "firehub-local.log"), "a");
    this.respondeu = false;
    this.processo = spawn(this.amb.node, [servidor], {
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
    this.registro("FireHub local subindo…");
    this.processo.on("exit", (codigo) => {
      this.registro(`FireHub local parou (código ${codigo}).`);
      this.processo = null;
      this.respondeu = false;
    });
    this.subindo = (async () => {
      const limite = Date.now() + 90_000;
      while (this.processo && !(await this.responde())) {
        if (Date.now() > limite) throw new Error("O FireHub local não respondeu em 90 s.");
        await new Promise((r) => setTimeout(r, 500));
      }
      if (this.processo) {
        this.respondeu = true;
        this.registro("FireHub local pronto.");
      }
    })().finally(() => {
      this.subindo = null;
    });
    return this.subindo;
  }

  async desligar(): Promise<void> {
    const p = this.processo;
    if (!p) return;
    this.processo = null;
    this.respondeu = false;
    p.kill();
    this.registro("FireHub local desligado (nuvem estável).");
  }
}
