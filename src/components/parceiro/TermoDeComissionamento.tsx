"use client";

/**
 * O termo de comissionamento antes do portal: quem não aceitou a versão vigente
 * vê o texto (lib/parceiro/termo-de-comissionamento.ts) e só entra nas abas
 * depois de aceitar. O aceite vai para /api/vendedor/termo (versão, data, IP,
 * navegador). O pagamento das comissões não depende do aceite.
 */
import { useState } from "react";
import { FileSignature, LogOut } from "lucide-react";
import SairDaConta from "@/components/SairDaConta";
import {
  CLAUSULAS_DO_TERMO_DE_COMISSIONAMENTO, TITULO_DO_TERMO_DE_COMISSIONAMENTO, VERSAO_DO_TERMO_DE_COMISSIONAMENTO,
} from "@/lib/parceiro/termo-de-comissionamento";

export default function TermoDeComissionamento({ nome, envio = "/api/vendedor/termo", saida = "/vendedor", depois }: { nome: string; envio?: string; saida?: string; depois?: string }) {
  const [li, setLi] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const aceitar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(envio, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aceito: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { setErro(d.error || "Não deu para registrar o aceite. Tente de novo."); return; }
      if (depois) window.location.href = depois;
      else window.location.reload();
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="tc">
      <style>{ESTILO}</style>
      <header className="tc-topo">
        <img src="/firehub-flame.png" alt="" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong>Portal do parceiro</strong>
          <span>{nome}</span>
        </div>
        <SairDaConta callbackUrl={saida} className="tc-sair"><LogOut size={15} aria-hidden /> Sair</SairDaConta>
      </header>
      <main className="tc-caixa">
        {erro && <div className="tc-erro" role="alert">{erro}</div>}
        <div className="tc-cab">
          <span className="tc-icone"><FileSignature size={20} aria-hidden /></span>
          <div>
            <h1>{TITULO_DO_TERMO_DE_COMISSIONAMENTO}</h1>
            <p>Leia antes de entrar no portal. Versão {VERSAO_DO_TERMO_DE_COMISSIONAMENTO}.</p>
          </div>
        </div>
        <ol className="tc-clausulas">
          {CLAUSULAS_DO_TERMO_DE_COMISSIONAMENTO.map((c, i) => <li key={i}>{c}</li>)}
        </ol>
        <label className="tc-check">
          <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} />
          <span>Li e concordo com o termo de comissionamento.</span>
        </label>
        <button type="button" className="tc-botao" disabled={!li || enviando} onClick={aceitar}>{enviando ? "Registrando…" : "Aceitar e entrar no portal"}</button>
        <p className="tc-nota">Guardamos a data, o IP e o navegador deste aceite.</p>
      </main>
    </div>
  );
}

const ESTILO = `
.tc { min-height: 100vh; background: #F3EEE5; font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif; color: #1C1917; font-size: 14px; line-height: 1.5; }
.tc * { box-sizing: border-box; }
.tc-topo { background: #1C1917; color: #FAFAF9; display: flex; align-items: center; gap: 10px; padding: 12px 16px; }
.tc-topo img { width: 30px; height: 30px; border-radius: 7px; }
.tc-topo strong { display: block; font-size: 0.95rem; }
.tc-topo span { display: block; font-size: 0.74rem; color: #A8A29E; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tc-sair { background: #2A2622; color: #FAFAF9 !important; border: 1px solid #3A3531; border-radius: 8px; padding: 7px 12px; font-weight: 700; font-size: 0.8rem; display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
.tc-caixa { max-width: 720px; margin: 24px auto 48px; background: #FFFDF9; border: 1px solid #E7DDCD; border-radius: 18px; padding: 22px 24px; box-shadow: 0 10px 28px -16px rgba(28,25,23,.25); }
.tc-cab { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
.tc-icone { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: #FBE3DA; color: #C92E09; flex-shrink: 0; }
.tc-cab h1 { font-size: 1.15rem; margin: 0; letter-spacing: -0.01em; }
.tc-cab p { margin: 2px 0 0; color: #6F675E; font-size: 0.82rem; }
.tc-clausulas { margin: 0 0 16px; padding-left: 22px; display: flex; flex-direction: column; gap: 10px; color: #2B2724; }
.tc-clausulas li::marker { font-weight: 800; color: #C92E09; }
.tc-check { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; background: #F9F4EC; border: 1px solid #E7DDCD; cursor: pointer; font-weight: 600; }
.tc-check input { width: 18px; height: 18px; margin-top: 2px; accent-color: #E8360C; }
.tc-botao { margin-top: 12px; width: 100%; border: none; border-radius: 12px; padding: 13px 16px; font: inherit; font-weight: 800; font-size: 0.95rem; color: #fff; background: #E8360C; cursor: pointer; }
.tc-botao:disabled { opacity: .5; cursor: default; }
.tc-botao:not(:disabled):hover { background: #C92E09; }
.tc-nota { margin: 8px 0 0; color: #6F675E; font-size: 0.76rem; text-align: center; }
.tc-erro { margin-bottom: 12px; padding: 10px 12px; border-radius: 10px; background: #FCE8E6; color: #7F1D1D; border: 1px solid #F3C4BF; font-weight: 600; }
@media (max-width: 640px) { .tc-caixa { margin: 12px; padding: 16px; } }
`;
