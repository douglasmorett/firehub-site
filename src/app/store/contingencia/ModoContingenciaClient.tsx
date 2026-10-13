"use client";

/**
 * A tela do Modo Contingência (app/store/contingencia/page.tsx).
 *
 * Conversa com DOIS lados:
 *   - a nuvem (/api/contingencia/estado, /ativar): se a loja ativou, o último
 *     relato do computador, as quedas e os conflitos;
 *   - o Assistente DESTE computador (127.0.0.1:7899, lib/print.ts →
 *     fetchAssistente): ativar só faz sentido no computador do caixa, que é
 *     onde a contingência roda.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { fetchAssistente } from "@/lib/print";

const PORTAS_DO_ASSISTENTE = [7899, 7900, 7901, 7891];

type EstadoDaNuvem = {
  ativada: boolean;
  dono: boolean;
  slug?: string | null;
  ativadaEm?: string;
  ativadaPor?: string | null;
  ultimoContato?: string | null;
  relato?: {
    modo?: string;
    copiaEm?: string | null;
    pendentes?: number;
    versao?: string;
    ips?: string[];
    porta?: number;
    ultimoErro?: string | null;
  } | null;
  episodios?: { id: string; inicio: string | null; fim: string | null; subiuEm: string; linhas: number; pedidos: number; conflitos: number }[];
  conflitos?: { tabela: string; coluna: string | null; decisao: string; em: string }[];
};

type EstadoDoAssistente =
  | { achado: false }
  | { achado: true; porta: number; versao?: string; contingencia: null | { ativa: boolean; pronta?: boolean; modo?: string; etapa?: string; progresso?: number; erro?: string | null } };

const cor = { borda: "#E2E8F0", texto: "#0F172A", suave: "#64748B", fundo: "#F8FAFC", marca: "#C92E09" };

function Cartao({ titulo, children, destaque }: { titulo?: string; children: React.ReactNode; destaque?: boolean }) {
  return (
    <section
      style={{
        background: "#fff", border: `1.5px solid ${destaque ? cor.marca : cor.borda}`, borderRadius: 16,
        padding: "18px 20px", marginBottom: 14,
      }}
    >
      {titulo && <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 10px", color: cor.texto }}>{titulo}</h2>}
      {children}
    </section>
  );
}

function haQuanto(iso?: string | null): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return `há ${Math.round(s / 3600)} h`;
}

function dataHora(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function acharAssistente(): Promise<EstadoDoAssistente> {
  for (const porta of PORTAS_DO_ASSISTENTE) {
    try {
      const r = await fetchAssistente(`http://127.0.0.1:${porta}/status`, { cache: "no-store" });
      if (!r.ok) continue;
      const status = await r.json().catch(() => ({}));
      let contingencia: any = null;
      try {
        const c = await fetchAssistente(`http://127.0.0.1:${porta}/contingencia/estado`, { cache: "no-store" });
        if (c.ok) contingencia = await c.json();
      } catch {
        /* Assistente antigo: não conhece a contingência */
      }
      return { achado: true, porta, versao: status?.versao || status?.version, contingencia };
    } catch {
      /* próxima porta */
    }
  }
  return { achado: false };
}

export default function ModoContingenciaClient() {
  const [nuvem, setNuvem] = useState<EstadoDaNuvem | null>(null);
  const [assistente, setAssistente] = useState<EstadoDoAssistente | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [qr, setQr] = useState("");

  const atualizar = useCallback(async () => {
    const r = await fetch("/api/contingencia/estado", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setNuvem(await r.json());
    setAssistente(await acharAssistente());
  }, []);

  useEffect(() => {
    atualizar();
    const t = setInterval(atualizar, 5000);
    return () => clearInterval(t);
  }, [atualizar]);

  const enderecos = useMemo(() => {
    const ips = nuvem?.relato?.ips || [];
    const porta = nuvem?.relato?.porta || 7890;
    return ips.map((ip) => `http://${ip}:${porta}`);
  }, [nuvem]);

  useEffect(() => {
    // O QR leva ao app do garçom PELO computador da loja: com internet, a
    // porta da loja manda para a nuvem; sem, atende ela mesma. Assim o
    // celular aprende o endereço da loja já no primeiro uso.
    if (!enderecos[0] || !nuvem?.slug) return setQr("");
    QRCode.toDataURL(`${enderecos[0]}/garcom/${nuvem.slug}`, { margin: 1, width: 180 }).then(setQr).catch(() => setQr(""));
  }, [enderecos, nuvem?.slug]);

  const contingenciaAqui = assistente?.achado ? assistente.contingencia : null;
  const assistenteSemContingencia = assistente?.achado && !contingenciaAqui;
  const podeMexer = !!nuvem?.dono;

  async function ativar() {
    if (!assistente?.achado) return;
    setOcupado("ativar");
    setMensagem("");
    try {
      const r = await fetch("/api/contingencia/ativar", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Não foi possível ativar.");
      const p = await fetchAssistente(`http://127.0.0.1:${assistente.porta}/contingencia/parear`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lojaId: d.lojaId, chave: d.chave, segredoDoBilhete: d.segredoDoBilhete, nuvem: d.nuvem }),
      });
      if (!p.ok) throw new Error((await p.json().catch(() => ({})))?.error || "O Assistente não aceitou a ativação.");
      setMensagem("✅ Ativado neste computador. O Assistente está baixando o FireHub e preparando a cópia — acompanhe abaixo.");
      await atualizar();
    } catch (e: any) {
      setMensagem(`⚠️ ${e?.message || "Não foi possível ativar."}`);
    } finally {
      setOcupado("");
    }
  }

  async function desativar() {
    if (!confirm("Desativar o Modo Contingência? Se a internet cair, a loja volta a parar como antes.")) return;
    setOcupado("desativar");
    try {
      await fetch("/api/contingencia/ativar", { method: "DELETE" });
      if (assistente?.achado) {
        await fetchAssistente(`http://127.0.0.1:${assistente.porta}/contingencia/desparear`, { method: "POST" }).catch(() => null);
      }
      setMensagem("Modo Contingência desativado.");
      await atualizar();
    } finally {
      setOcupado("");
    }
  }

  async function testar() {
    if (!assistente?.achado) return;
    setOcupado("testar");
    setMensagem("");
    try {
      const r = await fetchAssistente(`http://127.0.0.1:${assistente.porta}/contingencia/testar`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "O teste não começou.");
      setMensagem("🧪 Teste começou: por 2 minutos este computador age como se a internet tivesse caído. Em uns 15 segundos as telas abertas NESTE computador vão para o computador da loja, com a faixa de aviso. Para ver na TV, abra nela o endereço /tv do quadro abaixo durante o teste. Lance um pedido de teste, se quiser — ele sobe sozinho no fim.");
    } catch (e: any) {
      setMensagem(`⚠️ ${e?.message}`);
    } finally {
      setOcupado("");
    }
  }

  const relato = nuvem?.relato;
  const online = nuvem?.ultimoContato && Date.now() - new Date(nuvem.ultimoContato).getTime() < 90_000;

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "20px 16px 60px", color: cor.texto, fontFamily: "inherit" }}>
      <header style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>🛟 Modo Contingência</h1>
          <span style={{ background: cor.marca, color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "3px 10px" }}>NOVO</span>
        </div>
        <p style={{ color: cor.suave, fontSize: 15, margin: "8px 0 0", lineHeight: 1.5 }}>
          Se a internet da sua loja ou o FireHub cair, <strong>sua loja continua funcionando no seu computador</strong> — as mesmas
          telas, a mesma impressão. Quando a conexão volta, tudo sobe sozinho.
        </p>
      </header>

      {mensagem && (
        <div style={{ background: "#FFF7ED", border: "1.5px solid #FDBA74", borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 14, lineHeight: 1.45 }}>
          {mensagem}
        </div>
      )}

      <Cartao titulo="Como funciona">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
          <li><strong>Com internet:</strong> tudo como hoje. O computador do caixa guarda uma cópia atualizada da loja (cardápio, mesas, pedidos, caixa).</li>
          <li><strong>Caiu:</strong> em uns 15 segundos as telas passam a usar o computador da loja, com um aviso discreto. Lança pedido, abre e fecha mesa, imprime — tudo igual.</li>
          <li><strong>Voltou:</strong> o computador manda tudo para a nuvem sozinho, sem duplicar, e as telas voltam para a nuvem.</li>
        </ol>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: cor.suave }}>
          É <strong>opcional</strong>: para quem quer mais estrutura. Sem ativar, nada muda.
        </p>
      </Cartao>

      <Cartao titulo="O que você precisa">
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
          <li>Um <strong>computador Windows no caixa</strong>, ligado durante o expediente (4 GB de memória ou mais e 1 GB livre no disco).</li>
          <li>O <strong>Assistente de Impressão</strong> do FireHub instalado e atualizado nesse computador.</li>
          <li><strong>Endereço fixo do computador no roteador</strong> (reserva de IP) — se precisar, a gente faz por acesso remoto.</li>
          <li>A <strong>TV da cozinha e os celulares dos garçons no Wi-Fi da loja</strong> (no 4G do garçom não alcança o computador).</li>
          <li>Na primeira vez, o Windows pergunta se libera o FireHub na rede: clique em <strong>Permitir</strong>.</li>
        </ul>
      </Cartao>

      <Cartao titulo={nuvem?.ativada ? "Situação agora" : "Ativar neste computador"} destaque>
        {!nuvem ? (
          <p style={{ margin: 0, color: cor.suave }}>Carregando…</p>
        ) : !nuvem.ativada ? (
          <>
            {assistente === null ? (
              <p style={{ margin: 0, color: cor.suave }}>Procurando o Assistente neste computador…</p>
            ) : !assistente.achado ? (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                Abra esta tela <strong>no computador do caixa</strong>, onde o Assistente de Impressão está instalado.
                Ainda não tem? <a href="/store/impressoras" style={{ color: cor.marca, fontWeight: 700 }}>Baixe o Assistente em Impressoras</a>.
              </p>
            ) : assistenteSemContingencia ? (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                O Assistente deste computador é de uma versão antiga. Atualize pela bandeja do Windows (ícone do FireHub → <em>Procurar atualização agora</em>) e volte aqui.
              </p>
            ) : (
              <>
                <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5 }}>
                  Assistente encontrado neste computador. Ao ativar, ele baixa o FireHub (uns 250 MB na primeira vez; depois, só o que mudar) e faz a primeira cópia da loja.
                </p>
                <button
                  disabled={!podeMexer || !!ocupado}
                  onClick={ativar}
                  style={{ background: cor.marca, color: "#fff", border: 0, borderRadius: 12, padding: "12px 18px", fontWeight: 800, fontSize: 15, cursor: "pointer", opacity: !podeMexer || ocupado ? 0.6 : 1 }}
                >
                  {ocupado === "ativar" ? "Ativando…" : "🛟 Ativar neste computador"}
                </button>
                {!podeMexer && <p style={{ margin: "8px 0 0", fontSize: 12, color: cor.suave }}>Só o dono da loja ativa.</p>}
              </>
            )}
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 14 }}>
              <div style={{ background: cor.fundo, borderRadius: 12, padding: 12 }}>
                <div style={{ color: cor.suave, fontSize: 12 }}>Computador da loja</div>
                <div style={{ fontWeight: 800 }}>{online ? "🟢 Conectado" : "🔴 Sem contato"}</div>
                <div style={{ color: cor.suave, fontSize: 12 }}>último contato {haQuanto(nuvem.ultimoContato)}</div>
              </div>
              <div style={{ background: cor.fundo, borderRadius: 12, padding: 12 }}>
                <div style={{ color: cor.suave, fontSize: 12 }}>Cópia da loja</div>
                <div style={{ fontWeight: 800 }}>{relato?.copiaEm ? `atualizada ${haQuanto(relato.copiaEm)}` : "preparando…"}</div>
                <div style={{ color: cor.suave, fontSize: 12 }}>{relato?.pendentes ? `${relato.pendentes} mudança(s) para subir` : "nada esperando para subir"}</div>
              </div>
              <div style={{ background: cor.fundo, borderRadius: 12, padding: 12 }}>
                <div style={{ color: cor.suave, fontSize: 12 }}>Modo</div>
                <div style={{ fontWeight: 800 }}>
                  {relato?.modo === "contingencia" ? "🛟 Em contingência" : relato?.modo === "voltando" ? "⬆️ Subindo" : relato?.modo === "normal" ? "✅ Normal" : relato?.modo || "—"}
                </div>
                <div style={{ color: cor.suave, fontSize: 12 }}>versão {relato?.versao || "—"}</div>
              </div>
            </div>
            {contingenciaAqui?.ativa && contingenciaAqui.etapa && contingenciaAqui.etapa !== "pronta" && (
              <p style={{ margin: "10px 0 0", fontSize: 13 }}>
                Neste computador: {contingenciaAqui.etapa}
                {typeof contingenciaAqui.progresso === "number" ? ` (${Math.round(contingenciaAqui.progresso)}%)` : ""}
                {contingenciaAqui.erro ? ` — ${contingenciaAqui.erro}` : ""}
              </p>
            )}
            {podeMexer && contingenciaAqui && !contingenciaAqui.ativa && (
              // Troca de computador (PC novo no caixa, Windows formatado): a
              // chave nova vale só para este; o anterior para de receber a cópia.
              <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: cor.fundo, fontSize: 14, lineHeight: 1.5 }}>
                A contingência está ativada em <strong>outro computador</strong>. Para usar este no lugar dele, ative aqui — o outro deixa de receber a cópia.
                {relato?.pendentes ? (
                  <div style={{ marginTop: 6, color: "#B91C1C" }}>
                    O computador atual ainda tem {relato.pendentes} mudança(s) para subir. Espere subir antes de trocar.
                  </div>
                ) : null}
                <div style={{ marginTop: 10 }}>
                  <button
                    disabled={!!ocupado || !!relato?.pendentes}
                    onClick={ativar}
                    style={{ background: cor.marca, color: "#fff", border: 0, borderRadius: 12, padding: "10px 16px", fontWeight: 800, cursor: "pointer", opacity: ocupado || relato?.pendentes ? 0.6 : 1 }}
                  >
                    {ocupado === "ativar" ? "Ativando…" : "🛟 Ativar neste computador"}
                  </button>
                </div>
              </div>
            )}
            {relato?.ultimoErro && <p style={{ margin: "10px 0 0", fontSize: 13, color: "#B91C1C" }}>Último problema: {relato.ultimoErro}</p>}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button
                disabled={!assistente?.achado || !contingenciaAqui?.ativa || !!ocupado}
                onClick={testar}
                title={!contingenciaAqui?.ativa ? "Abra esta tela no computador do caixa para testar." : ""}
                style={{ background: "#0F172A", color: "#fff", border: 0, borderRadius: 12, padding: "10px 16px", fontWeight: 800, cursor: "pointer", opacity: !contingenciaAqui?.ativa || ocupado ? 0.5 : 1 }}
              >
                {ocupado === "testar" ? "Começando…" : "🧪 Testar agora (2 min)"}
              </button>
              {podeMexer && (
                <button
                  disabled={!!ocupado}
                  onClick={desativar}
                  style={{ background: "#fff", color: "#B91C1C", border: "1.5px solid #FCA5A5", borderRadius: 12, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}
                >
                  Desativar
                </button>
              )}
            </div>
          </>
        )}
      </Cartao>

      {nuvem?.ativada && (
        <Cartao titulo="TV da cozinha e celular do garçom">
          <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 }}>
            Com internet, eles continuam usando o FireHub de sempre. Se cair, <strong>trocam sozinhos</strong> para o computador da loja —
            a TV que já deixa o KDS aberto não precisa de nada.
          </p>
          {enderecos.length ? (
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              {qr && <img src={qr} alt="QR do garçom" width={150} height={150} style={{ borderRadius: 12, border: `1px solid ${cor.borda}` }} />}
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                <div>Na TV da cozinha (só se ela for ligada já sem internet e nunca tiver aberto o FireHub), digite uma vez e salve nos favoritos:</div>
                {enderecos.map((e) => (
                  <div key={e} style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 800 }}>{e}/tv</div>
                ))}
                <div style={{ color: cor.suave, fontSize: 13 }}>Garçom: aponte a câmera do celular para o QR.</div>
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, color: cor.suave, fontSize: 14 }}>O endereço aparece aqui assim que o computador da loja se conectar.</p>
          )}
        </Cartao>
      )}

      <Cartao titulo="O que para durante a queda">
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
          <li><strong>iFood:</strong> pausado sozinho e reaberto na volta. <strong>99Food, Keeta e Wabiz:</strong> sem pausa automática; os pedidos ficam como Novo, sem aceite automático.</li>
          <li><strong>Cardápio online e robô do WhatsApp:</strong> mostram "estamos com instabilidade, volte em alguns minutos".</li>
          <li><strong>Pix automático, cashback e cupom:</strong> só quando a conexão voltar.</li>
          <li><strong>Nota fiscal:</strong> os pedidos da queda ficam para emitir na volta.</li>
          <li><strong>App do motoboy e mapa:</strong> o motoboy sai com a comanda impressa.</li>
        </ul>
      </Cartao>

      {nuvem?.ativada && (nuvem.episodios?.length || 0) > 0 && (
        <Cartao titulo="Últimas quedas">
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: cor.suave }}>
                <th style={{ padding: "4px 6px" }}>Começou</th><th style={{ padding: "4px 6px" }}>Voltou</th>
                <th style={{ padding: "4px 6px" }}>Pedidos</th><th style={{ padding: "4px 6px" }}>Mudanças</th><th style={{ padding: "4px 6px" }}>Conflitos</th>
              </tr>
            </thead>
            <tbody>
              {nuvem.episodios!.map((e) => (
                <tr key={e.id} style={{ borderTop: `1px solid ${cor.borda}` }}>
                  <td style={{ padding: "6px" }}>{dataHora(e.inicio)}</td><td style={{ padding: "6px" }}>{dataHora(e.fim)}</td>
                  <td style={{ padding: "6px" }}>{e.pedidos}</td><td style={{ padding: "6px" }}>{e.linhas}</td><td style={{ padding: "6px" }}>{e.conflitos}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(nuvem.conflitos?.length || 0) > 0 && (
            <details style={{ marginTop: 10, fontSize: 13 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>Conflitos dos últimos 7 dias ({nuvem.conflitos!.length})</summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                {nuvem.conflitos!.map((c, i) => (
                  <li key={i}>{dataHora(c.em)} — {c.tabela}{c.coluna ? ` · ${c.coluna}` : ""}: {c.decisao}</li>
                ))}
              </ul>
            </details>
          )}
        </Cartao>
      )}

      <Cartao titulo="🎬 Vídeo explicativo">
        <p style={{ margin: 0, color: cor.suave, fontSize: 14 }}>Em breve: o passo a passo em vídeo, da instalação ao teste.</p>
      </Cartao>
    </div>
  );
}
