/**
 * LER A BALANÇA PELO NAVEGADOR (Web Serial) — sem instalar nada na loja.
 *
 * - PC (Chrome ou Edge): a balança no cabo USB-serial; o navegador pede, uma
 *   vez, para escolher a porta e depois lembra.
 * - Tablet Android (Chrome): a balança num adaptador serial→Bluetooth PAREADO
 *   nas configurações do Android; o Chrome lê Bluetooth RFCOMM desde 2025.
 *   Não funciona dentro da WebView do app FireHub — abrir no Chrome.
 *
 * O protocolo (pedir, ler, entender a resposta) é puro e mora em
 * ./protocolo-toledo.ts. Aqui é só a porta: abrir, perguntar, esperar.
 *
 * `PortaSimulada` responde como uma Prix 3 Fit: é com ela que a tela é testada
 * sem balança (?simular=1), passando pelo mesmo leitor e pelo mesmo protocolo.
 */
import { ENQ, VELOCIDADES, extrairQuadros, quadroDoPeso, type LeituraDaBalanca } from "./protocolo-toledo";

/** O pedaço da Web Serial API que usamos (o TypeScript do projeto não traz os tipos). */
export type PortaSerial = {
  open(opcoes: { baudRate: number; dataBits?: number; stopBits?: number; parity?: "none" | "even" | "odd" }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};
type SerialDoNavegador = {
  requestPort(opcoes?: object): Promise<PortaSerial>;
  getPorts(): Promise<PortaSerial[]>;
};

export function serialDoNavegador(): SerialDoNavegador | null {
  if (typeof navigator === "undefined") return null;
  return ((navigator as any).serial as SerialDoNavegador) ?? null;
}

/** Quanto esperar a resposta de um ENQ. A 2400 bps os 7 bytes levam ~30 ms. */
const ESPERA_DA_RESPOSTA_MS = 400;

export class LeitorDaBalanca {
  private leitor: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private escritor: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer: number[] = [];
  private esperando: ((l: LeituraDaBalanca | null) => void) | null = null;
  private aberta = false;
  velocidade: number | null = null;

  constructor(readonly porta: PortaSerial) {}

  async abrir(velocidade: number): Promise<void> {
    await this.porta.open({ baudRate: velocidade, dataBits: 8, stopBits: 1, parity: "none" });
    this.velocidade = velocidade;
    this.aberta = true;
    this.buffer = [];
    this.escritor = this.porta.writable!.getWriter();
    this.leitor = this.porta.readable!.getReader();
    void this.lerSempre();
  }

  private async lerSempre() {
    try {
      while (this.aberta && this.leitor) {
        const { value, done } = await this.leitor.read();
        if (done) break;
        if (!value) continue;
        this.buffer.push(...value);
        const { leituras, resto } = extrairQuadros(this.buffer);
        this.buffer = resto;
        if (leituras.length > 0 && this.esperando) {
          const avisar = this.esperando;
          this.esperando = null;
          avisar(leituras[leituras.length - 1]);
        }
      }
    } catch {
      // Cabo puxado ou Bluetooth caiu: quem pergunta recebe "sem resposta".
    }
  }

  /** Pede o peso (ENQ) e espera a resposta. Nulo = a balança não respondeu. */
  async pedirPeso(): Promise<LeituraDaBalanca | null> {
    if (!this.aberta || !this.escritor) return null;
    const resposta = new Promise<LeituraDaBalanca | null>((resolve) => {
      this.esperando = resolve;
      setTimeout(() => {
        if (this.esperando === resolve) { this.esperando = null; resolve(null); }
      }, ESPERA_DA_RESPOSTA_MS);
    });
    try {
      await this.escritor.write(new Uint8Array([ENQ]));
    } catch {
      return null;
    }
    return resposta;
  }

  async fechar(): Promise<void> {
    this.aberta = false;
    try { await this.leitor?.cancel(); } catch {}
    try { this.leitor?.releaseLock(); } catch {}
    try { this.escritor?.releaseLock(); } catch {}
    this.leitor = null;
    this.escritor = null;
    try { await this.porta.close(); } catch {}
  }
}

/**
 * Abre a porta descobrindo a velocidade: tenta 2400, 4800 e 9600 até a balança
 * responder qualquer coisa que se entenda (peso, "instável", "negativo").
 * A velocidade que funcionou vem primeiro na próxima vez (`preferida`).
 */
export async function conectarNaBalanca(porta: PortaSerial, preferida?: number | null): Promise<LeitorDaBalanca | null> {
  const ordem = preferida ? [preferida, ...VELOCIDADES.filter((v) => v !== preferida)] : [...VELOCIDADES];
  for (const velocidade of ordem) {
    const leitor = new LeitorDaBalanca(porta);
    try {
      await leitor.abrir(velocidade);
    } catch {
      await leitor.fechar();
      continue;
    }
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const l = await leitor.pedirPeso();
      if (l && l.tipo !== "invalida") return leitor;
    }
    await leitor.fechar();
  }
  return null;
}

// ─── Balança simulada ───────────────────────────────────────────────────────

/**
 * Uma Prix 3 Fit de mentira: responde ao ENQ com o quadro do peso atual.
 * `pesar(kg)` põe o prato (passa por "IIIII" antes de firmar, como a de
 * verdade); `tirar()` volta a zero.
 */
export class PortaSimulada implements PortaSerial {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  private peso: number | "instavel" = 0;
  private enviar: ((bytes: Uint8Array) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  async open(): Promise<void> {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controle) => { this.enviar = (b) => { try { controle.enqueue(b); } catch {} }; },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (bytes) => {
        if (bytes.includes(ENQ)) setTimeout(() => this.enviar?.(new Uint8Array(quadroDoPeso(this.peso))), 20);
      },
    });
  }

  async close(): Promise<void> {
    this.enviar = null;
    this.readable = null;
    this.writable = null;
  }

  pesar(kg: number) {
    if (this.timer) clearTimeout(this.timer);
    this.peso = "instavel";
    this.timer = setTimeout(() => { this.peso = kg; }, 700);
  }

  tirar() {
    if (this.timer) clearTimeout(this.timer);
    this.peso = 0;
  }
}
