/**
 * O celular da loja como impressora: puxa as comandas da fila do FireHub e
 * manda para a térmica Bluetooth.
 *
 * O servidor faz tudo que o Assistente do PC faz (api/app-firehub/impressao):
 * decide o que sai, em qual modelo, e devolve os bytes ESC/POS prontos. Aqui
 * é só: puxar a cada 4 s, imprimir cada papel na ordem e confirmar o trabalho
 * (ack) quando TODOS os papéis dele saíram. Papel que falhou não confirma: o
 * trabalho volta na próxima puxada — a impressora desligada não perde comanda.
 *
 * Com o app na frente (a tela fica acesa enquanto a impressora está ligada).
 * O aviso de pedido novo chega com o app fechado; tocando nele, o app abre e
 * imprime o que estava esperando.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";

import ImpressoraBluetooth from "../../modules/impressora-bluetooth";
import { chamar, ErroDaApi } from "./api";
import { PUXAR_COMANDAS_MS } from "./config";
import { gravarImpressora, idDoAparelho, lerImpressora, type Impressora } from "./guardado";
import { useSessaoDaLoja } from "./sessao";

type Estado = {
  impressora: Impressora | null;
  /** O que a tela mostra embaixo do nome da impressora. */
  situacao: string;
  erro: string | null;
  impressasHoje: number;
  escolher: (i: Impressora | null) => Promise<void>;
  ligar: (ligada: boolean) => Promise<void>;
  imprimirTeste: () => Promise<void>;
  /** Puxa já (o aviso de pedido novo chegou). */
  puxarAgora: () => void;
};

const Contexto = createContext<Estado | null>(null);

/** Pede "Dispositivos por perto" (Android 12+); antes disso a permissão vem da instalação. */
export async function permitirBluetooth(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 31) return true;
  const r = await PermissionsAndroid.request("android.permission.BLUETOOTH_CONNECT" as any);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

/** "Teste de impressão" montado aqui mesmo (ESC/POS simples, ASCII). */
function papelDeTeste(largura: "58mm" | "80mm"): string {
  const cols = largura === "58mm" ? 32 : 48;
  const centro = (t: string) => " ".repeat(Math.max(0, Math.floor((cols - t.length) / 2))) + t + "\n";
  const ESC = "\x1b", GS = "\x1d";
  const texto =
    ESC + "@" +
    ESC + "!" + "\x30" + centro("FIREHUB") + ESC + "!" + "\x00" +
    centro("Teste de impressao") +
    "-".repeat(cols) + "\n" +
    "Se voce esta lendo isto, a\nimpressora Bluetooth esta pronta\npara as comandas.\n" +
    "-".repeat(cols) + "\n" +
    centro(new Date().toLocaleString("pt-BR")) +
    "\n\n\n" + GS + "V" + "\x42" + "\x00";
  return globalThis.btoa(texto);
}

export function ImpressaoProvider({ children }: { children: ReactNode }) {
  const { sessao } = useSessaoDaLoja();
  const [impressora, setImpressora] = useState<Impressora | null>(null);
  const [situacao, setSituacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [impressasHoje, setImpressasHoje] = useState(0);
  const [ativo, setAtivo] = useState(AppState.currentState === "active");
  const ocupado = useRef(false);
  const abertoEm = useRef(Date.now());
  const aparelho = useRef<string>("");

  useEffect(() => {
    lerImpressora().then(setImpressora);
    idDoAparelho().then((id) => { aparelho.current = id; });
    const sub = AppState.addEventListener("change", (s) => setAtivo(s === "active"));
    return () => sub.remove();
  }, []);

  const pronta = Boolean(sessao && impressora?.ligada && impressora.endereco && Platform.OS === "android");

  // Tela acesa enquanto este celular é a impressora da loja.
  useEffect(() => {
    if (!pronta) return;
    void activateKeepAwakeAsync("impressora");
    return () => { void deactivateKeepAwake("impressora"); };
  }, [pronta]);

  const puxar = useCallback(async () => {
    if (!pronta || !sessao || !impressora || ocupado.current) return;
    ocupado.current = true;
    try {
      const abertoHaSeg = Math.floor((Date.now() - abertoEm.current) / 1000);
      const r = await chamar<{ trabalhos: { jobId: string; papeis: string[] }[] }>(
        `/api/app-firehub/impressao?largura=${impressora.largura}&aparelho=${aparelho.current}&abertoHaSeg=${abertoHaSeg}`,
        { token: sessao.token, limite: 12_000 },
      );
      const saiu: string[] = [];
      for (const t of r.trabalhos || []) {
        let todos = true;
        for (const papel of t.papeis) {
          try {
            await ImpressoraBluetooth.imprimir(impressora.endereco, papel);
          } catch (e: any) {
            todos = false;
            setErro(e?.message || "A impressora não respondeu.");
            break;
          }
        }
        if (!todos) break; // impressora fora: para aqui e tenta de novo depois, na ordem.
        saiu.push(t.jobId);
        if (t.papeis.length) setImpressasHoje((n) => n + 1);
      }
      if (saiu.length) {
        await chamar("/api/app-firehub/impressao", { metodo: "POST", token: sessao.token, corpo: { ids: saiu } }).catch(() => {});
        setErro(null);
      }
      setSituacao(`Esperando comandas · conferido às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`);
    } catch (e) {
      setSituacao(e instanceof ErroDaApi && e.tipo === "rede" ? "Sem internet: tento de novo em instantes." : `Fila indisponível: ${(e as Error).message}`);
    } finally {
      ocupado.current = false;
    }
  }, [pronta, sessao, impressora]);

  useEffect(() => {
    if (!pronta || !ativo) return;
    void puxar();
    const i = setInterval(puxar, PUXAR_COMANDAS_MS);
    return () => clearInterval(i);
  }, [pronta, ativo, puxar]);

  const escolher = useCallback(async (i: Impressora | null) => {
    await ImpressoraBluetooth.desconectar().catch(() => {});
    // Começa agora: a fila não manda o que entrou antes de ligar (o teto zero do Assistente).
    abertoEm.current = Date.now();
    setImpressora(i);
    setErro(null);
    await gravarImpressora(i);
  }, []);

  const ligar = useCallback(async (ligada: boolean) => {
    if (!impressora) return;
    abertoEm.current = Date.now();
    const nova = { ...impressora, ligada };
    setImpressora(nova);
    await gravarImpressora(nova);
  }, [impressora]);

  const imprimirTeste = useCallback(async () => {
    if (!impressora) return;
    setErro(null);
    try {
      if (!(await permitirBluetooth())) throw new Error("Permita o acesso a \"Dispositivos por perto\" para o FireHub.");
      await ImpressoraBluetooth.imprimir(impressora.endereco, papelDeTeste(impressora.largura));
      setSituacao("Teste impresso.");
    } catch (e: any) {
      setErro(e?.message || "A impressora não respondeu.");
    }
  }, [impressora]);

  return (
    <Contexto.Provider value={{ impressora, situacao, erro, impressasHoje, escolher, ligar, imprimirTeste, puxarAgora: () => void puxar() }}>
      {children}
    </Contexto.Provider>
  );
}

export function useImpressao(): Estado {
  const c = useContext(Contexto);
  if (!c) throw new Error("useImpressao fora do ImpressaoProvider");
  return c;
}
