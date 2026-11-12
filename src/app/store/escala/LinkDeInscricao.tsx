"use client";

/**
 * Aba Link de inscrição: o endereço público (/escala/<código>) que a loja
 * manda no grupo do WhatsApp, o QR para colar na parede, a mensagem pronta e
 * as regras do link (prazo para se inscrever, desistência, funções que
 * aparecem). "Gerar link novo" mata o antigo — para link que vazou.
 */

import { useEffect, useState } from "react";
import { FUNCOES, chaveDaFuncao, prazoFalado } from "@/lib/escala-da-equipe/regras";
import { COR, COR_CLARA, S, copiar, pedir, type Aviso, type Confirmacao, type ConfigDoLink } from "./ui";

export function enderecoDoLink(codigo: string): string {
  return typeof window === "undefined" ? `/escala/${codigo}` : `${window.location.origin}/escala/${codigo}`;
}

export function useQrDoLink(link: string, largura = 260): string | null {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    import("qrcode")
      .then((m) => m.toDataURL(link, { margin: 1, width: largura, errorCorrectionLevel: "M" }))
      .then((url) => { if (vivo) setQr(url); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [link, largura]);
  return qr;
}

export default function LinkDeInscricao({ config, nomeDaLoja, funcoesUsadas, onSalvo, avisar, confirmar, onImprimirCartaz }: {
  config: ConfigDoLink; nomeDaLoja: string; funcoesUsadas: string[];
  onSalvo: (c: ConfigDoLink) => void; avisar: (a: Aviso) => void; confirmar: (c: Confirmacao) => void; onImprimirCartaz: () => void;
}) {
  const link = enderecoDoLink(config.codigo);
  const qr = useQrDoLink(link);
  const [c, setC] = useState(config);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setC(config), [config]);

  const mensagem = `📅 *Escala da ${nomeDaLoja}*\nAs vagas da semana estão abertas! Escolha o seu turno pelo link:\n${link}\n\nÉ só entrar com o seu WhatsApp. Vagas limitadas — quem se inscreve primeiro garante.`;
  // A lista das funções para marcar: as fixas + as que a loja já usou nos turnos.
  const funcoes = [...FUNCOES as readonly string[]];
  for (const f of funcoesUsadas) if (!funcoes.some((x) => chaveDaFuncao(x) === chaveDaFuncao(f))) funcoes.push(f);
  const todas = c.funcoesNoLink.length === 0;
  const marcada = (f: string) => todas || c.funcoesNoLink.some((x) => chaveDaFuncao(x) === chaveDaFuncao(f));
  const alternar = (f: string) => {
    const atuais = todas ? funcoes : c.funcoesNoLink;
    const nova = marcada(f) ? atuais.filter((x) => chaveDaFuncao(x) !== chaveDaFuncao(f)) : [...atuais, f];
    // Lista vazia quer dizer "todas" no banco — desmarcar a última não pode virar "todas".
    if (nova.length === 0) return avisar({ tipo: "atencao", titulo: "Deixe pelo menos uma função no link." });
    // Marcar todas de novo = "todas" (vazio), para função nova entrar sozinha.
    setC({ ...c, funcoesNoLink: nova.length >= funcoes.length ? [] : nova });
  };
  const mudou = JSON.stringify(c) !== JSON.stringify(config);

  async function salvar() {
    setSalvando(true);
    try {
      const r = await pedir<{ config: ConfigDoLink }>("/api/store/escala/config", "PUT", c);
      onSalvo(r.config);
      avisar({ tipo: "ok", titulo: "Regras do link salvas" });
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não deu para salvar", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  function gerarNovo() {
    confirmar({
      titulo: "Gerar link novo?",
      texto: "O link de agora para de funcionar na hora — quem abrir o antigo vai ver \"link não existe mais\".\nAs inscrições já feitas continuam. Depois mande o link novo no grupo.",
      botao: "Gerar link novo",
      perigo: true,
      acao: async () => {
        try {
          const r = await pedir<{ config: ConfigDoLink }>("/api/store/escala/config", "POST");
          onSalvo(r.config);
          avisar({ tipo: "ok", titulo: "Link novo gerado", detalhe: "O antigo não funciona mais." });
        } catch (e: any) {
          avisar({ tipo: "erro", titulo: "Não deu para gerar", detalhe: e.message });
        }
      },
    });
  }

  const copiarTexto = async (t: string, oQue: string) => avisar(await copiar(t) ? { tipo: "ok", titulo: `${oQue} copiado` } : { tipo: "atencao", titulo: "Não deu para copiar", detalhe: "Selecione o texto e copie à mão." });

  return (
    <div className="esc-link">
      <div style={{ ...S.cartao, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <h2 style={S.h2}>O link da escala</h2>
          <p style={{ ...S.texto, marginTop: 4 }}>Mande no grupo do WhatsApp da equipe. Cada um entra com o próprio WhatsApp, vê as vagas e escolhe o turno — sem baixar app e sem login.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ ...S.campo, flex: "1 1 240px", fontSize: 14, background: "#F8FAFC" }} />
            <button type="button" style={S.botao} onClick={() => copiarTexto(link, "Link")}>Copiar link</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <a href={link} target="_blank" rel="noreferrer" style={{ ...S.botaoPequeno, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Abrir o link ↗</a>
            <a href={`https://wa.me/?text=${encodeURIComponent(mensagem.replace(/\*/g, ""))}`} target="_blank" rel="noreferrer" style={{ ...S.botaoPequeno, display: "inline-flex", alignItems: "center", textDecoration: "none", color: "#15803D", borderColor: "#BBF7D0" }}>Mandar no WhatsApp</a>
            <button type="button" style={S.botaoPequeno} onClick={onImprimirCartaz}>🖨️ Imprimir cartaz com QR</button>
            <button type="button" style={{ ...S.botaoPequeno, color: "#DC2626", borderColor: "#FECACA" }} onClick={gerarNovo}>Gerar link novo</button>
          </div>
          {!config.linkAtivo && <div style={{ marginTop: 10, fontSize: 13, fontWeight: 800, color: "#B45309" }}>⏸️ Inscrições pelo link estão PAUSADAS — quem abrir vê "inscrições fechadas".</div>}
        </div>
        <div style={{ textAlign: "center" }}>
          {qr ? <img src={qr} alt="QR do link da escala" width={180} height={180} style={{ borderRadius: 10, border: "1px solid #E2E8F0" }} /> : <div style={{ width: 180, height: 180, background: "#F1F5F9", borderRadius: 10 }} />}
          <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>Aponte a câmera</div>
        </div>
      </div>

      <div style={{ ...S.cartao, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ ...S.h2, flex: 1 }}>Mensagem pronta para o grupo</h2>
          <button type="button" style={S.botaoPequeno} onClick={() => copiarTexto(mensagem, "Mensagem")}>Copiar</button>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, color: "#334155", background: "#F8FAFC", borderRadius: 10, padding: "10px 12px", margin: "8px 0 0" }}>{mensagem}</pre>
      </div>

      <div style={{ ...S.cartao, marginTop: 12 }}>
        <h2 style={S.h2}>Regras do link</h2>
        <div className="esc-form" style={{ marginTop: 12 }}>
          <label style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={c.linkAtivo} onChange={(e) => setC({ ...c, linkAtivo: e.target.checked })} /> Inscrições pelo link abertas
          </label>
          <label>
            <span style={S.rotulo}>Inscrição fecha quantas horas antes do turno?</span>
            <input inputMode="numeric" value={c.prazoInscricaoHoras} onChange={(e) => setC({ ...c, prazoInscricaoHoras: Math.min(168, Number(e.target.value.replace(/\D/g, "")) || 0) })} style={S.campo} />
            <span style={{ fontSize: 12, color: "#64748B" }}>Hoje: {prazoFalado(c.prazoInscricaoHoras)}. 0 = até a hora de começar.</span>
          </label>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13.5, cursor: "pointer", marginBottom: 6 }}>
              <input type="checkbox" checked={c.permiteDesistir} onChange={(e) => setC({ ...c, permiteDesistir: e.target.checked })} /> Pode desistir pelo link
            </label>
            {c.permiteDesistir ? (
              <>
                <input inputMode="numeric" aria-label="Horas antes para desistir" value={c.prazoDesistenciaHoras} onChange={(e) => setC({ ...c, prazoDesistenciaHoras: Math.min(168, Number(e.target.value.replace(/\D/g, "")) || 0) })} style={S.campo} />
                <span style={{ fontSize: 12, color: "#64748B" }}>Desistência {prazoFalado(c.prazoDesistenciaHoras)}. Depois, só falando com a loja.</span>
              </>
            ) : <span style={{ fontSize: 12, color: "#64748B" }}>Quem se inscreveu e não puder ir tem de falar com a loja.</span>}
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <span style={S.rotulo}>Funções que aparecem no link {todas && <span style={{ fontWeight: 600, color: "#64748B" }}>(todas)</span>}</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {funcoes.map((f) => {
                const on = marcada(f);
                return <button key={f} type="button" onClick={() => alternar(f)} style={{ ...S.botaoPequeno, borderColor: on ? COR : "#CBD5E1", background: on ? COR_CLARA : "#fff", color: on ? COR : "#94A3B8" }}>{on ? "✓ " : ""}{f}</button>;
              })}
            </div>
            <span style={{ fontSize: 12, color: "#64748B" }}>Ex.: só Motoboy no link do grupo dos motoboys — os outros turnos você encaixa pelo painel.</span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" style={{ ...S.botao, opacity: mudou ? 1 : 0.5 }} disabled={!mudou || salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar regras"}</button>
        </div>
      </div>
    </div>
  );
}
