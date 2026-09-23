"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { fetchAssistente, printersParaAssistente, VERSAO_ASSISTENTE_ATUAL } from "@/lib/print";
import { traduzErroDeImpressao } from "@/lib/erro-de-impressao";
import { BotaoNaoVerMais, gravarNaoVerMais, lerNaoVerMais } from "./NaoVerMais";

/**
 * A faixa de "a impressão parou" — e, desde 06/09/2026, de "a comanda não
 * está saindo".
 *
 * Comanda de mesa, de balcão, do iFood e do 99Food é puxada pelo Assistente
 * no PC do caixa, da fila da nuvem, a cada 3 s. Quando ele fecha, trava ou
 * perde a configuração da loja, nada avisa — a loja descobre pela comanda
 * que não saiu, e o suporte só sabe indo ao PC. O servidor carimba a última
 * consulta (User.printQueuePolledAt) e guarda o que o Assistente contou de
 * si (User.printQueueEstado: comandas presas, último erro, impressoras que o
 * Windows enxerga). Esta faixa lê os dois.
 *
 * ── O terceiro olho: o Assistente DESTE computador ────────────────────────
 * Quando a fila está muda, a faixa sonda localhost. Se há um Assistente
 * aqui, vinculado a outra loja ou a nenhuma, a causa é essa e a solução é um
 * clique ("Vincular agora"), não "confira o PC do caixa". Foi o caso da
 * Hakim Centro: 587 pedidos por semana e o Assistente nunca vinculado —
 * toda comanda dependia de a aba do painel estar aberta e acordada.
 *
 * Os casos, do mais específico ao mais genérico:
 *   1. Assistente aqui, não vinculado a esta loja → Vincular agora.
 *   2. Assistente aqui, vinculado, mas a fila nunca o viu → versão antiga.
 *   3. Consultava e parou → PC desligado/sem internet/Assistente fechado.
 *   4. Nunca consultou e a loja usa salão → o aviso antigo.
 *   5. Impressora cadastrada que não existe naquele PC → comanda nunca sai.
 *   6. Comanda presa (pendente) → impressora desligada/sem papel/em erro.
 *   7. Assistente antigo no PC do caixa → comanda em dobro a cada reinício.
 *
 * Para loja com impressora cadastrada, todos os casos. Para loja SEM
 * impressora cadastrada, só o caso 1 (e o vínculo é feito sozinho quando o
 * Assistente deste PC não tem loja nenhuma): ela também depende da fila para
 * o fechamento de caixa — o Frangoso ficou quatro noites sem ele (23/09/2026).
 */
const TOLERANCIA_S = 3 * 60;

/** `a` é mais nova que `b`? ("1.2.8" > "1.2.6"). Igual ou menor = false. */
function versaoMaisNova(a: string, b: string): boolean {
  const x = String(a || "").split(".").map((n) => parseInt(n, 10) || 0);
  const y = String(b || "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) > (y[i] || 0)) return true;
    if ((x[i] || 0) < (y[i] || 0)) return false;
  }
  return false;
}
/** Nome deste aviso na regra única de "não ver mais" (./NaoVerMais.tsx). */
const AVISO = "impressao";
const PORTAS_DO_ASSISTENTE = [7899, 7900, 7901, 7891];

type Estado = {
  temImpressora: boolean;
  usaSalao?: boolean;
  ultimoPoll: string | null;
  paradoHaSegundos: number | null;
  versaoAssistente?: string | null;
  pendentes?: number;
  erroImpressao?: string | null;
  impressorasAusentes?: string[];
  impressorasNoPc?: string[];
  estadoEm?: string | null;
};

/** O Assistente que responde NESTE computador (o do navegador aberto). */
type AssistenteLocal = { url: string; versao: string; franchiseeId: string };

async function sondarAssistenteLocal(): Promise<AssistenteLocal | null> {
  for (const porta of PORTAS_DO_ASSISTENTE) {
    try {
      const r = await fetchAssistente(`http://localhost:${porta}/status`, { signal: AbortSignal.timeout(2000) });
      const d = await r.json();
      if (d?.ok) {
        return {
          url: `http://localhost:${porta}`,
          versao: String(d.version || "?"),
          franchiseeId: String(d.config?.franchiseeId || ""),
        };
      }
    } catch {}
  }
  return null;
}

export default function AvisoImpressaoParada() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const meuId: string = (session?.user as any)?.ownerId || (session?.user as any)?.id || "";

  const [estado, setEstado] = useState<Estado | null>(null);
  // undefined = ainda não sondou; null = não há Assistente neste PC.
  const [local, setLocal] = useState<AssistenteLocal | null | undefined>(undefined);
  // A ocorrência que o lojista mandou não ver mais. undefined = o navegador
  // ainda não foi lido (desenhar antes faria a faixa calada piscar).
  const [calada, setCalada] = useState<string | null | undefined>(undefined);
  const [vinculando, setVinculando] = useState(false);
  const [vinculadoEm, setVinculadoEm] = useState(0);
  const vivo = useRef(true);

  const conferir = useCallback(async () => {
    try {
      const r = await fetch("/api/store/print-queue/status", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (vivo.current) setEstado(d);
    } catch {
      // Silêncio de propósito: a faixa é um extra e nunca pode atrapalhar o painel.
    }
  }, []);

  useEffect(() => {
    setCalada(lerNaoVerMais(AVISO));
  }, []);

  useEffect(() => {
    vivo.current = true;
    conferir();
    const t = setInterval(conferir, 2 * 60_000);
    return () => { vivo.current = false; clearInterval(t); };
  }, [conferir]);

  const nuncaConsultou = !!estado && estado.ultimoPoll === null;
  const parado = !!estado && estado.ultimoPoll !== null && (estado.paradoHaSegundos ?? 0) > TOLERANCIA_S;
  const filaMuda = nuncaConsultou || parado;

  // Sonda o Assistente deste PC só quando a fila está muda — é aí que o
  // diagnóstico muda de figura. Uma sondagem por situação: com a fila muda o
  // carimbo não muda, então o efeito não reexecuta a cada conferência.
  // Sonda MESMO sem impressora cadastrada (desde 23/09/2026): o papel do caixa
  // só existe na fila, e a loja que imprime as comandas pelo navegador sem
  // cadastro nenhum ficava sem o fechamento e sem aviso — o Frangoso fechou
  // quatro noites assim. Não abre pergunta nova do Chrome: o printOrder do
  // navegador já sonda o mesmo localhost para imprimir comanda.
  const temEstado = !!estado;
  useEffect(() => {
    if (!temEstado || !filaMuda) { setLocal(undefined); return; }
    let ativo = true;
    sondarAssistenteLocal().then((a) => { if (ativo) setLocal(a); });
    return () => { ativo = false; };
  }, [temEstado, filaMuda, estado?.ultimoPoll]);

  const vincular = async () => {
    if (!local || !meuId || vinculando) return;
    setVinculando(true);
    try {
      // A mesma carga que o botão Salvar de Impressoras manda: identificação
      // da loja, o host do FireHub e a lista de impressoras cadastradas.
      const cfg = await fetch("/api/store/printer-config", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      const printers = printersParaAssistente(Array.isArray(cfg?.printers) ? cfg.printers : []);
      const primeira = printers[0];
      const r = await fetchAssistente(`${local.url}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          franchiseeId: meuId,
          domain: window.location.hostname,
          ...(primeira ? { printer: primeira.name, paperWidth: primeira.paperWidth } : {}),
          printers,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        setVinculadoEm(Date.now());
        // O Assistente consulta a fila em até 3 s e o servidor carimba na
        // hora; a faixa some sozinha na conferência seguinte.
        setTimeout(conferir, 6000);
        setTimeout(conferir, 20000);
      }
    } catch {
      // A faixa continua; o botão pode ser clicado de novo.
    } finally {
      setVinculando(false);
    }
  };

  // ── VÍNCULO AUTOMÁTICO ──────────────────────────────────────────────────
  // Assistente neste PC SEM loja nenhuma: é a instalação que ficou sem o
  // "Salvar" de Impressoras. Vincular à loja deste painel não tem o que
  // decidir — é a loja que está aberta aqui. Vinculado a OUTRA loja, não: pode
  // ser um PC que atende duas casas, e aí quem decide é o botão.
  const tentouAutomatico = useRef(false);
  useEffect(() => {
    if (tentouAutomatico.current || !meuId || !local || local.franchiseeId) return;
    tentouAutomatico.current = true;
    vincular();
    // `vincular` muda a cada render; o ref já garante uma tentativa só.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, meuId]);

  // /store/compras é módulo à parte (o HideOnCompras esconde tudo lá).
  if (pathname?.startsWith("/store/compras")) return null;
  if (!estado) return null;
  if (calada === undefined) return null;
  // Fila muda e a sondagem de localhost ainda correndo: espera, para a faixa
  // não trocar de frase na cara da loja segundos depois de aparecer.
  if (filaMuda && local === undefined) return null;

  const naoVinculado = filaMuda && !!local && local.franchiseeId !== meuId;
  // Sem impressora cadastrada, a faixa só fala do vínculo: os outros avisos
  // (parada, impressora ausente, comanda presa) são de quem imprime pela fila.
  if (!estado.temImpressora && !naoVinculado) return null;
  const vinculadoMasMudo = filaMuda && !!local && local.franchiseeId === meuId;
  const ausentes = estado.impressorasAusentes || [];
  const presas = !filaMuda ? Math.max(0, Number(estado.pendentes) || 0) : 0;
  const acabouDeVincular = vinculadoEm > 0 && Date.now() - vinculadoEm < 60_000;

  // ── Assistente antigo no PC do caixa ────────────────────────────────────
  //
  // Desde a 1.2.7 o Assistente conta a própria versão em cada consulta da
  // fila. Fila respondendo e NENHUMA versão informada só pode ser versão
  // anterior a essa — e é justamente ela que reimprime tudo ao reabrir,
  // porque não confirma no servidor a comanda que saiu.
  //
  // Não é detalhe de manutenção: em 07/09/2026 a Brasa Burguer imprimia as
  // comandas, o Assistente sumia (a atualização automática o fechava), ela
  // abria de novo e as mesmas comandas saíam outra vez. Nada no painel dizia
  // isso — a loja descobriu pela pilha de papel repetido.
  const versaoRelatada = estado.versaoAssistente || null;
  const assistenteAntigo =
    !filaMuda && (!versaoRelatada || versaoMaisNova(VERSAO_ASSISTENTE_ATUAL, versaoRelatada));

  const minutos = Math.floor((estado.paradoHaSegundos ?? 0) / 60);
  const tempo = minutos >= 120 ? `${Math.floor(minutos / 60)} horas` : `${minutos} min`;

  let titulo = "";
  let texto = "";
  let botaoVincular = false;
  // ── A OCORRÊNCIA DE CADA FRASE ──────────────────────────────────────────
  //
  // Esta faixa fala de seis problemas diferentes, e "não ver mais" cala só o
  // que está na tela, na ocorrência em que está. Era um "Dispensar por hoje"
  // que calava TUDO por 24 h: quem dispensava o "Assistente desatualizado"
  // deixava de ver, no mesmo dia, "3 comandas não saíram na impressora".
  let ocorrencia = "";

  if (naoVinculado) {
    botaoVincular = true;
    ocorrencia = "nao-vinculado";
    titulo = `O Assistente de Impressão deste computador (v${local!.versao}) não está vinculado a esta loja`;
    texto = local!.franchiseeId
      ? "Ele está vinculado a outra loja. Se este é o PC do caixa desta loja, vincule agora: as comandas de mesa, balcão, iFood e 99Food e o fechamento de caixa passam a sair por ele mesmo com o painel fechado."
      : "Sem o vínculo ele não consulta a fila da nuvem: o fechamento de caixa não sai, e comanda só sai enquanto este painel estiver aberto e acordado nesta aba. Vincular é um clique.";
  } else if (vinculadoMasMudo && nuncaConsultou) {
    ocorrencia = "vinculado-e-mudo";
    titulo = "O Assistente está vinculado a esta loja, mas a fila da nuvem nunca o viu";
    texto = `Assistente v${local!.versao}: se for anterior à 1.2.1, instale o atual pelo botão Baixar em Impressoras. Se já é o atual, confira se este computador abre firehubfood.com.br.`;
  } else if (parado) {
    // ESTA parada: a última consulta é o que a identifica. Voltou e parou de
    // novo, é outra parada e o aviso reaparece.
    ocorrencia = `parado:${estado.ultimoPoll}`;
    titulo = `A impressão automática parou há ${tempo}`;
    texto = vinculadoMasMudo
      ? "O Assistente está aberto neste PC, mas não está conseguindo falar com o servidor. Confira a internet deste computador."
      : "Comanda de mesa, de balcão, do iFood e do 99Food não vai sair sozinha até ele voltar. Confira se o Assistente de Impressão está aberto no PC do caixa (ícone 🔥 perto do relógio) e se o PC está ligado e com internet. Quando ele voltar, as comandas que faltam saem sozinhas.";
  } else if (nuncaConsultou && estado.usaSalao) {
    ocorrencia = "nunca-consultou";
    titulo = "O Assistente de Impressão desta loja nunca consultou a fila da nuvem";
    texto = "Comanda de mesa, de balcão e a conta da mesa dependem dessa fila. Abra o painel no PC do caixa: esta faixa oferece lá o botão Vincular agora. Se o Assistente for anterior à 1.2.1, instale o atual.";
  } else if (ausentes.length > 0) {
    ocorrencia = `ausentes:${[...ausentes].sort().join("|")}`;
    titulo = ausentes.length === 1
      ? `A impressora "${ausentes[0]}" não existe no PC do caixa`
      : `${ausentes.length} impressoras cadastradas não existem no PC do caixa`;
    const noPc = (estado.impressorasNoPc || []).join(", ");
    texto = `Comanda mandada para "${ausentes[0]}" nunca vai sair. O Windows daquele PC enxerga: ${noPc || "nenhuma impressora"}. Abra Impressoras e escolha a impressora da lista — o Windows pode ter renomeado, ou o PC é outro.`;
  } else if (presas > 0) {
    // Comanda presa não tem identidade que chegue até aqui; o dia serve. Calar
    // de vez esconderia pedido sem papel na semana que vem.
    ocorrencia = `presas:${new Date().toLocaleDateString("sv-SE")}`;
    titulo = presas === 1 ? "1 comanda não saiu na impressora" : `${presas} comandas não saíram na impressora`;
    const erro = traduzErroDeImpressao(estado.erroImpressao);
    texto = `O Assistente tenta de novo em 3 segundos, depois vai espaçando até 2 minutos, e não desiste enquanto não sair. Confira se a impressora está ligada, com papel e sem erro no Windows.${erro ? ` Último erro: ${erro}.` : ""}`;
  } else if (assistenteAntigo) {
    // Calado até sair versão MAIS NOVA que esta.
    ocorrencia = `antigo:${VERSAO_ASSISTENTE_ATUAL}`;
    titulo = versaoRelatada
      ? `O Assistente de Impressão do PC do caixa está desatualizado (v${versaoRelatada})`
      : "O Assistente de Impressão do PC do caixa é de uma versão antiga";
    texto =
      `Nessa versão, toda vez que ele fecha e abre de novo — inclusive quando se atualiza sozinho — as comandas das últimas 2 horas saem OUTRA VEZ. ` +
      `A versão ${VERSAO_ASSISTENTE_ATUAL} confirma no servidor cada comanda que já saiu, então nada se repete. ` +
      `Baixe em Impressoras e instale por cima, no PC do caixa: a configuração e as impressoras continuam como estão.`;
  } else {
    return null;
  }

  if (calada === ocorrencia) return null;

  const naoVerMais = () => setCalada(gravarNaoVerMais(AVISO, ocorrencia));

  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: "0.9rem", flexWrap: "wrap",
        background: "#FFF4EF", border: "1px solid #FFD3C2", borderLeft: "6px solid #E8590C",
        borderRadius: 12, padding: "0.9rem 1.1rem", margin: "0 0 1rem",
      }}
    >
      <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>🖨️</span>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: "#9A3412", fontSize: "0.95rem" }}>{titulo}</div>
        <div style={{ color: "#9A3412", fontSize: "0.85rem", lineHeight: 1.5 }}>
          {acabouDeVincular ? "Vinculado. Conferindo a fila da nuvem… esta faixa some sozinha em instantes." : texto}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {botaoVincular && !acabouDeVincular && (
          <button
            type="button"
            onClick={vincular}
            disabled={vinculando}
            style={{
              background: "#E8590C", color: "#fff", border: "none", borderRadius: 10,
              padding: "10px 18px", fontWeight: 800, fontSize: "0.85rem", whiteSpace: "nowrap",
              cursor: vinculando ? "wait" : "pointer", fontFamily: "inherit", opacity: vinculando ? 0.7 : 1,
            }}
          >
            {vinculando ? "Vinculando…" : "Vincular agora"}
          </button>
        )}
        <a
          href="/store/impressoras"
          style={{
            background: botaoVincular ? "none" : "#E8590C",
            color: botaoVincular ? "#9A3412" : "#fff",
            border: botaoVincular ? "1px solid #FFD3C2" : "none",
            textDecoration: "none", borderRadius: 10,
            padding: "10px 18px", fontWeight: 800, fontSize: "0.85rem", whiteSpace: "nowrap",
          }}
        >
          Abrir Impressoras →
        </a>
        <BotaoNaoVerMais onClick={naoVerMais} cor="#9A3412" borda="#FFD3C2" />
      </div>
    </div>
  );
}
