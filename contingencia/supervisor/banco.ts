/**
 * O Postgres da cópia, no computador da loja: cria a pasta na primeira vez
 * (initdb, sem administrador e sem serviço do Windows), liga, desliga.
 *
 * Escuta só em 127.0.0.1: ninguém na rede da loja fala com o banco, só o
 * supervisor e o FireHub local.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const executar = promisify(execFile);

type ProcessoDoWindows = { pid: number; pai: number; exe: string; cmd: string };

export class BancoLocal {
  private processo: ChildProcess | null = null;
  pool: pg.Pool | null = null;

  constructor(
    private bin: string,
    private dados: string,
    private porta: number,
    private nomeDoBanco: string,
    private registro: (linha: string) => void,
  ) {}

  private exe(nome: string): string {
    const comExtensao = path.join(this.bin, process.platform === "win32" ? `${nome}.exe` : nome);
    return fs.existsSync(comExtensao) ? comExtensao : path.join(this.bin, nome);
  }

  url(): string {
    return `postgresql://postgres@127.0.0.1:${this.porta}/${this.nomeDoBanco}`;
  }

  private async responde(banco = "postgres"): Promise<boolean> {
    const c = new pg.Client({ host: "127.0.0.1", port: this.porta, user: "postgres", database: banco, connectionTimeoutMillis: 1500 });
    const pergunta = (async () => {
      await c.connect();
      await c.query("SELECT 1");
      return true;
    })().catch(() => false);
    let relogio: NodeJS.Timeout | undefined;
    const prazo = new Promise<boolean>((r) => {
      relogio = setTimeout(() => r(false), 3000);
    });
    const ok = await Promise.race([pergunta, prazo]);
    clearTimeout(relogio);
    // Sem esperar o fim da conexão: com uma sobra segurando a porta, o end()
    // ficava preso por dezenas de segundos a cada pergunta.
    c.end().catch(() => {});
    return ok;
  }

  /** Cria a pasta do banco na primeira vez. */
  async garantirPasta(): Promise<void> {
    if (fs.existsSync(path.join(this.dados, "PG_VERSION"))) return;
    fs.mkdirSync(this.dados, { recursive: true });
    this.registro("Criando o banco da cópia (primeira vez)…");
    await executar(this.exe("initdb"), ["-D", this.dados, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"], {
      windowsHide: true,
    });
  }

  // ── Sobras de um Postgres anterior ──────────────────────────────────────────
  //
  // Quando o supervisor morre no meio (troca de versão em que o Assistente
  // encerra à força, falha ao iniciar), o Postgres que ele ligou cai junto de
  // qualquer jeito — e no Windows um processo filho dele pode ficar vivo,
  // órfão, segurando a memória compartilhada. Daí em diante todo Postgres novo
  // morre com "pre-existing shared memory block is still in use" e o
  // supervisor fica caindo a cada minuto: a contingência ficou mais de 3 h fora
  // assim em 14/10/2026, sem ninguém ver. Por isso: anotar o PID do Postgres
  // ligado e, antes de ligar outro, encerrar o que sobrou dele.

  /** Onde fica anotado o PID do Postgres que o supervisor ligou. */
  private arquivoDoPid(): string {
    return path.join(path.dirname(this.dados), "banco.pid");
  }

  private async postgresNoWindows(): Promise<ProcessoDoWindows[]> {
    if (process.platform !== "win32") return [];
    try {
      const { stdout } = await executar(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.ExecutablePath)|$($_.CommandLine)\" }",
        ],
        { windowsHide: true, timeout: 30_000 },
      );
      return String(stdout)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [pid, pai, exe, ...cmd] = l.split("|");
          return { pid: Number(pid), pai: Number(pai), exe: (exe || "").trim(), cmd: cmd.join("|").trim() };
        })
        .filter((p) => p.pid > 0);
    } catch {
      return [];
    }
  }

  private async encerrar(processos: ProcessoDoWindows[], motivo: string): Promise<void> {
    for (const p of processos) await executar("taskkill", ["/F", "/PID", String(p.pid)], { windowsHide: true }).catch(() => {});
    if (processos.length) this.registro(`Postgres da cópia: ${processos.length} processo(s) ${motivo} encerrado(s).`);
  }

  /**
   * Antes de ligar: o Postgres anotado que não responde e os filhos dele, e
   * qualquer processo do binário da cópia (nunca outro Postgres do computador).
   */
  private async limparSobras(): Promise<void> {
    if (process.platform !== "win32") return;
    let anotado = 0;
    try {
      anotado = Number(fs.readFileSync(this.arquivoDoPid(), "utf8").trim()) || 0;
    } catch {
      /* nada anotado */
    }
    const nosso = path.resolve(this.exe("postgres")).toLowerCase();
    const ehNosso = (p: ProcessoDoWindows) => !!p.exe && path.resolve(p.exe).toLowerCase() === nosso;
    const sobrasEm = (lista: ProcessoDoWindows[]) => {
      const vivos = new Set(lista.map((p) => p.pid));
      return lista.filter(
        (p) =>
          ehNosso(p) ||
          // O anotado (se o caminho não se lê, é ele mesmo pelo PID) e os filhos dele que ficaram órfãos.
          (anotado > 0 && ((p.pid === anotado && (!p.exe || ehNosso(p))) || (p.pai === anotado && !vivos.has(anotado)))),
      );
    };
    const lista = await this.postgresNoWindows();
    const sobras = sobrasEm(lista);
    if (!sobras.length) return;
    // Com o Postgres principal ainda vivo, ele pode estar só subindo
    // (recuperação depois de uma queda): espera um pouco antes de encerrar.
    // Morto ele, os filhos (os de "--forkchild") são órfãos com certeza —
    // encerra na hora.
    const principalVivo = sobras.some((p) => p.pid === anotado || (ehNosso(p) && !!p.cmd && !p.cmd.includes("--forkchild")));
    if (principalVivo) {
      const limite = Date.now() + 15_000;
      while (Date.now() < limite) {
        if (await this.responde()) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
      await this.encerrar(sobrasEm(await this.postgresNoWindows()), "de uma parada incompleta");
      return;
    }
    await this.encerrar(sobras, "órfão(s) de uma parada incompleta");
  }

  /**
   * Último recurso, só quando o Postgres novo acusa a memória compartilhada
   * presa (computador que ainda não tinha o PID anotado): os postgres.exe
   * órfãos (pai morto) cujo caminho nem se lê mais — um processo morrendo. O
   * Postgres de outro programa tem pai vivo (o serviço do Windows) e, sendo de
   * outro usuário, o taskkill nem consegue encerrar.
   */
  private async limparOrfaos(): Promise<void> {
    const lista = await this.postgresNoWindows();
    const vivos = new Set(lista.map((p) => p.pid));
    await this.encerrar(lista.filter((p) => !p.exe && !vivos.has(p.pai)), "órfão(s) sem dono");
  }

  /** O motivo do último FATAL no banco.log (para o registro e para decidir a nova tentativa). */
  private ultimoFatal(): string {
    try {
      const arquivo = path.join(path.dirname(this.dados), "banco.log");
      const tamanho = fs.statSync(arquivo).size;
      const fd = fs.openSync(arquivo, "r");
      const n = Math.min(tamanho, 8192);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, tamanho - n);
      fs.closeSync(fd);
      const linhas = buf.toString("utf8").split(/\r?\n/).filter((l) => l.includes("FATAL:"));
      return (linhas.pop() || "").replace(/^.*FATAL:\s*/, "").trim();
    } catch {
      return "";
    }
  }

  /** Liga o Postgres (ou aproveita o que já está de pé nesta porta). */
  async ligar(): Promise<void> {
    if (!(await this.responde())) {
      await this.garantirPasta();
      await this.limparSobras();
    }
    for (let tentativa = 1; !(await this.responde()); tentativa++) {
      const log = fs.openSync(path.join(path.dirname(this.dados), "banco.log"), "a");
      // UTC como a nuvem (Neon): sem isto o initdb pega o fuso do Windows e
      // todo `now()` gravado em coluna TIMESTAMP pelo SQL do FireHub sairia
      // 3 h deslocado na volta.
      const args = ["-D", this.dados, "-p", String(this.porta), "-h", "127.0.0.1", "-c", "timezone=UTC", "-c", "log_timezone=UTC"];
      const processo = spawn(this.exe("postgres"), args, {
        stdio: ["ignore", log, log],
        windowsHide: true,
      });
      this.processo = processo;
      if (processo.pid) {
        try {
          fs.writeFileSync(this.arquivoDoPid(), String(processo.pid));
        } catch {
          /* sem a anotação, a limpeza usa o caminho do binário */
        }
      }
      let morreu = false;
      processo.on("exit", (codigo) => {
        morreu = true;
        this.registro(`Postgres da cópia parou (código ${codigo}).`);
        if (this.processo === processo) this.processo = null;
      });
      const limite = Date.now() + 60_000;
      let pronto = false;
      // Postgres que morreu na largada não vai responder: não espera 60 s por ele.
      while (!morreu && Date.now() < limite) {
        if (await this.responde()) {
          pronto = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (pronto) break;
      const motivo = this.ultimoFatal();
      if (morreu && tentativa === 1 && /shared memory block is still in use/i.test(motivo)) {
        await this.limparOrfaos();
        continue;
      }
      throw new Error(`O Postgres da cópia não subiu${morreu && motivo ? `: ${motivo}` : " em 60 s"}.`);
    }
    const admin = new pg.Client({ host: "127.0.0.1", port: this.porta, user: "postgres", database: "postgres" });
    await admin.connect();
    try {
      const existe = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [this.nomeDoBanco]);
      const nome = this.nomeDoBanco.replace(/"/g, "");
      if (!existe.rowCount) await admin.query(`CREATE DATABASE "${nome}"`);
      // Vale também para um Postgres que já estava de pé sem o -c acima.
      await admin.query(`ALTER DATABASE "${nome}" SET timezone TO 'UTC'`);
    } finally {
      await admin.end();
    }
    this.pool = new pg.Pool({ host: "127.0.0.1", port: this.porta, user: "postgres", database: this.nomeDoBanco, max: 4 });
    this.pool.on("error", (e) => this.registro(`Banco da cópia: ${e.message}`));
  }

  /** Apaga TUDO da cópia (só quando não há nada para subir). */
  async zerar(): Promise<void> {
    if (!this.pool) throw new Error("Banco desligado.");
    await this.pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  }

  async desligar(): Promise<void> {
    await this.pool?.end().catch(() => {});
    this.pool = null;
    // Também o Postgres que este supervisor só aproveitou (ficou de pé de um
    // supervisor anterior): o pg_ctl acha o processo pela pasta do banco.
    if (this.processo || fs.existsSync(path.join(this.dados, "postmaster.pid"))) {
      await executar(this.exe("pg_ctl"), ["stop", "-D", this.dados, "-m", "fast"], { windowsHide: true }).catch(() => {});
    }
  }
}
