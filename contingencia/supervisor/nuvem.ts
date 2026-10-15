/**
 * Conversa com a nuvem (https://firehubfood.com.br) usando a chave da loja.
 */
export class Nuvem {
  constructor(public base: string, private chave: string) {}

  /**
   * Quantas respostas 401 (chave recusada) seguidas, e desde quando. Uma
   * resposta boa de qualquer pedido com a chave zera. O sinal não conta: ele
   * responde sem olhar a chave. Quem decide o que fazer é o supervisor
   * (regras.ts → chaveRecusada).
   */
  recusasSeguidas = 0;
  primeiraRecusaEm = 0;

  private async pedir(caminho: string, init: RequestInit & { prazoMs?: number } = {}): Promise<Response> {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), init.prazoMs ?? 30_000);
    try {
      const r = await fetch(`${this.base}${caminho}`, {
        ...init,
        signal: c.signal,
        headers: { authorization: `Bearer ${this.chave}`, ...(init.headers || {}) },
      });
      if (!caminho.startsWith("/api/contingencia/sinal")) {
        if (r.status === 401) {
          if (this.recusasSeguidas === 0) this.primeiraRecusaEm = Date.now();
          this.recusasSeguidas++;
        } else if (r.ok) {
          this.recusasSeguidas = 0;
          this.primeiraRecusaEm = 0;
        }
      }
      return r;
    } finally {
      clearTimeout(t);
    }
  }

  async json<T>(caminho: string, init: RequestInit & { prazoMs?: number } = {}): Promise<T> {
    const r = await this.pedir(caminho, init);
    if (!r.ok) {
      const texto = await r.text().catch(() => "");
      throw new ErroDaNuvem(r.status, `${caminho} → ${r.status} ${texto.slice(0, 200)}`);
    }
    return (await r.json()) as T;
  }

  async enviar<T>(caminho: string, corpo: unknown, prazoMs = 60_000): Promise<T> {
    return this.json<T>(caminho, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      prazoMs,
    });
  }

  /** A nuvem está de pé? (`/api/contingencia/sinal`: o site E o banco respondem.) */
  async deEstaDePe(prazoMs = 4000): Promise<boolean> {
    try {
      const r = await this.pedir("/api/contingencia/sinal", { prazoMs, cache: "no-store" } as any);
      return r.ok;
    } catch {
      return false;
    }
  }
}

export class ErroDaNuvem extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
    this.name = "ErroDaNuvem";
  }
}
