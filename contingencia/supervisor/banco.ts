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
    try {
      await c.connect();
      await c.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await c.end().catch(() => {});
    }
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

  /** Liga o Postgres (ou aproveita o que já está de pé nesta porta). */
  async ligar(): Promise<void> {
    if (!(await this.responde())) {
      await this.garantirPasta();
      const log = fs.openSync(path.join(path.dirname(this.dados), "banco.log"), "a");
      // UTC como a nuvem (Neon): sem isto o initdb pega o fuso do Windows e
      // todo `now()` gravado em coluna TIMESTAMP pelo SQL do FireHub sairia
      // 3 h deslocado na volta.
      const args = ["-D", this.dados, "-p", String(this.porta), "-h", "127.0.0.1", "-c", "timezone=UTC", "-c", "log_timezone=UTC"];
      this.processo = spawn(this.exe("postgres"), args, {
        stdio: ["ignore", log, log],
        windowsHide: true,
      });
      this.processo.on("exit", (codigo) => {
        this.registro(`Postgres da cópia parou (código ${codigo}).`);
        this.processo = null;
      });
      const limite = Date.now() + 60_000;
      while (!(await this.responde())) {
        if (Date.now() > limite) throw new Error("O Postgres da cópia não respondeu em 60 s.");
        await new Promise((r) => setTimeout(r, 500));
      }
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
