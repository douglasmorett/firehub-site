"use client";

/**
 * "Vimos que você também é vendedor — quer abrir a sua loja ou o seu painel de
 * vendedor?" A pergunta do /login para quem é lojista E parceiro, nas palavras
 * do Douglas (30/09/2026). Aparece logo depois de entrar e também quando a
 * pessoa volta ao /login já logada — que é onde cai a aba da loja depois de a
 * outra aba trocar para o portal.
 */
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Painel, PaineisDaSessao } from "@/lib/paineis-do-dono";
import { comoChamar, trocarDePainel } from "./TrocarDePainel";

export default function EscolhaDePainel({
  paineis,
  aoEntrarComOutraConta,
}: {
  paineis: PaineisDaSessao;
  aoEntrarComOutraConta: () => void;
}) {
  const [abrindo, setAbrindo] = useState<Painel | null>(null);
  const [pedindoSenha, setPedindoSenha] = useState<Painel | null>(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");

  const vendedor = paineis.parceiro?.vendedor;

  const abrir = async (painel: Painel, comSenha?: string) => {
    const provado = painel === "loja" ? paineis.loja?.provado : paineis.parceiro?.provado;
    const { destino } = comoChamar(paineis, painel);
    setErro("");
    if (painel === paineis.ativo) {
      setAbrindo(painel);
      window.location.href = destino;
      return;
    }
    if (!provado && !comSenha) {
      setPedindoSenha(painel);
      return;
    }
    setAbrindo(painel);
    const r = await trocarDePainel(painel, comSenha);
    if (r.ok) {
      window.location.href = destino;
      return;
    }
    setAbrindo(null);
    setPedindoSenha(painel);
    if (comSenha) setErro(r.erro || "Senha incorreta.");
  };

  const opcoes: Painel[] = ["loja", "parceiro"];

  return (
    <div className="ep">
      <style>{ESTILO_DA_ESCOLHA}</style>
      {/* Sem "Olá, <nome>": o nome da conta da loja costuma ser o da loja ou
          o do cadastro antigo, e "Olá, Pizzaria!" é pior do que nenhum. */}
      <h1 className="ep-titulo">Vimos que você também é {vendedor ? "vendedor" : "embaixador"}.</h1>
      <p className="ep-sub">Quer abrir a sua loja ou o seu {vendedor ? "painel de vendedor" : "portal do embaixador"}?</p>

      <div className="ep-opcoes">
        {opcoes.map((painel) => {
          const { rotulo, detalhe, Icone } = comoChamar(paineis, painel);
          const aberto = pedindoSenha === painel;
          return (
            <div key={painel} className={`ep-opcao ${aberto ? "aberta" : ""}`}>
              <button
                type="button"
                className="ep-botao"
                onClick={() => abrir(painel)}
                disabled={abrindo !== null}
                aria-expanded={aberto || undefined}
              >
                <span className={`ep-icone ${painel}`}><Icone size={20} aria-hidden /></span>
                <span className="ep-textos">
                  <b>{abrindo === painel ? "Abrindo..." : rotulo}</b>
                  <small>{detalhe}</small>
                </span>
                <ArrowRight size={18} className="ep-seta" aria-hidden />
              </button>
              {aberto && (
                <form
                  className="ep-senha"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (senha.trim()) abrir(painel, senha);
                  }}
                >
                  <label htmlFor={`ep-senha-${painel}`}>Esta conta tem outra senha. Digite a senha dela:</label>
                  <div className="ep-senha-linha">
                    <input
                      id={`ep-senha-${painel}`}
                      type="password"
                      autoComplete="current-password"
                      autoFocus
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                    />
                    <button type="submit" disabled={abrindo !== null || !senha.trim()}>Entrar</button>
                  </div>
                  {erro && <p role="alert">{erro}</p>}
                </form>
              )}
            </div>
          );
        })}
      </div>

      <p className="ep-dica">Depois dá para trocar pelo menu, sem sair.</p>
      <button type="button" className="ep-outra" onClick={aoEntrarComOutraConta} disabled={abrindo !== null}>
        Entrar com outra conta
      </button>
    </div>
  );
}

export const ESTILO_DA_ESCOLHA = `
.ep-titulo { font-size: 1.2rem; font-weight: 800; color: #111827; text-align: center; line-height: 1.3; letter-spacing: -0.01em; }
.ep-sub { text-align: center; color: #6B7280; font-size: 0.9rem; margin: 6px 0 22px; }
.ep-opcoes { display: flex; flex-direction: column; gap: 10px; }
.ep-opcao { border: 2px solid #E5E7EB; border-radius: 14px; transition: border-color .15s ease; }
.ep-opcao:hover, .ep-opcao.aberta { border-color: #DC2626; }
.ep-botao { width: 100%; display: flex; align-items: center; gap: 12px; padding: 14px; background: none; border: none; text-align: left; cursor: pointer; font-family: inherit; border-radius: 12px; }
.ep-botao:disabled { cursor: wait; }
.ep-botao:focus-visible { outline: 2px solid #DC2626; outline-offset: 2px; }
.ep-icone { width: 42px; height: 42px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ep-icone.loja { background: #FEF2F2; color: #DC2626; }
.ep-icone.parceiro { background: #EFF6FF; color: #1D4ED8; }
.ep-textos { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ep-textos b { font-size: 0.98rem; color: #111827; }
.ep-textos small { font-size: 0.8rem; color: #6B7280; line-height: 1.35; }
.ep-seta { color: #9CA3AF; flex-shrink: 0; transition: transform .15s ease, color .15s ease; }
.ep-botao:hover .ep-seta { color: #DC2626; transform: translateX(2px); }
.ep-senha { padding: 0 14px 14px; }
.ep-senha label { display: block; font-size: 0.8rem; font-weight: 600; color: #374151; margin-bottom: 6px; }
.ep-senha-linha { display: flex; gap: 8px; }
.ep-senha-linha input { flex: 1; min-width: 0; padding: 10px 12px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 0.95rem; font-family: inherit; outline: none; }
.ep-senha-linha input:focus { border-color: #DC2626; }
.ep-senha-linha button { padding: 10px 16px; border: none; border-radius: 10px; background: #DC2626; color: #fff; font-weight: 700; font-family: inherit; cursor: pointer; }
.ep-senha-linha button:disabled { opacity: .6; cursor: not-allowed; }
.ep-senha p { margin-top: 6px; font-size: 0.8rem; font-weight: 600; color: #B91C1C; }
.ep-dica { text-align: center; color: #9CA3AF; font-size: 0.8rem; margin-top: 16px; }
.ep-outra { display: block; margin: 10px auto 0; background: none; border: none; color: #DC2626; font-weight: 600; font-size: 0.85rem; cursor: pointer; font-family: inherit; }
.ep-outra:hover { text-decoration: underline; }
`;
