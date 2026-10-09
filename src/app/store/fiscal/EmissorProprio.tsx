"use client";

/**
 * O EMISSOR PRÓPRIO na tela fiscal: a escolha de quem transmite as notas e o
 * cadastro do emissor do FireHub (certificado A1, CSC, série, QR Code,
 * contingência, teste de conexão e o checklist até a primeira nota de verdade).
 *
 * Mora fora de page.tsx para a tela da Focus e a do emissor próprio não se
 * misturarem num arquivo de 3 mil linhas. Os segredos (o .pfx, a senha, o CSC)
 * só existem no estado deste componente até o envio, e saem dele de qualquer
 * jeito depois da resposta — o servidor nunca devolve nenhum deles.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, ShieldCheck, Upload, Trash2, Zap, Circle } from "lucide-react";
import type { EmissorNaTela, ItemDeProntidao } from "@/lib/nfce/cadastro-do-emissor";
import { passoAPassoDaUf } from "@/lib/nfce/passo-a-passo-da-sefaz";
import { avisoComRotulos } from "@/lib/textos-da-tela-fiscal";

const fmtData = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const fmtDataHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const rotulo: CSSProperties = { fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 };
const campo: CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", background: "#fff", boxSizing: "border-box" };
const grade: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 };
const botaoPrincipal = (ativo: boolean): CSSProperties => ({
  padding: "9px 16px",
  background: ativo ? "#1C1917" : "#CBD5E1",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 800,
  fontSize: "0.82rem",
  cursor: ativo ? "pointer" : "not-allowed",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
});
const botaoSecundario: CSSProperties = {
  padding: "8px 14px",
  background: "#fff",
  color: "#1C1917",
  border: "1.5px solid #CBD5E1",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: "0.8rem",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const TONS = {
  ok: { color: "#134E4A", background: "#F0FDFA", border: "#99F6E4" },
  erro: { color: "#B71C1C", background: "#FEF2F2", border: "#FECACA" },
  // "Espere um pouco" não é falha: a conexão nem foi testada.
  aviso: { color: "#92400E", background: "#FFF7E6", border: "#FDE68A" },
} as const;

function Mensagem({ ok, texto, id, tom }: { ok: boolean; texto: string; id?: string; tom?: keyof typeof TONS }) {
  const cor = TONS[tom ?? (ok ? "ok" : "erro")];
  return (
    <p
      id={id}
      role="status"
      style={{
        fontSize: "0.8rem",
        lineHeight: 1.5,
        margin: "10px 0 0",
        padding: "8px 12px",
        borderRadius: 8,
        color: cor.color,
        background: cor.background,
        border: `1px solid ${cor.border}`,
        whiteSpace: "pre-line",
      }}
    >
      {texto}
    </p>
  );
}

// ─── TESTE DE CONEXÃO ───────────────────────────────────────────────────────

/** O que a tela precisa da resposta do teste de conexão. */
export type RespostaDoTesteDeConexao = {
  /** 429: a loja testou há menos de 1 minuto — nada foi perguntado à SEFAZ nem à Focus. */
  aguarde: boolean;
  ok: boolean;
  status: number;
  cStat: string | null;
  mensagem: string;
  certificado: { titular?: string; validoAte?: string; diasParaVencer?: number } | null;
};

/**
 * POST /api/store/fiscal/testar-conexao com `{ ambiente: 1 | 2 }` — o único
 * contrato da rota (o GET com `?ambiente=` saiu). Serve às duas telas: o
 * emissor do FireHub (status do serviço da SEFAZ com o certificado da loja,
 * resposta `{ ok, cStat, mensagem, ambiente, certificado }`) e a Focus (o
 * token do ambiente, `{ success, mensagem }`).
 *
 * 429 é "testado há menos de 1 min": volta com `aguarde` e a frase do
 * servidor (`error`) como veio — não é "a conexão falhou".
 */
export async function pedirTesteDeConexao(ambiente: 1 | 2): Promise<RespostaDoTesteDeConexao> {
  const res = await fetch("/api/store/fiscal/testar-conexao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ambiente }),
  });
  const dados = await res.json().catch(() => ({}));
  if (res.status === 429) {
    return {
      aguarde: true,
      ok: false,
      status: 429,
      cStat: null,
      mensagem: String(dados.error || dados.mensagem || "Você testou há menos de 1 minuto. Espere um pouco e teste de novo."),
      certificado: null,
    };
  }
  return {
    aguarde: false,
    ok: res.ok && (dados.ok === true || dados.success === true),
    status: res.status,
    cStat: dados.cStat ? String(dados.cStat) : null,
    mensagem: String(dados.mensagem || dados.error || (res.ok ? "Conexão OK." : `Falhou (HTTP ${res.status}).`)),
    certificado: dados.certificado ?? null,
  };
}

// ─── O EMISSOR DO FIREHUB ───────────────────────────────────────────────────

type Props = {
  emissor: EmissorNaTela | null;
  prontidao: ItemDeProntidao[] | null;
  uf: string;
  ufsAtendidas: string[];
  emissaoLigada: boolean;
  ambiente: 1 | 2;
  ehTitular: boolean;
  papelDoUsuario: string;
  /** Relê a configuração do servidor (GET /api/store/fiscal). */
  aoAtualizar: () => Promise<void>;
};

type ResultadoDoTeste = { ok: boolean; aguarde?: boolean; cStat?: string | null; mensagem: string; certificado?: { titular?: string; validoAte?: string; diasParaVencer?: number } | null };

export default function EmissorProprio({ emissor, prontidao, uf, ufsAtendidas, emissaoLigada, ambiente, ehTitular, papelDoUsuario, aoAtualizar }: Props) {
  const [verPassos, setVerPassos] = useState(true);
  // Certificado: o arquivo e a senha só vivem aqui até a resposta.
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [chaveDoArquivo, setChaveDoArquivo] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [resultadoDoCertificado, setResultadoDoCertificado] = useState<{ ok: boolean; texto: string } | null>(null);
  // CSC: o código só vive aqui até o Salvar.
  const [cscHom, setCscHom] = useState({ id: "", codigo: "" });
  const [cscProd, setCscProd] = useState({ id: "", codigo: "" });
  const [salvandoCsc, setSalvandoCsc] = useState(false);
  const [resultadoDoCsc, setResultadoDoCsc] = useState<{ ok: boolean; texto: string } | null>(null);
  // Numeração e QR.
  const [serie, setSerie] = useState<string>(emissor?.serie ? String(emissor.serie) : "");
  const [numeroInicial, setNumeroInicial] = useState<string>(emissor?.numeroInicial ? String(emissor.numeroInicial) : "1");
  const [qr, setQr] = useState<2 | 3>(emissor?.qrVersao ?? 2);
  const [contingencia, setContingencia] = useState<boolean>(emissor?.contingenciaOffline ?? true);
  const [salvandoNumeracao, setSalvandoNumeracao] = useState(false);
  const [resultadoDaNumeracao, setResultadoDaNumeracao] = useState<{ ok: boolean; texto: string } | null>(null);
  // O formulário acompanha o que o servidor gravou: a tela monta antes de o
  // GET voltar, e depois de cada Salvar ela relê.
  useEffect(() => {
    if (!emissor) return;
    setSerie(emissor.serie ? String(emissor.serie) : "");
    setNumeroInicial(emissor.numeroInicial ? String(emissor.numeroInicial) : "1");
    setQr(emissor.qrVersao);
    setContingencia(emissor.contingenciaOffline);
  }, [emissor?.serie, emissor?.numeroInicial, emissor?.qrVersao, emissor?.contingenciaOffline]); // eslint-disable-line react-hooks/exhaustive-deps
  // Teste de conexão.
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<ResultadoDoTeste | null>(null);

  const guia = passoAPassoDaUf(uf);
  const cert = emissor?.certificado ?? null;
  const prontos = (prontidao ?? []).filter((i) => i.ok).length;
  const ufFora = Boolean(uf) && !ufsAtendidas.includes(uf.toUpperCase());

  const enviarCertificado = async () => {
    if (!ehTitular) return;
    if (!arquivo) {
      setResultadoDoCertificado({ ok: false, texto: "Escolha o arquivo .pfx ou .p12 do certificado." });
      return;
    }
    if (arquivo.size > 50 * 1024) {
      setResultadoDoCertificado({ ok: false, texto: "Este arquivo é grande demais para um certificado A1 (limite 50 KB). Confira se escolheu o .pfx certo." });
      return;
    }
    const form = new FormData();
    form.append("certificado", arquivo);
    form.append("senha", senha);
    setEnviando(true);
    setResultadoDoCertificado(null);
    try {
      const res = await fetch("/api/store/fiscal/certificado", { method: "POST", body: form });
      const dados = await res.json().catch(() => ({}));
      const avisos = Array.isArray(dados.avisos) && dados.avisos.length ? `\n\n${dados.avisos.join("\n")}` : "";
      setResultadoDoCertificado({ ok: res.ok, texto: (dados.mensagem || (res.ok ? "Certificado guardado." : "Não consegui guardar o certificado.")) + avisos });
      if (res.ok) {
        setArquivo(null);
        setChaveDoArquivo((k) => k + 1);
        setTeste(null);
        await aoAtualizar();
      }
    } catch {
      setResultadoDoCertificado({ ok: false, texto: "Não consegui falar com o servidor. Nada foi enviado — tente de novo." });
    } finally {
      // A senha sai da memória da tela de qualquer jeito; o arquivo fica se
      // falhou, para corrigir a senha sem escolher de novo.
      setSenha("");
      setEnviando(false);
    }
  };

  const removerCertificado = async () => {
    if (!ehTitular || !cert) return;
    if (!window.confirm("Remover o certificado digital do FireHub? Sem ele o emissor do FireHub não assina nenhuma nota. O arquivo é apagado do cofre.")) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/store/fiscal/certificado", { method: "DELETE" });
      const dados = await res.json().catch(() => ({}));
      setResultadoDoCertificado({ ok: res.ok, texto: dados.mensagem || dados.error || (res.ok ? "Certificado removido." : "Não consegui remover.") });
      if (res.ok) await aoAtualizar();
    } catch {
      setResultadoDoCertificado({ ok: false, texto: "Não consegui falar com o servidor." });
    } finally {
      setEnviando(false);
    }
  };

  const gravarSefaz = async (sefaz: Record<string, unknown>) => {
    const res = await fetch("/api/store/fiscal", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Salvar aqui é escolher o emissor do FireHub (a loja nova ainda não tem).
      body: JSON.stringify({ provedor: "sefaz", sefaz }),
    });
    const dados = await res.json().catch(() => ({}));
    return { ok: res.ok, dados };
  };

  const salvarCsc = async () => {
    if (!ehTitular) return;
    const csc: Record<string, { id: string; codigo: string }> = {};
    if (cscHom.codigo.trim() || cscHom.id.trim()) csc.homologacao = { id: cscHom.id.trim(), codigo: cscHom.codigo.trim() };
    if (cscProd.codigo.trim() || cscProd.id.trim()) csc.producao = { id: cscProd.id.trim(), codigo: cscProd.codigo.trim() };
    if (Object.keys(csc).length === 0) {
      setResultadoDoCsc({ ok: false, texto: "Digite o ID e o CSC de pelo menos um ambiente." });
      return;
    }
    setSalvandoCsc(true);
    setResultadoDoCsc(null);
    try {
      const r = await gravarSefaz({ csc });
      setResultadoDoCsc({ ok: r.ok, texto: r.ok ? `CSC salvo, cifrado.${r.dados.aviso ? `\n${avisoComRotulos(r.dados.aviso, r.dados.camposIgnorados)}` : ""}` : r.dados.mensagem || r.dados.error || "Não consegui salvar o CSC." });
      if (r.ok) {
        setCscHom({ id: "", codigo: "" });
        setCscProd({ id: "", codigo: "" });
        await aoAtualizar();
      }
    } catch {
      setResultadoDoCsc({ ok: false, texto: "Não consegui falar com o servidor. Nada foi salvo." });
    } finally {
      // O código do CSC sai da tela de qualquer jeito.
      setCscHom((c) => ({ ...c, codigo: "" }));
      setCscProd((c) => ({ ...c, codigo: "" }));
      setSalvandoCsc(false);
    }
  };

  const removerCsc = async (amb: "homologacao" | "producao") => {
    if (!ehTitular) return;
    if (!window.confirm(`Remover o CSC de ${amb === "producao" ? "produção" : "homologação"}?`)) return;
    setSalvandoCsc(true);
    try {
      const r = await gravarSefaz({ csc: { [amb]: null } });
      setResultadoDoCsc({ ok: r.ok, texto: r.ok ? "CSC removido." : r.dados.mensagem || r.dados.error || "Não consegui remover." });
      if (r.ok) await aoAtualizar();
    } finally {
      setSalvandoCsc(false);
    }
  };

  const salvarNumeracao = async () => {
    if (!ehTitular) return;
    const sefaz: Record<string, unknown> = { qrVersao: qr, contingenciaOffline: contingencia };
    if (serie.trim()) sefaz.serie = Number(serie);
    if (numeroInicial.trim()) sefaz.numeroInicial = Number(numeroInicial);
    if (!serie.trim()) {
      setResultadoDaNumeracao({ ok: false, texto: `Escolha a série (sugerimos a ${emissor?.serieSugerida ?? 2}).` });
      return;
    }
    setSalvandoNumeracao(true);
    setResultadoDaNumeracao(null);
    try {
      const r = await gravarSefaz(sefaz);
      setResultadoDaNumeracao({ ok: r.ok, texto: r.ok ? `Salvo.${r.dados.aviso ? `\n${avisoComRotulos(r.dados.aviso, r.dados.camposIgnorados)}` : ""}` : r.dados.mensagem || r.dados.error || "Não consegui salvar." });
      if (r.ok) await aoAtualizar();
    } catch {
      setResultadoDaNumeracao({ ok: false, texto: "Não consegui falar com o servidor. Nada foi salvo." });
    } finally {
      setSalvandoNumeracao(false);
    }
  };

  // O teste de conexão é da frente de emissão (POST /api/store/fiscal/testar-conexao,
  // `pedirTesteDeConexao`): status do serviço da SEFAZ, com o certificado da
  // loja, sempre em HOMOLOGAÇÃO — o teste do "dia 1" não toca produção.
  const testarConexao = async () => {
    setTestando(true);
    setTeste(null);
    try {
      const r = await pedirTesteDeConexao(2);
      setTeste({ ok: r.ok, aguarde: r.aguarde, cStat: r.cStat, mensagem: r.mensagem, certificado: r.certificado });
      // 429: nada foi testado, o "último teste" gravado continua o mesmo.
      if (!r.aguarde) await aoAtualizar();
    } catch {
      setTeste({ ok: false, mensagem: "Não consegui falar com o servidor do FireHub." });
    } finally {
      setTestando(false);
    }
  };

  const ultimo = emissor?.ultimoTeste ?? null;

  return (
    <section aria-labelledby="emissor-proprio-titulo" style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.2rem 1.3rem" }}>
      <h2 id="emissor-proprio-titulo" style={{ margin: 0, fontSize: "1.02rem", fontWeight: 800, color: "#1E293B", display: "flex", alignItems: "center", gap: 8 }}>
        <ShieldCheck size={18} color="#0F766E" aria-hidden /> Emissor do FireHub — direto na SEFAZ
      </h2>
      <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "#475569", lineHeight: 1.5 }}>
        O FireHub assina cada NFC-e com o certificado da loja e transmite à SEFAZ{uf ? `-${uf}` : ""}, sem provedor no meio e sem custo por nota.
      </p>
      {ufFora && (
        <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px" }}>
          O Emissor do FireHub não transmite para a UF &quot;{uf.toUpperCase()}&quot; (atende: {ufsAtendidas.join(", ")}). Confira a UF do endereço fiscal em Dados da empresa.
        </p>
      )}

      {/* ── Checklist de prontidão ── */}
      {prontidao && (
        <div style={{ marginTop: 14, padding: "12px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12 }}>
          <h3 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 800, color: "#1E293B" }}>
            Pronto para emitir? <span style={{ fontWeight: 600, color: "#475569" }}>{prontos} de {prontidao.length}</span>
          </h3>
          <ol style={{ margin: "8px 0 0", paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {prontidao.map((item, i) => (
              <li key={item.chave} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.8rem", color: "#334155", lineHeight: 1.45 }}>
                {item.ok ? <CheckCircle2 size={16} color="#0F766E" aria-hidden style={{ flexShrink: 0, marginTop: 1 }} /> : <Circle size={16} color="#B45309" aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />}
                <span>
                  <strong>
                    {i + 1}. {item.rotulo}
                  </strong>
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{item.ok ? " — feito" : " — falta"}</span>
                  <span style={{ color: item.ok ? "#64748B" : "#92400E" }}> — {item.detalhe}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ── Passo a passo na SEFAZ ── */}
      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          aria-expanded={verPassos}
          aria-controls="emissor-passo-a-passo"
          onClick={() => setVerPassos((v) => !v)}
          style={{ background: "none", border: "none", padding: 0, color: "#1E293B", fontWeight: 800, fontSize: "0.88rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, textAlign: "left" }}
        >
          {verPassos ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
          Antes de começar, na SEFAZ: {guia.titulo}
        </button>
        {verPassos && (
          <div id="emissor-passo-a-passo" style={{ marginTop: 8 }}>
            {!uf && <p style={{ fontSize: "0.75rem", color: "#94A3B8", margin: "0 0 6px" }}>Preencha a UF no endereço fiscal para ver o passo a passo do seu estado.</p>}
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: "0.8rem", color: "#475569", lineHeight: 1.6 }}>
              {guia.passos.map((p) => (
                <li key={p.titulo}>
                  <strong>{p.titulo}</strong> — {p.texto}
                </li>
              ))}
            </ol>
            {guia.links.length > 0 && (
              <p style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
                {guia.links.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: "#1D4ED8", fontWeight: 700, marginRight: 12 }}>
                    {l.rotulo} ↗
                  </a>
                ))}
              </p>
            )}
            {guia.avisos.map((a) => (
              <p key={a} style={{ fontSize: "0.78rem", color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", margin: "8px 0 0", lineHeight: 1.5 }}>
                {a}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* ── Certificado digital A1 ── */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed #E2E8F0" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 800, color: "#1E293B" }}>Certificado digital A1</h3>
        {cert ? (
          <div
            style={{
              marginTop: 8,
              padding: "10px 14px",
              borderRadius: 10,
              fontSize: "0.8rem",
              lineHeight: 1.6,
              background: cert.situacao === "ok" ? "#F0FDFA" : "#FEF2F2",
              border: `1px solid ${cert.situacao === "ok" ? "#99F6E4" : "#FECACA"}`,
              color: cert.situacao === "ok" ? "#134E4A" : "#7F1D1D",
            }}
          >
            <strong>{cert.titular || "Titular sem nome"}</strong>
            <br />
            CNPJ {cert.cnpjFormatado} · válido de {fmtData(cert.validoDe)} até <strong>{fmtData(cert.validoAte)}</strong> · enviado em {fmtData(cert.enviadoEm)}
            {cert.situacao === "vence_em_breve" && (
              <span role="alert" style={{ display: "block", fontWeight: 800, marginTop: 4 }}>
                <AlertTriangle size={13} aria-hidden style={{ verticalAlign: "-2px" }} /> Vence em {cert.dias} dia(s). Compre a renovação na certificadora e envie o arquivo novo antes disso — no dia seguinte ao vencimento nenhuma nota é autorizada.
              </span>
            )}
            {cert.situacao === "vencido" && (
              <span role="alert" style={{ display: "block", fontWeight: 800, marginTop: 4 }}>
                O certificado VENCEU em {fmtData(cert.validoAte)}. Nenhuma nota é autorizada até você enviar o novo.
              </span>
            )}
            {cert.mesmaEmpresa === false && (
              <span role="alert" style={{ display: "block", fontWeight: 800, marginTop: 4 }}>
                Este certificado é de outra empresa (CNPJ {cert.cnpjFormatado}). Envie o da própria empresa.
              </span>
            )}
            {cert.outroEstabelecimento && (
              <span style={{ display: "block", marginTop: 4 }}>
                É de outro estabelecimento da mesma empresa — vale (o Ajuste SINIEF 19/16 aceita o certificado de qualquer estabelecimento do contribuinte).
              </span>
            )}
          </div>
        ) : (
          <p style={{ fontSize: "0.8rem", color: "#64748B", margin: "6px 0 0" }}>Nenhum certificado enviado ainda.</p>
        )}

        <div style={{ ...grade, marginTop: 10 }}>
          <div>
            <label htmlFor="nfce-certificado" style={rotulo}>
              {cert ? "Trocar pelo certificado novo (.pfx ou .p12)" : "Arquivo do certificado (.pfx ou .p12)"}
            </label>
            <input
              id="nfce-certificado"
              key={chaveDoArquivo}
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              disabled={!ehTitular || enviando}
              aria-describedby="nfce-certificado-ajuda"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] || null);
                setResultadoDoCertificado(null);
              }}
              style={{ ...campo, padding: "6px 8px" }}
            />
          </div>
          <div>
            <label htmlFor="nfce-senha-certificado" style={rotulo}>
              Senha do certificado
            </label>
            <input
              id="nfce-senha-certificado"
              type="password"
              autoComplete="new-password"
              value={senha}
              disabled={!ehTitular || enviando}
              onChange={(e) => setSenha(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") enviarCertificado();
              }}
              placeholder="A senha definida ao baixar o certificado"
              style={campo}
            />
          </div>
        </div>
        <p id="nfce-certificado-ajuda" style={{ fontSize: "0.75rem", color: "#64748B", margin: "6px 0 0", lineHeight: 1.5 }}>
          O arquivo é guardado CIFRADO no cofre do FireHub e a senha também; nenhum dos dois volta para a tela. O A3 (cartão ou token) não serve.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={enviarCertificado} disabled={!ehTitular || enviando} style={botaoPrincipal(ehTitular && !enviando)}>
            <Upload size={15} aria-hidden /> {enviando ? "Conferindo…" : cert ? "Enviar o novo certificado" : "Enviar certificado"}
          </button>
          {cert && (
            <button type="button" onClick={removerCertificado} disabled={!ehTitular || enviando} style={{ ...botaoSecundario, color: "#B91C1C", borderColor: "#FCA5A5" }}>
              <Trash2 size={14} aria-hidden /> Remover
            </button>
          )}
          {!ehTitular && papelDoUsuario && <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Só o responsável pela loja envia o certificado.</span>}
        </div>
        {resultadoDoCertificado && <Mensagem ok={resultadoDoCertificado.ok} texto={resultadoDoCertificado.texto} />}
      </div>

      {/* ── CSC ── */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed #E2E8F0" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 800, color: "#1E293B" }}>CSC — Código de Segurança do Contribuinte</h3>
        <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "4px 0 0", lineHeight: 1.5 }}>
          Assina o QR Code da NFC-e. Um para homologação (teste) e outro para produção, com o ID de cada um. Fica cifrado; aqui aparecem só os 4 últimos caracteres.
        </p>
        <div style={{ ...grade, marginTop: 10 }}>
          {(["homologacao", "producao"] as const).map((amb) => {
            const atual = emissor?.csc[amb] ?? null;
            const valor = amb === "producao" ? cscProd : cscHom;
            const mudar = amb === "producao" ? setCscProd : setCscHom;
            const nome = amb === "producao" ? "produção" : "homologação";
            return (
              <fieldset key={amb} style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: "8px 12px 12px", margin: 0, minWidth: 0 }}>
                <legend style={{ fontSize: "0.8rem", fontWeight: 800, color: "#334155", padding: "0 4px" }}>
                  {amb === "producao" ? "Produção" : "Homologação (teste)"}{" "}
                  {atual ? (
                    <span style={{ color: "#0F766E", fontWeight: 700 }}>
                      — ID {atual.id}, final ••••{atual.final} ✓
                    </span>
                  ) : (
                    <span style={{ color: "#B45309", fontWeight: 700 }}>— não cadastrado</span>
                  )}
                </legend>
                <label htmlFor={`nfce-id-csc-${amb}`} style={rotulo}>
                  ID do CSC de {nome}
                </label>
                <input
                  id={`nfce-id-csc-${amb}`}
                  inputMode="numeric"
                  value={valor.id}
                  disabled={!ehTitular || salvandoCsc}
                  onChange={(e) => mudar((c) => ({ ...c, id: e.target.value }))}
                  placeholder={atual ? `Atual: ${atual.id}` : "Ex.: 000001"}
                  style={campo}
                />
                <label htmlFor={`nfce-csc-${amb}`} style={{ ...rotulo, marginTop: 8 }}>
                  CSC de {nome}
                </label>
                <input
                  id={`nfce-csc-${amb}`}
                  type="password"
                  autoComplete="off"
                  value={valor.codigo}
                  disabled={!ehTitular || salvandoCsc}
                  onChange={(e) => mudar((c) => ({ ...c, codigo: e.target.value }))}
                  placeholder={atual ? `Atual: ••••${atual.final} (preencha só para trocar)` : "Código gerado no portal da SEFAZ"}
                  style={campo}
                />
                {atual && ehTitular && (
                  <button type="button" onClick={() => removerCsc(amb)} disabled={salvandoCsc} style={{ ...botaoSecundario, marginTop: 8, padding: "5px 10px", fontSize: "0.72rem", color: "#B91C1C", borderColor: "#FCA5A5" }}>
                    Remover o CSC de {nome}
                  </button>
                )}
              </fieldset>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={salvarCsc} disabled={!ehTitular || salvandoCsc} style={botaoPrincipal(ehTitular && !salvandoCsc)}>
            {salvandoCsc ? "Salvando…" : "Salvar CSC"}
          </button>
        </div>
        {resultadoDoCsc && <Mensagem ok={resultadoDoCsc.ok} texto={resultadoDoCsc.texto} />}
      </div>

      {/* ── Numeração, QR Code e contingência ── */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed #E2E8F0" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 800, color: "#1E293B" }}>Numeração, QR Code e contingência</h3>
        <div style={{ ...grade, marginTop: 10 }}>
          <div>
            <label htmlFor="nfce-serie" style={rotulo}>
              Série da NFC-e no FireHub
            </label>
            <input
              id="nfce-serie"
              type="number"
              inputMode="numeric"
              min={1}
              // SERIE_MAXIMA de lib/nfce/pendencias (não importável aqui: puxa o sefaz.ts, só de servidor).
              max={889}
              value={serie}
              disabled={!ehTitular || salvandoNumeracao}
              onChange={(e) => setSerie(e.target.value)}
              aria-describedby="nfce-serie-ajuda"
              placeholder={`Sugestão: ${emissor?.serieSugerida ?? 2}`}
              style={campo}
            />
            <p id="nfce-serie-ajuda" style={{ fontSize: "0.72rem", color: "#64748B", margin: "4px 0 0", lineHeight: 1.45 }}>
              {emissor?.serie ? `Gravada: série ${emissor.serie}. ` : ""}
              {emissor?.motivoDaSerie}{" "}
              {!emissor?.serie && ehTitular && (
                <button
                  type="button"
                  onClick={() => setSerie(String(emissor?.serieSugerida ?? 2))}
                  style={{ background: "none", border: "none", padding: 0, color: "#1D4ED8", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer", textDecoration: "underline" }}
                >
                  Usar a série {emissor?.serieSugerida ?? 2}
                </button>
              )}
            </p>
          </div>
          <div>
            <label htmlFor="nfce-numero-inicial" style={rotulo}>
              Primeiro número desta série
            </label>
            <input
              id="nfce-numero-inicial"
              type="number"
              inputMode="numeric"
              min={1}
              value={numeroInicial}
              disabled={!ehTitular || salvandoNumeracao}
              onChange={(e) => setNumeroInicial(e.target.value)}
              aria-describedby="nfce-numero-ajuda"
              style={campo}
            />
            <p id="nfce-numero-ajuda" style={{ fontSize: "0.72rem", color: "#64748B", margin: "4px 0 0", lineHeight: 1.45 }}>
              Numa série nova, 1. Só mude se a própria série já foi usada por aqui.
            </p>
          </div>
        </div>

        <fieldset style={{ border: "none", padding: 0, margin: "12px 0 0", minWidth: 0 }}>
          <legend style={{ ...rotulo, marginBottom: 6 }}>Versão do QR Code</legend>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {([2, 3] as const).map((v) => (
              <label key={v} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: "0.8rem", color: "#334155", cursor: ehTitular ? "pointer" : "default", maxWidth: 360 }}>
                <input
                  type="radio"
                  name="nfce-qr-versao"
                  checked={qr === v}
                  disabled={!ehTitular || salvandoNumeracao}
                  onChange={() => setQr(v)}
                  style={{ accentColor: "#1C1917", marginTop: 3 }}
                />
                <span>
                  <strong>{v === 2 ? "Versão 2 (padrão)" : "Versão 3 (opcional)"}</strong>
                  <span style={{ display: "block", fontSize: "0.72rem", color: v === 3 ? "#92400E" : "#64748B", lineHeight: 1.45 }}>
                    {v === 2
                      ? "Com o CSC — a que toda UF aceita."
                      : "NT 2025.001: dispensa o CSC na nota on-line, mas depende de a SEFAZ da sua UF já aceitar. Se não aceitar, toda nota volta rejeitada."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontSize: "0.8rem", color: "#334155", cursor: ehTitular ? "pointer" : "default" }}>
          <input
            type="checkbox"
            checked={contingencia}
            disabled={!ehTitular || salvandoNumeracao}
            onChange={(e) => setContingencia(e.target.checked)}
            style={{ accentColor: "#1C1917", width: 16, height: 16, marginTop: 2 }}
          />
          <span>
            <strong>Contingência off-line ligada</strong>
            <span style={{ display: "block", fontSize: "0.72rem", color: "#64748B", lineHeight: 1.45 }}>
              Com a SEFAZ fora do ar, a nota sai assim mesmo (DANFE com &quot;emitida em contingência&quot;) e é transmitida depois. Desligue só se a sua UF não admitir.
            </span>
          </span>
        </label>

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={salvarNumeracao} disabled={!ehTitular || salvandoNumeracao} style={botaoPrincipal(ehTitular && !salvandoNumeracao)}>
            {salvandoNumeracao ? "Salvando…" : "Salvar numeração e QR Code"}
          </button>
        </div>
        {emissaoLigada && (
          <p style={{ fontSize: "0.72rem", color: "#64748B", margin: "6px 0 0" }}>Com a emissão ligada, a série e o número inicial não mudam — desligue antes.</p>
        )}
        {resultadoDaNumeracao && <Mensagem ok={resultadoDaNumeracao.ok} texto={resultadoDaNumeracao.texto} />}
      </div>

      {/* ── Teste de conexão ── */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed #E2E8F0" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 800, color: "#1E293B" }}>Conexão com a SEFAZ</h3>
        <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "4px 0 0", lineHeight: 1.5 }}>
          Pergunta à SEFAZ, em homologação, se o serviço está no ar — com o certificado da loja. Não emite nota.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={testarConexao} disabled={testando || !cert} style={botaoPrincipal(!testando && Boolean(cert))} aria-describedby={!cert ? "nfce-teste-sem-cert" : undefined}>
            <Zap size={15} aria-hidden /> {testando ? "Testando…" : "Testar conexão com a SEFAZ"}
          </button>
          {!cert && (
            <span id="nfce-teste-sem-cert" style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
              Envie o certificado primeiro.
            </span>
          )}
        </div>
        {teste && (
          <Mensagem
            ok={teste.ok}
            tom={teste.aguarde ? "aviso" : undefined}
            texto={
              teste.aguarde
                ? teste.mensagem
                : `${teste.ok ? "Conexão OK" : "A conexão falhou"}${teste.cStat ? ` (cStat ${teste.cStat})` : ""}: ${teste.mensagem}` +
                  (teste.certificado?.titular ? `\nCertificado: ${teste.certificado.titular}${teste.certificado.validoAte ? `, válido até ${fmtData(teste.certificado.validoAte)}` : ""}.` : "")
            }
          />
        )}
        {ultimo && (
          <p style={{ fontSize: "0.75rem", color: "#64748B", margin: "8px 0 0" }}>
            Último teste: {fmtDataHora(ultimo.quando)} · {ultimo.ambiente === 1 ? "produção" : "homologação"} · {ultimo.ok ? "OK" : "falhou"}
            {ultimo.cStat ? ` (cStat ${ultimo.cStat})` : ""} — {ultimo.mensagem}
          </p>
        )}
        {ambiente === 1 && <p style={{ fontSize: "0.72rem", color: "#64748B", margin: "6px 0 0" }}>A loja está em produção; o teste continua em homologação, que não gera nota.</p>}
      </div>
    </section>
  );
}
