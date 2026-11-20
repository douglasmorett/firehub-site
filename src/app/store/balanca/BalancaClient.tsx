"use client";

/**
 * Balança (self-service por quilo) — a tela do dono (/store/balanca).
 *
 * Desligado: o que é, como funciona no salão, o preço À PARTE da mensalidade
 * (Douglas, 05/11/2026: "os 197 pela balança, mas o mínimo e máximo do
 * sistema") e o equipamento que a loja compra — o FireHub não vende
 * equipamento. Ao ativar, o termo (lib/balanca/termo.ts).
 * Ligado: o liga/desliga, os produtos vendidos por quilo e a porta da tela de
 * pesagem (/store/balanca/pesar).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cable, Calculator, ReceiptText, ScanLine, Scale } from "lucide-react";
import InterruptorDoModulo from "@/components/modulos/InterruptorDoModulo";
import ResumoDaCobranca from "@/components/modulos/ResumoDaCobranca";
import { CLAUSULAS_DO_TERMO_DA_BALANCA, TITULO_DO_TERMO_DA_BALANCA, VERSAO_DO_TERMO_DA_BALANCA } from "@/lib/balanca/termo";
import { IlustracaoDaBalanca } from "./IlustracaoDaBalanca";

type Estado = { ativo: boolean; cobradoEsteMes: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean; isento: boolean; desligaEm: string | null; fimDoMes: string | null };
type ProdutoDoCardapio = { id: string; nome: string; categoria: string; precoDoQuilo: number };
type Dados = {
  estado: Estado;
  podeContratar: boolean;
  preco: number;
  diasDeTeste: number;
  produtos: string[];
  cardapio: ProdutoDoCardapio[];
  mensalidade: { percentual: number; minimo: number; teto: number };
};
type Aviso = { tipo: "ok" | "erro"; titulo: string; detalhe?: string };

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

const COR = "#0F766E";
const cartao: React.CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "18px 20px", marginTop: 16 };
const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: 17, fontWeight: 800, color: "#0F172A" };
const texto: React.CSSProperties = { margin: 0, fontSize: 14, color: "#475569", lineHeight: 1.6 };

export default function BalancaClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [termoAberto, setTermoAberto] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/balanca", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao carregar");
      setDados(j);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "erro" ? 10000 : 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function ligar(ligar: boolean) {
    if (!dados) return;
    setSalvando(true);
    const antes = dados.estado;
    try {
      const r = await fetch("/api/store/balanca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ligar ? { ligar, aceite: { versao: VERSAO_DO_TERMO_DA_BALANCA } } : { ligar }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro");
      const estado: Estado = j.estado;
      setDados({ ...dados, estado });
      setTermoAberto(false);
      setAviso(ligar
        ? antes.ativo && antes.desligaEm
          ? { tipo: "ok", titulo: "A balança continua ligada.", detalhe: "O desligamento da virada do mês foi cancelado; a cobrança segue normal." }
          : { tipo: "ok", titulo: "Balança ligada!", detalhe: estado.isento ? undefined
              : estado.emTeste && estado.testeAte ? `Grátis até ${data(estado.testeAte)}. Depois disso, se continuar ligada, o mês entra inteiro no boleto (${reais(dados.preco)}), à parte da mensalidade.`
              : `Este mês já entra inteiro no boleto (${reais(dados.preco)}), numa linha própria, à parte da mensalidade.` }
        : estado.ativo && estado.desligaEm
          ? { tipo: "ok", titulo: `A balança desliga em ${data(estado.desligaEm)}.`, detalhe: "Este mês já está pago: até lá ela continua liberada, e o mês que vem não é cobrado." }
          : { tipo: "ok", titulo: "Balança desligada.", detalhe: "Você estava no teste grátis: nada foi cobrado." });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div style={{ padding: 24, color: "#B71C1C", fontWeight: 700 }}>{erro}</div>;
  if (!dados) return <div style={{ padding: 24, color: "#64748B" }}>Carregando…</div>;
  const e = dados.estado;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "20px 16px 60px" }}>
      {aviso && (
        <div role="status" onClick={() => setAviso(null)} style={{
          position: "sticky", top: 8, zIndex: 20, marginBottom: 12, padding: "12px 16px", borderRadius: 12,
          background: aviso.tipo === "ok" ? "#ECFDF5" : "#FEF2F2", border: `1px solid ${aviso.tipo === "ok" ? "#A7F3D0" : "#FECACA"}`,
          color: aviso.tipo === "ok" ? "#065F46" : "#991B1B", display: "flex", flexDirection: "column", gap: 2, cursor: "pointer",
        }}>
          <strong>{aviso.titulo}</strong>
          {aviso.detalhe && <span style={{ fontSize: 14 }}>{aviso.detalhe}</span>}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span aria-hidden style={{ width: 44, height: 44, borderRadius: 12, background: COR, color: "#fff", display: "grid", placeItems: "center", flex: "none" }}>
          <Scale size={24} />
        </span>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: "#0F172A" }}>Balança automática</h1>
        {e.ativo && (
          <span style={{ fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999, background: "#DCFCE7", color: "#166534" }}>
            {e.isento ? "LIBERADO" : e.emTeste && e.testeAte ? `ATIVO · grátis até ${data(e.testeAte)}` : "ATIVO"}
          </span>
        )}
      </div>
      <p style={{ ...texto, marginTop: 8, fontSize: 16, color: "#334155" }}>
        <b style={{ color: "#0F172A" }}>O peso entra sozinho.</b> O cliente do self-service põe o prato na balança, o FireHub
        recebe o peso pelo cabo, multiplica pelo preço do quilo e o valor cai direto na comanda dele. Ninguém digita peso,
        ninguém faz conta.
      </p>

      {e.ativo ? (
        <>
          <Ativo dados={dados} salvando={salvando} onDesligar={() => ligar(false)} onContinuar={() => ligar(true)}
            onProdutos={(produtos) => setDados({ ...dados, produtos })} onAviso={setAviso} />
          <div style={{ marginTop: 16 }}><IlustracaoDaBalanca /></div>
        </>
      ) : (
        <>
          <div style={{ marginTop: 16 }}><IlustracaoDaBalanca /></div>
          <PorQueAutomatica />
          <Oferta dados={dados} salvando={salvando} onAtivar={() => setTermoAberto(true)} />
        </>
      )}

      <Equipamento />

      {termoAberto && (
        <Termo preco={dados.preco} diasDeTeste={dados.diasDeTeste} comTeste={!e.jaTestou && !e.isento}
          salvando={salvando} onCancelar={() => setTermoAberto(false)} onAceitar={() => ligar(true)} />
      )}
    </div>
  );
}

// ─── Desligado ───────────────────────────────────────────────────────────

/**
 * O que o "automática" quer dizer, só com o que a tela de pesar faz de verdade
 * (pesar/TelaDaBalanca.tsx, lib/balanca/protocolo-toledo.ts,
 * api/store/balanca/pesar, lib/fiscal-itens.ts). O erro de digitação é um
 * exemplo de conta, marcado como exemplo: 0,027 kg × R$ 51,90 = R$ 1,40.
 */
const VANTAGENS: [typeof Cable, string, string][] = [
  [Cable, "Ninguém digita o peso", "A balança manda o peso pelo cabo. O valor só sai quando ela repete o mesmo peso: prato balançando ou mão encostada não vira conta."],
  [Calculator, "A conta é do sistema", "Peso × preço do quilo do seu cardápio, no centavo. O FireHub refaz a conta na hora de lançar, com o preço cadastrado."],
  [ScanLine, "Cai direto na comanda", "O cliente encosta o cartão no leitor de mesa e pronto. A comanda abre sozinha na primeira pesagem e o mesmo prato não entra duas vezes."],
  [ReceiptText, "O caixa só fecha", "Passa o cartão em Mesas › Comandas e fecha a conta, com o prato e a bebida juntos. Se a loja emite NFC-e pelo FireHub, o prato sai na nota em quilo (KG)."],
];

function PorQueAutomatica() {
  const lista = (itens: string[], cor: string, marca: string) => (
    <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
      {itens.map((t) => (
        <li key={t} style={{ display: "flex", gap: 8, fontSize: 14, color: "#334155", lineHeight: 1.45 }}>
          <b aria-hidden style={{ color: cor, flex: "none" }}>{marca}</b>{t}
        </li>
      ))}
    </ul>
  );
  return (
    <section style={cartao}>
      <h2 style={h2}>Por que automática</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))", gap: 12 }}>
        {VANTAGENS.map(([Icone, titulo, detalhe]) => (
          <div key={titulo} style={{ border: "1px solid #CCFBF1", background: "#F0FDFA", borderRadius: 12, padding: "14px 14px 12px" }}>
            <span aria-hidden style={{ width: 34, height: 34, borderRadius: 10, background: "#fff", color: COR, display: "grid", placeItems: "center", boxShadow: "0 2px 6px rgba(15,118,110,.15)" }}>
              <Icone size={19} />
            </span>
            <b style={{ display: "block", marginTop: 10, fontSize: 15, color: "#0F172A" }}>{titulo}</b>
            <p style={{ ...texto, marginTop: 4, fontSize: 13.5, lineHeight: 1.5 }}>{detalhe}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 14 }}>
        <div style={{ borderRadius: 12, padding: "12px 14px", background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
          <b style={{ fontSize: 14, color: "#64748B" }}>Sem a balança automática</b>
          {lista([
            "Alguém lê o visor e digita ou anota o peso de cada prato.",
            "A conta do quilo é feita na mão ou na calculadora.",
            "Número trocado vira prejuízo ou reclamação na mesa.",
          ], "#DC2626", "✕")}
        </div>
        <div style={{ borderRadius: 12, padding: "12px 14px", background: "#F0FDFA", border: "1.5px solid #99F6E4" }}>
          <b style={{ fontSize: 14, color: COR }}>Com a balança automática</b>
          {lista([
            "O peso vem da balança direto para a comanda do cliente.",
            "O valor sai do preço do quilo do cardápio, sem conta na mão.",
            "Quem pesava fica livre para repor o buffet e atender.",
          ], COR, "✓")}
        </div>
      </div>

      <div style={{ marginTop: 12, borderRadius: 12, padding: "12px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.6, color: "#92400E", background: "#FEF3C7", borderRadius: 6, padding: "3px 7px" }}>EXEMPLO</span>
        <p style={{ ...texto, flex: "1 1 260px", fontSize: 14, color: "#78350F" }}>
          Um prato de <b>0,452 kg</b> digitado como <b>0,425 kg</b> (dois números trocados), a R$ 51,90 o quilo:{" "}
          <b>R$ 1,40 a menos</b> nesse prato, e ninguém percebe. Na balança automática o peso não passa pela mão de ninguém.
        </p>
      </div>
    </section>
  );
}

function Oferta({ dados, salvando, onAtivar }: { dados: Dados; salvando: boolean; onAtivar: () => void }) {
  const m = dados.mensalidade;
  const comTeste = !dados.estado.jaTestou;
  return (
    <section style={{ ...cartao, borderColor: "#99F6E4", background: "linear-gradient(180deg,#F0FDFA,#fff)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 34, fontWeight: 900, color: COR }}>{reais(dados.preco)}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#334155" }}>por mês · {comTeste ? `${dados.diasDeTeste} dias grátis para testar` : "sem taxa de instalação"}</span>
      </div>
      <ul style={{ margin: "12px 0 0", paddingLeft: 20, color: "#334155", fontSize: 14, lineHeight: 1.8 }}>
        <li>Balanças e terminais <b>ilimitados</b>, sem taxa de instalação.</li>
        <li>O prato cai direto na comanda do cliente; a bebida o garçom lança no mesmo cartão.</li>
        <li>Fecha no caixa pelo número do cartão, com a nota fiscal saindo em quilo (KG).</li>
        <li>Delivery, mesas, robô e cardápio continuam no mesmo sistema — um só painel.</li>
      </ul>
      <p style={{ ...texto, marginTop: 12, fontSize: 13 }}>
        <b>À parte da mensalidade.</b> A mensalidade do FireHub continua a mesma ({m.percentual}% do faturamento, mínimo de{" "}
        {reais(m.minimo)} e teto de {reais(m.teto)}), e as vendas pesadas entram nela como qualquer pedido. O equipamento é
        comprado pela loja (lista abaixo); o FireHub não vende nem aluga equipamento.
      </p>
      {dados.estado.isento ? null : dados.podeContratar ? (
        <button type="button" onClick={onAtivar} disabled={salvando} style={{
          marginTop: 16, width: "100%", padding: "14px", borderRadius: 12, border: "none", background: COR, color: "#fff",
          fontSize: 16, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
        }}>{comTeste ? `Testar ${dados.diasDeTeste} dias grátis` : "Ativar a balança"}</button>
      ) : (
        <p style={{ ...texto, marginTop: 12, fontWeight: 700 }}>Quem ativa a balança é o dono da loja.</p>
      )}
    </section>
  );
}

// ─── Ligado ──────────────────────────────────────────────────────────────

function Ativo({ dados, salvando, onDesligar, onContinuar, onProdutos, onAviso }: {
  dados: Dados; salvando: boolean; onDesligar: () => void; onContinuar: () => void;
  onProdutos: (ids: string[]) => void; onAviso: (a: Aviso) => void;
}) {
  return (
    <>
      {dados.podeContratar && (
        <div style={{ marginTop: 16 }}>
          <InterruptorDoModulo nome="o módulo Balança" preco={dados.preco} estado={dados.estado} salvando={salvando}
            onLigar={() => {}} onDesligar={onDesligar} onContinuar={onContinuar} />
        </div>
      )}

      {/* Loja isenta (demonstração do vendedor): liberada, mas mostra o que o lojista vê e paga. */}
      {dados.estado.isento && (
        <>
          <p style={{ ...texto, marginTop: 16, fontWeight: 700, color: "#0F172A" }}>Na sua conta está liberado sem custo. Para o lojista é assim:</p>
          <Oferta dados={dados} salvando={salvando} onAtivar={() => {}} />
          <ResumoDaCobranca preco={dados.preco} diasDeTeste={dados.diasDeTeste} comTeste paraOLojista />
        </>
      )}

      <section style={{ ...cartao, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", borderColor: "#99F6E4" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ ...h2, marginBottom: 4 }}>Tela da balança</h2>
          <p style={texto}>Abra no tablet ou no computador ligado à balança, no Chrome. A tela fica cheia, esperando o prato.</p>
        </div>
        <a href="/store/balanca/pesar" style={{
          padding: "14px 22px", borderRadius: 12, background: COR, color: "#fff", fontWeight: 900, fontSize: 16, textDecoration: "none",
        }}>Abrir tela da balança</a>
        <a href="/store/balanca/pesar?simular=1" style={{ fontSize: 13, fontWeight: 700, color: COR }}>Testar sem balança</a>
      </section>

      <ProdutosPorQuilo dados={dados} onProdutos={onProdutos} onAviso={onAviso} />

      <section style={cartao}>
        <h2 style={h2}>Cartões de comanda</h2>
        <p style={texto}>
          Cadastre os cartões e imprima em <b>Mesas › ⚙️ Gerenciar Mesas › 🎫 Comandas</b>. A comanda abre sozinha na primeira
          pesagem; no caixa, passe o cartão em <b>Mesas › 🎫 Comandas</b> e feche a conta.
        </p>
        <a href="/store/mesas" style={{ display: "inline-block", marginTop: 10, fontWeight: 800, color: COR }}>Ir para Mesas →</a>
      </section>
    </>
  );
}

function ProdutosPorQuilo({ dados, onProdutos, onAviso }: { dados: Dados; onProdutos: (ids: string[]) => void; onAviso: (a: Aviso) => void }) {
  const [marcados, setMarcados] = useState<string[]>(dados.produtos);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const mudou = marcados.length !== dados.produtos.length || marcados.some((id) => !dados.produtos.includes(id));
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return dados.cardapio.filter((p) => marcados.includes(p.id) || !q || p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q));
  }, [dados.cardapio, busca, marcados]);

  async function salvar() {
    setSalvando(true);
    try {
      const r = await fetch("/api/store/balanca", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ produtos: marcados }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao salvar");
      onProdutos(j.produtos);
      setMarcados(j.produtos);
      onAviso({ tipo: "ok", titulo: "Produtos por quilo salvos.", detalhe: "Eles saíram do delivery, do totem, do balcão e do garçom: agora só se vendem pesando." });
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section style={cartao}>
      <h2 style={h2}>Produtos vendidos por quilo</h2>
      <p style={texto}>
        Marque o produto do self-service (ex.: “Refeição por kg”). <b>O preço dele no cardápio é o preço do quilo</b> (o do
        salão, com a promoção, se houver). Marcado, ele sai do delivery, do totem, do balcão e do garçom: só se vende pesando.
        Não tem? Crie no Cardápio e volte aqui.
      </p>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no cardápio" aria-label="Buscar no cardápio"
        style={{ marginTop: 12, width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 15, fontFamily: "inherit" }} />
      <div style={{ marginTop: 10, maxHeight: 280, overflowY: "auto", border: "1px solid #F1F5F9", borderRadius: 10 }}>
        {lista.length === 0 ? (
          <div style={{ padding: 12, color: "#64748B", fontSize: 14 }}>Nenhum produto encontrado.</div>
        ) : lista.map((p) => {
          const marcado = marcados.includes(p.id);
          return (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid #F1F5F9", cursor: "pointer", background: marcado ? "#F0FDFA" : "#fff" }}>
              <input type="checkbox" checked={marcado} style={{ width: 18, height: 18, accentColor: COR }}
                onChange={(ev) => setMarcados((m) => ev.target.checked ? [...m, p.id] : m.filter((id) => id !== p.id))} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: marcado ? 800 : 600, color: "#0F172A" }}>
                {p.nome} {p.categoria && <span style={{ color: "#94A3B8", fontWeight: 500 }}>· {p.categoria}</span>}
              </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: marcado ? COR : "#475569" }}>{reais(p.precoDoQuilo)}{marcado ? "/kg" : ""}</span>
            </label>
          );
        })}
      </div>
      <button type="button" onClick={salvar} disabled={!mudou || salvando} style={{
        marginTop: 12, width: "100%", padding: "12px", borderRadius: 12, border: "none", background: mudou ? COR : "#CBD5E1",
        color: "#fff", fontSize: 15, fontWeight: 800, cursor: mudou ? "pointer" : "default", fontFamily: "inherit",
      }}>{salvando ? "Salvando..." : "Salvar produtos por quilo"}</button>
      <p style={{ ...texto, marginTop: 8, fontSize: 12 }}>
        Desmarcou? O produto não volta sozinho para os outros canais: ligue de novo no Cardápio onde quiser vender.
      </p>
    </section>
  );
}

// ─── Equipamento (o "como funciona no salão" é o desenho de ./IlustracaoDaBalanca) ─

/** O que indicamos (pesquisa no Mercado Livre de 06/11/2026: vendedor com reputação, peça certa para a Web Serial). */
const EQUIPAMENTO: [string, string, string | null][] = [
  ["Balança Toledo Prix 3 Fit", "o kit já vem com o cabo conversor serial RS-232 da Toledo (sem ele a Prix não tem saída para o computador).",
    "https://www.mercadolivre.com.br/kit-balanca-toledo-prix-3-fit--cabo-conversor-serial-rs232/up/MLBU1732884937"],
  ["Cabo USB-serial (chip FTDI)", "liga o cabo da balança na porta USB do computador.",
    "https://www.mercadolivre.com.br/ftdi-conversor-usb-porta-com-serial-rs232-cabo-todos-sinais/up/MLBU1413538863"],
  ["Leitor de código de barras de mesa", "o cliente só encosta a comanda na frente dele, com o prato ainda na balança, e o número entra sozinho.",
    "https://www.mercadolivre.com.br/leitor-de-codigo-de-barras-fixo-pdv-usb-1d-2d-qr-code/p/MLB27764962"],
  ["Computador com Windows ao lado da balança", "um notebook simples serve, com o Chrome (ou o Edge).",
    "https://www.mercadolivre.com.br/notebook-positivo-vision-c14-lumina-bar-celeron-4gb-ram-128gb-emmc-windows-11-tela-14-polegadas-hd-antirreflexo-tecla-link-cinza/p/MLB26133653"],
  ["Comandas de PVC com código de barras", "numeradas acima das mesas da loja (ex.: 101 a 200) e com o código de barras trazendo só o número. Comanda de aproximação (chip) não serve: o leitor é de código de barras. Chegou, cadastre a mesma numeração em Mesas › ⚙️ › 🎫 Comandas.",
    "https://lista.mercadolivre.com.br/comanda-pvc-numerada-codigo-de-barras"],
];

function Equipamento() {
  return (
    <section style={cartao}>
      <h2 style={h2}>O que a loja compra</h2>
      <p style={{ ...texto, marginBottom: 8 }}>
        O FireHub não vende equipamento: estes são os que indicamos, no Mercado Livre.
      </p>
      <ol style={{ margin: 0, paddingLeft: 20, color: "#334155", fontSize: 14, lineHeight: 1.8 }}>
        {EQUIPAMENTO.map(([nome, detalhe, link]) => (
          <li key={nome}>
            <b>{nome}</b> — {detalhe}{" "}
            {link && <a href={link} target="_blank" rel="noreferrer" style={{ color: COR, fontWeight: 800 }}>Ver no Mercado Livre</a>}
          </li>
        ))}
        <li><b>Sem comprar comandas:</b> o FireHub gera os cartões para imprimir (Mesas › ⚙️ › 🎫 Comandas).</li>
      </ol>
      <p style={{ ...texto, marginTop: 8, fontSize: 13 }}>
        No tablet Android a balança só liga por um adaptador serial→Bluetooth, pareado nas configurações do Android; o
        computador com Windows é o caminho mais simples.
      </p>
      <h2 style={{ ...h2, marginTop: 16 }}>Configurar a balança</h2>
      <p style={texto}>
        De fábrica a Prix vem configurada para impressora de etiqueta. No menu da balança (ou com o técnico da Toledo),
        ligue a <b>saída serial para PDV, protocolo Toledo</b>, numa destas velocidades: 2400, 4800 ou 9600. A tela da
        balança descobre a velocidade sozinha.
      </p>
      <h2 style={{ ...h2, marginTop: 16 }}>Regras do Inmetro (Portaria 157/2022)</h2>
      <ul style={{ margin: 0, paddingLeft: 20, color: "#334155", fontSize: 14, lineHeight: 1.8 }}>
        <li>A balança precisa estar com a <b>verificação do Ipem em dia</b> (anual).</li>
        <li>O cliente tem que <b>ver o peso no visor da balança</b> enquanto pesa.</li>
        <li>A <b>tara do prato</b> é feita na própria balança, não no sistema.</li>
        <li>A tela do FireHub mostra uma cópia do peso e leva a inscrição <b>“Não verificado”</b> — o que vale é o visor da balança.</li>
      </ul>
    </section>
  );
}

// ─── Termo ───────────────────────────────────────────────────────────────

function Termo({ preco, diasDeTeste, comTeste, salvando, onCancelar, onAceitar }: {
  preco: number; diasDeTeste: number; comTeste: boolean; salvando: boolean; onCancelar: () => void; onAceitar: () => void;
}) {
  const [concordo, setConcordo] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DA_BALANCA}
      onClick={(ev) => { if (ev.target === ev.currentTarget && !salvando) onCancelar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", paddingBottom: 16 }}>
        <div style={{ padding: "18px 20px 0" }}>
          <strong style={{ fontSize: 17 }}>{TITULO_DO_TERMO_DA_BALANCA}</strong>
          <div style={{ fontSize: 13, color: "#64748B" }}>{reais(preco)} por mês · versão de {VERSAO_DO_TERMO_DA_BALANCA.split("-").reverse().join("/")}</div>
        </div>
        <ResumoDaCobranca preco={preco} diasDeTeste={diasDeTeste} comTeste={comTeste} />
        <ol style={{ margin: "14px 20px 0", paddingLeft: 20, fontSize: 13.5, color: "#334155", lineHeight: 1.6 }}>
          {CLAUSULAS_DO_TERMO_DA_BALANCA.map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{c}</li>)}
        </ol>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "14px 20px 0", fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
          <input type="checkbox" checked={concordo} onChange={(ev) => setConcordo(ev.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
          Li e concordo com o termo e autorizo a cobrança de {reais(preco)} por mês no boleto do FireHub, à parte da mensalidade.
        </label>
        <div style={{ display: "flex", gap: 10, margin: "16px 20px 0" }}>
          <button type="button" onClick={onCancelar} disabled={salvando} style={{ flex: 1, padding: 12, borderRadius: 12, border: "1px solid #CBD5E1", background: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Agora não</button>
          <button type="button" onClick={onAceitar} disabled={!concordo || salvando} style={{ flex: 2, padding: 12, borderRadius: 12, border: "none", background: concordo ? COR : "#CBD5E1", color: "#fff", fontWeight: 900, cursor: concordo ? "pointer" : "default", fontFamily: "inherit" }}>
            {salvando ? "Ativando…" : "Concordo e ativar"}
          </button>
        </div>
      </div>
    </div>
  );
}
