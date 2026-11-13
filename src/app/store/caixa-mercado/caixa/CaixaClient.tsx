"use client";

/**
 * A FRENTE DE CAIXA DO MERCADO, em tela cheia (lib/caixa-mercado).
 *
 * Inspirada no EvoPDV: lista grande, total gigante, campo de leitura SEMPRE
 * focado (o leitor USB é um teclado: digita o EAN e um Enter) e tudo no
 * teclado, com a legenda das teclas no rodapé:
 *   F1 ajuda · F2 buscar por nome · F3 quantidade · F4 balança · F6 desconto ·
 *   F7 cancelar item (senha do gerente) · F8 CPF na nota · F9 turno (sangria,
 *   suprimento, fechar) · F10/F12 finalizar · Esc limpa/fecha · ↑↓ escolhe item.
 * No campo: "3*789…" = 3 unidades; "0,452*123" = 452 g de um produto por quilo.
 *
 * O servidor confere tudo de novo (preço, quantidade, pagamentos): a tela só
 * mostra a conta, com as mesmas funções em centavos (lib/caixa-mercado/conta.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import { comSenhaDoGerente, useSenhaDoGerente } from "@/components/SenhaDoGerente";
import { conferirPagamentos, lerEntrada, problemaDaQuantidade, reais, valorDoItem, kg3, type FormaDoCaixa, type Unidade } from "@/lib/caixa-mercado/conta";
import { ETIQUETA_PADRAO, lerEtiqueta, type FormatoDaEtiqueta } from "@/lib/caixa-mercado/etiqueta";
import { LeitorDaBalanca, PortaSimulada, conectarNaBalanca, serialDoNavegador, type PortaSerial } from "@/lib/balanca/leitor-serial";
import { pesoFirme, textoDoPeso, type LeituraDaBalanca } from "@/lib/balanca/protocolo-toledo";
import { acharTef, chamarTef } from "@/lib/tef-no-assistente";

type Produto = { id: string; nome: string; precoCentavos: number; unidade: Unidade; eans: string[]; plu: string | null; ativo: boolean };
type Item = { uid: number; produtoId: string; nome: string; codigo: string; unidade: Unidade; quantidade: number; precoCentavos: number; totalCentavos: number; valorDaEtiquetaCentavos?: number };
type Pagamento = { forma: FormaDoCaixa; valorCentavos: number };
type Turno = { id: string; operador: string; abertoEm: string; fundoCentavos: number };
type Resumo = { vendas: number; totalVendidoCentavos: number; porForma: Record<string, number>; esperado: Record<string, number>; movimentos: { tipo: string; valorCentavos: number; descricao: string | null }[] };
type Modal =
  | null | "busca" | "pagamento" | "pix" | "tef" | "sucesso" | "abrir" | "turno" | "fechar" | "desconto" | "cpf" | "ajuda" | "peso" | "quantidade" | "cancelar" | "novo";

const NOME_DA_FORMA: Record<FormaDoCaixa, string> = {
  DINHEIRO: "Dinheiro", PIX: "Pix", TEF: "Cartão no pinpad", CREDITO: "Crédito (maquininha)", DEBITO: "Débito (maquininha)", VALE: "Vale-alimentação",
};
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** "12,50" / "12.5" / "1250" (sem vírgula = reais inteiros) → centavos. */
const centavosDoTexto = (t: string): number | null => {
  const s = String(t || "").trim().replace(/[R$\s]/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const doTexto = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export default function CaixaClient({ simularBalanca }: { simularBalanca: boolean }) {
  const { pedirSenha, modalDaSenha } = useSenhaDoGerente();
  const [erroGeral, setErroGeral] = useState<{ texto: string; codigo?: string } | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [etiqueta, setEtiqueta] = useState<FormatoDaEtiqueta>(ETIQUETA_PADRAO);
  const [temPix, setTemPix] = useState(false);
  const [fiscalLigado, setFiscalLigado] = useState(false);
  const [emitirNfce, setEmitirNfce] = useState(false);
  const [nomeDaLoja, setNomeDaLoja] = useState("");
  const [terminal, setTerminal] = useState<{ nome: string } | null>(null);
  const [operador, setOperador] = useState("");
  const [segredoTef, setSegredoTef] = useState<string | null>(null);
  const [portaTef, setPortaTef] = useState<number | null>(null);
  const [turno, setTurno] = useState<Turno | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);

  const [itens, setItens] = useState<Item[]>([]);
  const [cancelados, setCancelados] = useState<{ nome: string; quantidade: number; valorCentavos: number; em: string; autorizadoPor: string | null }[]>([]);
  const [selecionado, setSelecionado] = useState(-1);
  const [entrada, setEntrada] = useState("");
  const [multiplicador, setMultiplicador] = useState<number | null>(null);
  const [descontoCentavos, setDescontoCentavos] = useState(0);
  const [cpf, setCpf] = useState("");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [campoModal, setCampoModal] = useState("");
  const [campoModal2, setCampoModal2] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaSel, setBuscaSel] = useState(0);
  const [pesoPara, setPesoPara] = useState<Produto | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [pixTxid, setPixTxid] = useState<string | null>(null);
  const [pix, setPix] = useState<{ brcode: string; txid: string; qr: string; valorCentavos: number; titular: string } | null>(null);
  const [tef, setTef] = useState<{ orderId: string; valorCentavos: number; fase: string; mensagem: string; pergunta: any; transacaoId: string | null; final: boolean } | null>(null);
  const [sucesso, setSucesso] = useState<{ numero: number | null; trocoCentavos: number; totalCentavos: number; nota: string | null } | null>(null);
  const [fechamento, setFechamento] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);
  const [balanca, setBalanca] = useState<"desligada" | "conectando" | "conectada" | "caiu">("desligada");
  const [pesoSimulado, setPesoSimulado] = useState("0,452");
  // Código bipado que não existe: cadastra ali mesmo (com a senha do gerente) e já lança.
  const [novo, setNovo] = useState<{ codigo: string; nome: string; preco: string; unidade: "UN" | "KG"; quantidade: number | null } | null>(null);

  const campoRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLInputElement>(null);
  const leitorRef = useRef<LeitorDaBalanca | null>(null);
  const simuladaRef = useRef<PortaSimulada | null>(null);
  const uidRef = useRef(1);
  const listaRef = useRef<HTMLDivElement>(null);

  const avisar = useCallback((ok: boolean, texto: string) => { setAviso({ ok, texto }); setTimeout(() => setAviso((a) => (a?.texto === texto ? null : a)), 5000); }, []);

  // ── Carga ──────────────────────────────────────────────────────────────
  const carregarTurno = useCallback(async () => {
    const r = await fetch("/api/store/caixa-mercado/turno", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setTurno(d.turno);
    setResumo(d.resumo);
    if (!d.turno) { setCampoModal("0,00"); setModal("abrir"); }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await fetch("/api/store/caixa-mercado/terminal", { cache: "no-store" });
      const td = await t.json().catch(() => ({}));
      if (!t.ok) { setErroGeral({ texto: td?.error || "Não deu para abrir o caixa.", codigo: td?.codigo }); return; }
      if (!td.terminal) { setErroGeral({ texto: "Este computador não está registrado como caixa. O dono registra em Caixa de mercado.", codigo: "SEM_TERMINAL" }); return; }
      setTerminal(td.terminal);
      setOperador(td.quem?.nome || "");
      if (td.tef?.ligado && td.tef.segredoLocal) setSegredoTef(td.tef.segredoLocal);
      const c = await fetch("/api/store/caixa-mercado/catalogo", { cache: "no-store" });
      const cd = await c.json().catch(() => ({}));
      if (!c.ok) { setErroGeral({ texto: cd?.error || "Não deu para carregar os produtos." }); return; }
      setProdutos(cd.produtos || []);
      setEtiqueta(cd.config?.etiqueta || ETIQUETA_PADRAO);
      setEmitirNfce(Boolean(cd.config?.emitirNfce) && Boolean(cd.fiscalLigado));
      setFiscalLigado(Boolean(cd.fiscalLigado));
      setTemPix(Boolean(cd.pix));
      setNomeDaLoja(cd.loja || "");
      await carregarTurno();
    })();
  }, [carregarTurno]);

  // O pinpad deste computador (o Assistente com o segredo do pareamento).
  useEffect(() => {
    if (!segredoTef) return;
    acharTef(segredoTef).then((r) => setPortaTef(r && r.status?.pronto !== false ? r.porta : null)).catch(() => setPortaTef(null));
  }, [segredoTef]);

  // ── Balança ────────────────────────────────────────────────────────────
  const conectar = useCallback(async (porta: PortaSerial) => {
    setBalanca("conectando");
    const leitor = await conectarNaBalanca(porta);
    if (!leitor) { setBalanca("caiu"); return; }
    leitorRef.current = leitor;
    setBalanca("conectada");
  }, []);
  useEffect(() => {
    if (simularBalanca) {
      const p = new PortaSimulada();
      simuladaRef.current = p;
      void conectar(p);
      return () => { void leitorRef.current?.fechar(); };
    }
    const serial = serialDoNavegador();
    serial?.getPorts().then((portas) => { if (portas[0]) void conectar(portas[0]); }).catch(() => {});
    return () => { void leitorRef.current?.fechar(); };
  }, [simularBalanca, conectar]);

  async function escolherBalanca() {
    const serial = serialDoNavegador();
    if (!serial) return avisar(false, "Este navegador não lê balança. Use o Chrome ou o Edge no computador.");
    try {
      await leitorRef.current?.fechar();
      await conectar(await serial.requestPort());
    } catch { /* cancelou a escolha */ }
  }

  async function lerPesoFirme(): Promise<number | null> {
    const leitor = leitorRef.current;
    if (!leitor) return null;
    const ultimas: LeituraDaBalanca[] = [];
    const fim = Date.now() + 5000;
    while (Date.now() < fim) {
      const l = await leitor.pedirPeso();
      if (l) {
        ultimas.push(l);
        const p = pesoFirme(ultimas);
        if (p) return p;
      }
      await dormir(250);
    }
    return null;
  }

  // ── Produtos e códigos ────────────────────────────────────────────────
  const indices = useMemo(() => {
    const porEan = new Map<string, Produto>();
    const porPlu = new Map<string, Produto>();
    for (const p of produtos) {
      for (const e of p.eans) porEan.set(e, p);
      if (p.plu) porPlu.set(p.plu, p);
    }
    return { porEan, porPlu };
  }, [produtos]);

  const subtotal = itens.reduce((s, i) => s + i.totalCentavos, 0);
  const total = Math.max(0, subtotal - descontoCentavos);
  const pago = pagamentos.reduce((s, p) => s + p.valorCentavos, 0);
  const restante = Math.max(0, total - pago);

  function adicionar(p: Produto, quantidade: number, codigo: string, etiquetaCentavos?: number) {
    if (!p.ativo || p.precoCentavos <= 0) return avisar(false, `"${p.nome}" está sem preço ou inativo no cadastro.`);
    if (etiquetaCentavos == null) {
      const problema = problemaDaQuantidade(p.unidade, quantidade);
      if (problema) return avisar(false, problema);
    }
    const q = p.unidade === "KG" ? kg3(quantidade) : quantidade;
    const totalCentavos = etiquetaCentavos ?? valorDoItem(p.unidade, q, p.precoCentavos);
    setItens((atual) => {
      const ultimo = atual[atual.length - 1];
      // Bipou o mesmo produto por unidade de novo: soma na mesma linha.
      if (ultimo && p.unidade === "UN" && etiquetaCentavos == null && ultimo.produtoId === p.id && ultimo.valorDaEtiquetaCentavos == null) {
        const novo = { ...ultimo, quantidade: ultimo.quantidade + q, totalCentavos: valorDoItem("UN", ultimo.quantidade + q, p.precoCentavos) };
        setSelecionado(atual.length - 1);
        return [...atual.slice(0, -1), novo];
      }
      setSelecionado(atual.length);
      return [...atual, { uid: uidRef.current++, produtoId: p.id, nome: p.nome, codigo, unidade: p.unidade, quantidade: etiquetaCentavos != null ? kg3(etiquetaCentavos / p.precoCentavos) : q, precoCentavos: p.precoCentavos, totalCentavos, ...(etiquetaCentavos != null ? { valorDaEtiquetaCentavos: etiquetaCentavos } : {}) }];
    });
  }

  async function pesarEAdicionar(p: Produto, codigo: string) {
    if (!leitorRef.current) { setPesoPara(p); setCampoModal(""); setModal("peso"); return; }
    setOcupado(true);
    avisar(true, `Pesando ${p.nome}…`);
    const kg = await lerPesoFirme();
    setOcupado(false);
    if (!kg) { setPesoPara(p); setCampoModal(""); setModal("peso"); return avisar(false, "A balança não firmou o peso. Digite o peso ou pese de novo."); }
    adicionar(p, kg, codigo);
  }

  function lancarEntrada(texto: string) {
    if (!turno) { setCampoModal("0,00"); setModal("abrir"); return; }
    const e = lerEntrada(texto);
    if (!e) return;
    const quantidade = e.quantidade ?? multiplicador;
    setMultiplicador(null);
    const c = e.codigo.replace(/\s/g, "");
    const digitos = /^\d+$/.test(c);
    const produto = indices.porEan.get(c) ?? (digitos ? indices.porEan.get(c.padStart(13, "0")) ?? indices.porEan.get(c.replace(/^0+/, "")) : undefined);
    if (produto) {
      if (produto.unidade === "KG" && quantidade == null) return void pesarEAdicionar(produto, c);
      return adicionar(produto, quantidade ?? 1, c);
    }
    const etq = digitos ? lerEtiqueta(c, etiqueta) : null;
    if (etq) {
      const p = indices.porPlu.get(etq.plu);
      if (!p) return avisar(false, `Etiqueta da balança com o código ${etq.plu}: nenhum produto com esse PLU.`);
      if (etq.precoCentavos != null) return adicionar(p, 1, c, etq.precoCentavos);
      return adicionar(p, (etq.pesoGramas ?? 0) / 1000, c);
    }
    const plu = digitos ? indices.porPlu.get(String(Number(c))) : undefined;
    if (plu) {
      if (plu.unidade === "KG" && quantidade == null) return void pesarEAdicionar(plu, c);
      return adicionar(plu, quantidade ?? 1, c);
    }
    // Não é código: abre a busca com o texto.
    setBusca(digitos ? "" : e.codigo);
    setBuscaSel(0);
    if (digitos) { setNovo({ codigo: c, nome: "", preco: "", unidade: "UN", quantidade }); return setModal("novo"); }
    setModal("busca");
  }

  async function salvarNovo() {
    if (!novo || ocupado) return;
    const precoCentavos = centavosDoTexto(novo.preco);
    if (!novo.nome.trim()) return avisar(false, "Escreva o nome do produto.");
    if (!precoCentavos) return avisar(false, "Informe o preço de venda.");
    setOcupado(true);
    const corpo = JSON.stringify({ nome: novo.nome, codigo: novo.codigo, precoCentavos, unidade: novo.unidade });
    const r = await comSenhaDoGerente((cab) => fetch("/api/store/caixa-mercado/produto?de=caixa", { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: corpo }), pedirSenha)
      .finally(() => setOcupado(false));
    if (!r) return;
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return avisar(false, d?.error || "Não deu para cadastrar.");
    const c = await fetch("/api/store/caixa-mercado/catalogo", { cache: "no-store" });
    const cd = await c.json().catch(() => ({}));
    const lista: Produto[] = c.ok ? cd.produtos || [] : produtos;
    setProdutos(lista);
    const p = lista.find((x) => x.eans.includes(novo.codigo));
    const { codigo, quantidade } = novo;
    setNovo(null);
    setModal(null);
    avisar(true, d.criado ? `Produto cadastrado: ${novo.nome}.` : `Código ligado ao produto que já existia com esse nome.`);
    if (!p) return;
    if (p.unidade === "KG" && quantidade == null) return void pesarEAdicionar(p, codigo);
    adicionar(p, quantidade ?? 1, codigo);
  }

  const resultadosDaBusca = useMemo(() => {
    const t = semAcento(busca.trim());
    if (!t) return produtos.filter((p) => p.ativo).slice(0, 40);
    const partes = t.split(/\s+/);
    return produtos.filter((p) => p.ativo && partes.every((x) => semAcento(p.nome).includes(x))).slice(0, 40);
  }, [busca, produtos]);

  // ── Finalizar ─────────────────────────────────────────────────────────
  function abrirPagamento() {
    if (!turno) { setCampoModal("0,00"); setModal("abrir"); return; }
    if (itens.length === 0) return avisar(false, "Nenhum item na venda.");
    setPagamentos([]);
    setPixTxid(null);
    setCampoModal(doTexto(total));
    setModal("pagamento");
  }

  async function escolherForma(forma: FormaDoCaixa) {
    const valor = centavosDoTexto(campoModal) ?? restante;
    if (valor <= 0) return avisar(false, "Digite o valor.");
    if (forma !== "DINHEIRO" && valor > restante) return avisar(false, "Cartão, Pix e vale não dão troco: o valor passou do que falta.");
    if (forma === "PIX") {
      if (!temPix) return avisar(false, "A loja não tem chave Pix. Cadastre em Chatbot IA › Chave Pix da loja.");
      setOcupado(true);
      const r = await fetch("/api/store/caixa-mercado/pix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valorCentavos: valor }) });
      const d = await r.json().catch(() => ({}));
      setOcupado(false);
      if (!r.ok) return avisar(false, d?.error || "Não deu para gerar o Pix.");
      const qr = await QRCode.toDataURL(d.brcode, { margin: 1, width: 320 });
      setPix({ brcode: d.brcode, txid: d.txid, qr, valorCentavos: valor, titular: d.titular });
      setModal("pix");
      return;
    }
    const novos = [...pagamentos, { forma, valorCentavos: valor }];
    if (forma === "TEF") return void finalizar(novos);
    setPagamentos(novos);
    const falta = total - novos.reduce((s, p) => s + p.valorCentavos, 0);
    if (falta <= 0) return void finalizar(novos);
    setCampoModal(doTexto(falta));
  }

  function pixRecebido() {
    if (!pix) return;
    const novos = [...pagamentos, { forma: "PIX" as const, valorCentavos: pix.valorCentavos }];
    setPixTxid(pix.txid);
    setPix(null);
    setPagamentos(novos);
    const falta = total - novos.reduce((s, p) => s + p.valorCentavos, 0);
    if (falta <= 0) return void finalizar(novos, pix.txid);
    setCampoModal(doTexto(falta));
    setModal("pagamento");
  }

  async function finalizar(lista: Pagamento[], txid: string | null = pixTxid) {
    const c = conferirPagamentos(total, lista);
    if (!c.ok) return avisar(false, c.erro);
    if (c.tefCentavos > 0 && (!segredoTef || !portaTef)) return avisar(false, "O pinpad (TEF) não está pronto neste computador. Use a maquininha manual ou ligue o TEF no módulo.");
    setOcupado(true);
    const corpo = {
      itens: itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, valorDaEtiquetaCentavos: i.valorDaEtiquetaCentavos ?? null })),
      descontoCentavos,
      pagamentos: lista,
      pixTxid: txid,
      cpfCnpj: cpf || null,
      itensCancelados: cancelados,
    };
    let r: Response | null;
    try {
      r = await comSenhaDoGerente((cab) => fetch("/api/store/caixa-mercado/venda", { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(corpo) }), pedirSenha);
    } catch {
      setOcupado(false);
      return avisar(false, "Sem conexão: a venda NÃO foi gravada. Tente de novo.");
    }
    setOcupado(false);
    if (!r) return avisar(false, "Venda não gravada: o desconto precisa da senha do gerente.");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return avisar(false, d?.error || "A venda não foi gravada.");
    if (d.situacao === "AGUARDANDO_TEF") return void cobrarNoPinpad(d.orderId, d.tefCentavos);
    await concluida(d.orderId, d.numero, d.trocoCentavos, d.totalCentavos);
  }

  async function cobrarNoPinpad(orderId: string, valorCentavos: number, forma?: "credito" | "debito") {
    setTef({ orderId, valorCentavos, fase: "iniciando", mensagem: "Enviando o valor ao pinpad…", pergunta: null, transacaoId: null, final: false });
    setModal("tef");
    const r = await chamarTef(portaTef!, segredoTef!, "/tef/venda", { metodo: "POST", corpo: { pedidoId: orderId, valorCentavos, ...(forma ? { forma } : {}) } });
    if (!r.ok) {
      setTef((t) => t && { ...t, fase: "erro", final: true, mensagem: r.dados?.error || (r.foraDoAr ? "O Assistente FireHub não respondeu neste computador." : "O pinpad não aceitou.") });
      return;
    }
    const id = String(r.dados?.id || "");
    setTef((t) => t && { ...t, transacaoId: id });
    for (let i = 0; i < 600; i++) {
      await dormir(500);
      const e = await chamarTef(portaTef!, segredoTef!, `/tef/estado?id=${encodeURIComponent(id)}`);
      if (!e.ok) continue;
      setTef((t) => t && { ...t, fase: e.dados.fase, mensagem: e.dados.mensagem, pergunta: e.dados.pergunta, final: e.dados.final });
      if (!e.dados.final) continue;
      if (e.dados.fase === "aprovado") {
        // Quem diz que está pago é o servidor (a venda já foi gravada e confirmada).
        for (let k = 0; k < 40; k++) {
          const s = await fetch(`/api/store/caixa-mercado/venda?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" });
          const sd = await s.json().catch(() => ({}));
          if (s.ok && sd.situacao === "CONCLUIDA") {
            setTef(null);
            const troco = pagamentos.reduce((x, p) => x + p.valorCentavos, 0) + valorCentavos - total;
            await concluida(orderId, sd.numero, Math.max(0, troco), total);
            return;
          }
          await dormir(500);
        }
        setTef((t) => t && { ...t, fase: "erro", final: true, mensagem: "O pinpad aprovou, mas o servidor ainda não confirmou. Não cobre de novo: confira em Pedidos." });
      }
      return;
    }
  }

  async function responderTef(valor: string | null) {
    if (!tef?.transacaoId) return;
    await chamarTef(portaTef!, segredoTef!, "/tef/responder", { metodo: "POST", corpo: { id: tef.transacaoId, valor } });
  }

  async function cancelarNoPinpad() {
    await chamarTef(portaTef!, segredoTef!, "/tef/cancelar", { metodo: "POST" });
  }

  async function desistirDoTef(acao: "outra" | "cancelar") {
    if (!tef) return;
    if (acao === "cancelar") {
      const r = await fetch("/api/store/caixa-mercado/venda", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: tef.orderId, cancelar: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return avisar(false, d?.error || "Não deu para cancelar.");
      setTef(null);
      setModal(null);
      return avisar(true, "Pagamento no pinpad cancelado. A venda continua na tela.");
    }
    // Outra forma: o pedido já existe; as formas novas vão pelo PATCH.
    setPendenteTef(tef.orderId);
    setTef(null);
    setCampoModal(doTexto(restante));
    setModal("pagamento");
  }
  const [pendenteTef, setPendenteTef] = useState<string | null>(null);

  async function finalizarPendente(lista: Pagamento[]) {
    if (!pendenteTef) return;
    const c = conferirPagamentos(total, lista);
    if (!c.ok) return avisar(false, c.erro);
    setOcupado(true);
    const r = await fetch("/api/store/caixa-mercado/venda", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: pendenteTef, pagamentos: lista }) });
    const d = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) return avisar(false, d?.error || "Não deu certo.");
    const orderId = pendenteTef;
    setPendenteTef(null);
    if (d.situacao === "AGUARDANDO_TEF") return void cobrarNoPinpad(orderId, d.tefCentavos);
    await concluida(orderId, d.numero, d.trocoCentavos, total);
  }

  async function concluida(orderId: string, numero: number | null, trocoCentavos: number, totalCentavos: number) {
    let nota: string | null = null;
    setSucesso({ numero, trocoCentavos, totalCentavos, nota: emitirNfce ? "Emitindo a NFC-e…" : null });
    setModal("sucesso");
    const doc = cpf;
    setItens([]); setCancelados([]); setSelecionado(-1); setDescontoCentavos(0); setCpf(""); setPagamentos([]); setPixTxid(null); setEntrada("");
    void carregarTurno();
    if (emitirNfce) {
      const r = await fetch("/api/store/fiscal/emitir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, ...(doc ? { cpfCnpj: doc } : {}) }) }).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      nota = r?.ok ? (d?.mensagem || d?.message || "NFC-e enviada. Acompanhe em Fiscal.") : `NFC-e não saiu: ${d?.mensagem || d?.error || "sem conexão"}. Emita depois em Pedidos.`;
      setSucesso((s) => s && { ...s, nota });
    }
  }

  // ── Itens: cancelar, quantidade, desconto ─────────────────────────────
  async function cancelarItem() {
    const i = itens[selecionado];
    if (!i || ocupado) return;
    // Ocupado: o Enter da janela da senha não pode chegar de novo aqui.
    setOcupado(true);
    const r = await comSenhaDoGerente((cab) => fetch("/api/store/caixa-mercado/senha", { method: "POST", headers: cab }), pedirSenha).finally(() => setOcupado(false));
    if (!r) return setModal(null);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return avisar(false, d?.error || "Senha não conferiu.");
    setCancelados((c) => [...c, { nome: i.nome, quantidade: i.quantidade, valorCentavos: i.totalCentavos, em: new Date().toISOString(), autorizadoPor: d.livre ? null : "senha do gerente" }]);
    setItens((lista) => lista.filter((x) => x.uid !== i.uid));
    setSelecionado((s) => Math.max(-1, Math.min(s, itens.length - 2)));
    setModal(null);
    avisar(true, `Item cancelado: ${i.nome}.`);
  }

  // ── Turno ─────────────────────────────────────────────────────────────
  async function acaoDoTurno(corpo: Record<string, unknown>) {
    setOcupado(true);
    const r = await fetch("/api/store/caixa-mercado/turno", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const d = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) { avisar(false, d?.error || "Não deu certo."); return null; }
    return d;
  }

  // ── Teclado ───────────────────────────────────────────────────────────
  const teclas = useRef<(e: KeyboardEvent) => void>(() => {});
  teclas.current = (e: KeyboardEvent) => {
    const k = e.key;
    if (/^F\d+$/.test(k)) e.preventDefault();
    if (k === "F11") return alternarTelaCheia();
    if (sempreTelaCheia && !document.fullscreenElement) entrarTelaCheia();
    // A janela da senha do gerente cuida das teclas dela (o Enter não pode finalizar nada por baixo).
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (ocupado && k !== "Escape") return;
    if (modal === null) {
      if (k === "F1") return setModal("ajuda");
      if (k === "F2") { setBusca(""); setBuscaSel(0); return setModal("busca"); }
      if (k === "F3") { setCampoModal(""); return setModal("quantidade"); }
      if (k === "F4") return void escolherBalanca();
      if (k === "F6") { if (!itens.length) return; setCampoModal(""); setCampoModal2(""); return setModal("desconto"); }
      if (k === "F7") { if (selecionado < 0) return avisar(false, "Escolha o item com ↑ ↓."); return setModal("cancelar"); }
      if (k === "F8") { setCampoModal(cpf); return setModal("cpf"); }
      if (k === "F9") { if (!turno) return; void carregarTurno(); setCampoModal(""); setCampoModal2(""); return setModal("turno"); }
      if (k === "F10" || k === "F12") return abrirPagamento();
      if (k === "ArrowUp") { e.preventDefault(); return setSelecionado((s) => Math.max(0, s - 1)); }
      if (k === "ArrowDown") { e.preventDefault(); return setSelecionado((s) => Math.min(itens.length - 1, s + 1)); }
      if (k === "Escape") { setEntrada(""); setMultiplicador(null); return; }
      return;
    }
    if (k === "Escape") {
      if (modal === "abrir" || modal === "tef") return;
      if (modal === "pix") { setPix(null); setModal("pagamento"); return; }
      if (modal === "sucesso") { setSucesso(null); setModal(null); return; }
      setModal(null);
      return;
    }
    if (modal === "pagamento") {
      const atalhos: Record<string, FormaDoCaixa> = { "1": "DINHEIRO", "2": "PIX", "3": "TEF", "4": "CREDITO", "5": "DEBITO", "6": "VALE" };
      if (e.altKey && atalhos[k]) { e.preventDefault(); return void (pendenteTef ? escolherFormaPendente(atalhos[k]) : escolherForma(atalhos[k])); }
      if (k === "Enter") { e.preventDefault(); return void (pendenteTef ? escolherFormaPendente("DINHEIRO") : escolherForma("DINHEIRO")); }
    }
    if (modal === "pix" && k === "Enter") { e.preventDefault(); return pixRecebido(); }
    if (modal === "sucesso" && k === "Enter") { e.preventDefault(); setSucesso(null); setModal(null); return; }
    if (modal === "cancelar" && k === "Enter") { e.preventDefault(); return void cancelarItem(); }
    if (modal === "busca") {
      if (k === "ArrowDown") { e.preventDefault(); return setBuscaSel((s) => Math.min(resultadosDaBusca.length - 1, s + 1)); }
      if (k === "ArrowUp") { e.preventDefault(); return setBuscaSel((s) => Math.max(0, s - 1)); }
      if (k === "Enter") {
        e.preventDefault();
        const p = resultadosDaBusca[buscaSel];
        if (!p) return;
        setModal(null);
        const q = multiplicador;
        setMultiplicador(null);
        if (p.unidade === "KG" && q == null) return void pesarEAdicionar(p, p.eans[0] || p.plu || "");
        return adicionar(p, q ?? 1, p.eans[0] || p.plu || "");
      }
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => teclas.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  async function escolherFormaPendente(forma: FormaDoCaixa) {
    const valor = centavosDoTexto(campoModal) ?? restante;
    const novos = [...pagamentos, { forma, valorCentavos: valor }];
    if (forma === "PIX") return avisar(false, "Para Pix, cancele o pinpad e lance a venda de novo.");
    setPagamentos(novos);
    if (forma === "TEF" || total - novos.reduce((s, p) => s + p.valorCentavos, 0) <= 0) return void finalizarPendente(novos);
    setCampoModal(doTexto(total - novos.reduce((s, p) => s + p.valorCentavos, 0)));
  }

  // O campo do código fica sempre com o foco; o do modal, quando há modal.
  useEffect(() => {
    const t = setTimeout(() => (modal ? modalRef.current?.focus() : campoRef.current?.focus()), 30);
    return () => clearTimeout(t);
  }, [modal, itens.length, ocupado]);
  useEffect(() => { listaRef.current?.querySelector(`[data-i="${selecionado}"]`)?.scrollIntoView({ block: "nearest" }); }, [selecionado]);

  // ── Tela cheia, como o EvoPDV: só o caixa na tela, sem abas, barra de endereço
  // nem barra do Windows (Douglas, 13/11). O navegador só entra com um gesto do
  // operador, então entra no primeiro clique/tecla quando "sempre" está ligado.
  // Em tela cheia o Esc fica com o caixa (limpar o campo); para sair, segura o Esc.
  const [telaCheia, setTelaCheia] = useState(false);
  const [sempreTelaCheia, setSempreTelaCheia] = useState(true);
  useEffect(() => {
    try { setSempreTelaCheia(localStorage.getItem("fh-caixa-tela-cheia") !== "nao"); } catch {}
    const mudou = () => {
      const cheia = Boolean(document.fullscreenElement);
      setTelaCheia(cheia);
      const teclado = (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
      if (cheia) teclado?.lock?.(["Escape", "F11"]).catch(() => {});
      else teclado?.unlock?.();
    };
    document.addEventListener("fullscreenchange", mudou);
    mudou();
    return () => document.removeEventListener("fullscreenchange", mudou);
  }, []);
  function entrarTelaCheia() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  }
  function alternarTelaCheia() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else entrarTelaCheia();
  }
  function mudarSempre(v: boolean) {
    setSempreTelaCheia(v);
    try { localStorage.setItem("fh-caixa-tela-cheia", v ? "sim" : "nao"); } catch {}
    if (v) entrarTelaCheia();
  }

  // ── Tela ──────────────────────────────────────────────────────────────
  if (erroGeral) {
    return (
      <div style={S.tela}>
        <div style={{ margin: "auto", maxWidth: 560, textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 26 }}>Caixa de mercado</h1>
          <p style={{ color: "#CBD5E1", fontSize: 17 }}>{erroGeral.texto}</p>
          <a href="/store/caixa-mercado" style={{ ...S.botao, display: "inline-block", marginTop: 16, textDecoration: "none" }}>Ir para o módulo</a>
        </div>
      </div>
    );
  }

  const ultimo = itens[itens.length - 1];
  const legenda: [string, string][] = [["F1", "Ajuda"], ["F2", "Buscar"], ["F3", "Quantidade"], ["F4", "Balança"], ["F6", "Desconto"], ["F7", "Cancelar item"], ["F8", "CPF"], ["F9", "Turno"], ["F10", "Finalizar"]];

  return (
    <div style={S.tela} onMouseUp={() => { if (sempreTelaCheia) entrarTelaCheia(); if (!modal) setTimeout(() => campoRef.current?.focus(), 0); }}>
      {/* O selo da extensão do prazo do iFood não tem nada a ver com o caixa do mercado. */}
      <style>{"#firehub-corner-pill{display:none!important}"}</style>
      {modalDaSenha}
      {aviso && <div style={{ ...S.aviso, background: aviso.ok ? "#065F46" : "#991B1B" }} onClick={() => setAviso(null)}>{aviso.texto}</div>}

      <header style={S.topo}>
        <strong style={{ fontSize: 18 }}>{nomeDaLoja || "FireHub"} · {terminal?.nome}</strong>
        <span style={S.etiq}>Operador: {turno?.operador || operador || "—"}</span>
        <span style={S.etiq}>{turno ? `Turno desde ${new Date(turno.abertoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Turno fechado"}</span>
        <span style={{ ...S.etiq, background: balanca === "conectada" ? "#065F46" : "#374151" }}>Balança: {simularBalanca ? "simulada" : balanca}</span>
        <span style={{ ...S.etiq, background: portaTef ? "#065F46" : "#374151" }}>TEF: {segredoTef ? (portaTef ? "pronto" : "sem Assistente") : "maquininha manual"}</span>
        <span style={{ ...S.etiq, background: temPix ? "#065F46" : "#374151" }}>Pix: {temPix ? "chave ok" : "sem chave"}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={alternarTelaCheia} style={{ ...S.etiq, border: 0, cursor: "pointer", background: telaCheia ? "#374151" : "#EA580C", color: "#fff", fontWeight: 800 }}>
          {telaCheia ? "Sair da tela cheia (F11)" : "⛶ Tela cheia (F11)"}
        </button>
        <label style={{ display: "flex", gap: 4, alignItems: "center", color: "#94A3B8", fontSize: 12 }}>
          <input type="checkbox" checked={sempreTelaCheia} onChange={(e) => mudarSempre(e.target.checked)} /> sempre
        </label>
        <a href="/store/caixa-mercado" style={{ color: "#94A3B8", fontSize: 13 }}>sair</a>
      </header>

      <main style={S.corpo}>
        <section style={S.esquerda}>
          <div style={S.ultimo}>
            {ultimo ? (
              <>
                <div style={{ fontSize: 14, color: "#94A3B8" }}>ÚLTIMO ITEM</div>
                <div style={{ fontSize: 26, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ultimo.nome}</div>
                <div style={{ fontSize: 20 }}>{ultimo.unidade === "KG" ? textoDoPeso(ultimo.quantidade) : `${ultimo.quantidade} un`} × {reais(ultimo.precoCentavos)}{ultimo.unidade === "KG" ? "/kg" : ""} = <strong>{reais(ultimo.totalCentavos)}</strong></div>
              </>
            ) : <div style={{ fontSize: 22, color: "#94A3B8" }}>CAIXA LIVRE — bipe o primeiro produto</div>}
          </div>
          <div style={S.lista} ref={listaRef}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16 }}>
              <thead><tr style={{ color: "#64748B", textAlign: "left" }}><th style={S.th}>#</th><th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={{ ...S.th, textAlign: "right" }}>Qtd</th><th style={{ ...S.th, textAlign: "right" }}>Unit.</th><th style={{ ...S.th, textAlign: "right" }}>Total</th></tr></thead>
              <tbody>
                {itens.map((i, n) => (
                  <tr key={i.uid} data-i={n} onClick={() => setSelecionado(n)} style={{ background: n === selecionado ? "#DBEAFE" : n % 2 ? "#F8FAFC" : "#fff", cursor: "pointer" }}>
                    <td style={S.td}>{n + 1}</td>
                    <td style={{ ...S.td, color: "#64748B", fontFamily: "monospace" }}>{i.codigo}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{i.nome}{i.valorDaEtiquetaCentavos != null ? " (etiqueta)" : ""}</td>
                    <td style={{ ...S.td, textAlign: "right" }}>{i.unidade === "KG" ? textoDoPeso(i.quantidade) : i.quantidade}</td>
                    <td style={{ ...S.td, textAlign: "right" }}>{reais(i.precoCentavos)}</td>
                    <td style={{ ...S.td, textAlign: "right", fontWeight: 800 }}>{reais(i.totalCentavos)}</td>
                  </tr>
                ))}
                {itens.length === 0 && <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", color: "#94A3B8", padding: 40 }}>Nenhum item. Use o leitor, digite o código ou F2 para buscar pelo nome.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section style={S.direita}>
          <label style={{ fontSize: 14, color: "#94A3B8" }}>CÓDIGO {multiplicador != null ? `(quantidade ${String(multiplicador).replace(".", ",")} ×)` : "(quantidade: 3*código)"}</label>
          <input
            ref={campoRef}
            value={entrada}
            disabled={Boolean(modal) || ocupado}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const t = entrada; setEntrada(""); lancarEntrada(t); } }}
            style={S.campo}
            placeholder="Bipe ou digite"
            autoComplete="off"
            aria-label="Código do produto"
          />
          {simularBalanca && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#FBBF24" }}>
              Balança simulada:
              <input value={pesoSimulado} onChange={(e) => setPesoSimulado(e.target.value)} style={{ width: 80, padding: 4, borderRadius: 6, border: 0 }} aria-label="Peso simulado" />
              kg
              <button style={S.botaoMini} onClick={() => simuladaRef.current?.pesar(Number(pesoSimulado.replace(",", ".")) || 0)}>Pôr na balança</button>
              <button style={S.botaoMini} onClick={() => simuladaRef.current?.tirar()}>Tirar</button>
            </div>
          )}
          <div style={S.contas}>
            <div style={S.linhaConta}><span>Itens</span><span>{itens.length}</span></div>
            <div style={S.linhaConta}><span>Subtotal</span><span>{reais(subtotal)}</span></div>
            {descontoCentavos > 0 && <div style={{ ...S.linhaConta, color: "#FCA5A5" }}><span>Desconto</span><span>− {reais(descontoCentavos)}</span></div>}
            {cpf && <div style={S.linhaConta}><span>CPF/CNPJ na nota</span><span>{cpf}</span></div>}
          </div>
          <div style={S.total}>
            <div style={{ fontSize: 18, color: "#A7F3D0" }}>TOTAL</div>
            <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1.05 }} data-testid="total">{reais(total)}</div>
          </div>
          {fiscalLigado && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "#CBD5E1" }}>
              <input type="checkbox" checked={emitirNfce} onChange={(e) => setEmitirNfce(e.target.checked)} /> Emitir NFC-e
            </label>
          )}
          <button style={S.finalizar} onClick={abrirPagamento} disabled={ocupado}>FINALIZAR (F10)</button>
        </section>
      </main>

      <footer style={S.rodape}>
        {legenda.map(([k, t]) => <span key={k} style={S.tecla}><b>{k}</b> {t}</span>)}
        <span style={S.tecla}><b>↑↓</b> Item</span><span style={S.tecla}><b>Esc</b> Limpar</span>
      </footer>

      {modal && (
        <div style={S.fundo}>
          <div style={S.janela}>
            {modal === "abrir" && (
              <>
                <h2 style={S.h2}>Abrir o turno — {terminal?.nome}</h2>
                <p style={S.p}>Conte o dinheiro que está na gaveta para o troco.</p>
                <input ref={modalRef} style={S.campoModal} value={campoModal} onChange={(e) => setCampoModal(e.target.value)} aria-label="Fundo de troco"
                  onKeyDown={async (e) => { if (e.key === "Enter") { const d = await acaoDoTurno({ acao: "abrir", fundoCentavos: centavosDoTexto(campoModal) ?? 0 }); if (d) { setTurno(d.turno); setResumo(d.resumo); setModal(null); avisar(true, "Turno aberto. Boas vendas!"); } } }} />
                <p style={S.dica}>Enter abre o turno.</p>
              </>
            )}
            {modal === "novo" && novo && (
              <>
                <h2 style={S.h2}>Código {novo.codigo} não cadastrado</h2>
                <p style={S.p}>Cadastre agora e o produto já entra na venda. Da próxima vez, é só bipar.</p>
                <label style={S.p}>Nome do produto</label>
                <input ref={modalRef} style={S.campoModal} value={novo.nome} placeholder="Ex.: Café Pilão 500g" aria-label="Nome do produto"
                  onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (document.getElementById("cx-novo-preco") as HTMLInputElement | null)?.focus(); } }} />
                <label style={S.p}>Preço de venda {novo.unidade === "KG" ? "(por kg)" : ""}</label>
                <input id="cx-novo-preco" style={S.campoModal} value={novo.preco} placeholder="0,00" inputMode="decimal" aria-label="Preço de venda"
                  onChange={(e) => setNovo({ ...novo, preco: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void salvarNovo(); } }} />
                <div style={{ display: "flex", gap: 16, margin: "10px 0", color: "#334155" }}>
                  <label><input type="radio" checked={novo.unidade === "UN"} onChange={() => setNovo({ ...novo, unidade: "UN" })} /> Unidade</label>
                  <label><input type="radio" checked={novo.unidade === "KG"} onChange={() => setNovo({ ...novo, unidade: "KG" })} /> Por quilo (balança)</label>
                </div>
                <button style={S.botao} disabled={ocupado} onClick={() => void salvarNovo()}>{ocupado ? "Cadastrando…" : "Cadastrar e lançar"}</button>
                <p style={S.dica}>Enter no preço cadastra · Esc volta sem cadastrar. NCM e o resto do fiscal você completa em Importar produtos › Conferência.</p>
              </>
            )}
            {modal === "busca" && (
              <>
                <h2 style={S.h2}>Buscar produto</h2>
                <input ref={modalRef} style={S.campoModal} value={busca} onChange={(e) => { setBusca(e.target.value); setBuscaSel(0); }} placeholder="Nome do produto" aria-label="Buscar produto" />
                <div style={{ maxHeight: 380, overflowY: "auto", marginTop: 8 }}>
                  {resultadosDaBusca.map((p, n) => (
                    <div key={p.id} onClick={() => { setModal(null); if (p.unidade === "KG") void pesarEAdicionar(p, p.eans[0] || ""); else adicionar(p, multiplicador ?? 1, p.eans[0] || ""); setMultiplicador(null); }}
                      style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: n === buscaSel ? "#DBEAFE" : "transparent" }}>
                      <span>{p.nome} <small style={{ color: "#64748B" }}>{p.unidade}</small></span><strong>{reais(p.precoCentavos)}{p.unidade === "KG" ? "/kg" : ""}</strong>
                    </div>
                  ))}
                  {resultadosDaBusca.length === 0 && <p style={S.p}>Nada encontrado.</p>}
                </div>
                <p style={S.dica}>↑↓ escolhe · Enter lança · Esc volta</p>
              </>
            )}
            {modal === "quantidade" && (
              <>
                <h2 style={S.h2}>Quantidade do próximo item</h2>
                <input ref={modalRef} style={S.campoModal} value={campoModal} onChange={(e) => setCampoModal(e.target.value)} aria-label="Quantidade"
                  onKeyDown={(e) => { if (e.key === "Enter") { const q = Number(campoModal.replace(",", ".")); if (q > 0) setMultiplicador(q); setModal(null); } }} />
                <p style={S.dica}>Enter e depois bipe o produto. Por quilo: o peso em kg (0,452).</p>
              </>
            )}
            {modal === "peso" && pesoPara && (
              <>
                <h2 style={S.h2}>Peso de {pesoPara.nome}</h2>
                <p style={S.p}>{reais(pesoPara.precoCentavos)}/kg. {balanca === "conectada" ? "A balança não firmou: digite o peso." : "Sem balança conectada (F4 conecta): digite o peso."}</p>
                <input ref={modalRef} style={S.campoModal} value={campoModal} onChange={(e) => setCampoModal(e.target.value)} placeholder="0,000" aria-label="Peso em kg"
                  onKeyDown={(e) => { if (e.key === "Enter") { const kg = Number(campoModal.replace(",", ".")); if (kg > 0) { adicionar(pesoPara, kg, pesoPara.eans[0] || ""); setModal(null); } } }} />
                <p style={S.dica}>Enter lança · Esc volta</p>
              </>
            )}
            {modal === "desconto" && (
              <>
                <h2 style={S.h2}>Desconto na venda</h2>
                <p style={S.p}>Subtotal {reais(subtotal)}. Pode pedir a senha do gerente ao finalizar.</p>
                <input ref={modalRef} style={S.campoModal} value={campoModal} onChange={(e) => setCampoModal(e.target.value)} placeholder="R$ ou % (ex.: 5,00 ou 10%)" aria-label="Desconto"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const t = campoModal.trim();
                    const c = t.endsWith("%") ? Math.round(subtotal * (Number(t.slice(0, -1).replace(",", ".")) || 0) / 100) : centavosDoTexto(t) ?? 0;
                    if (c >= subtotal) return avisar(false, "O desconto não pode ser a venda inteira.");
                    setDescontoCentavos(Math.max(0, c));
                    setModal(null);
                  }} />
                <p style={S.dica}>Enter aplica · 0 tira o desconto</p>
              </>
            )}
            {modal === "cpf" && (
              <>
                <h2 style={S.h2}>CPF/CNPJ na nota</h2>
                <input ref={modalRef} style={S.campoModal} value={campoModal} onChange={(e) => setCampoModal(e.target.value)} aria-label="CPF ou CNPJ"
                  onKeyDown={(e) => { if (e.key === "Enter") { setCpf(campoModal.replace(/\D/g, "")); setModal(null); } }} />
                <p style={S.dica}>Enter grava · vazio tira</p>
              </>
            )}
            {modal === "cancelar" && itens[selecionado] && (
              <>
                <h2 style={S.h2}>Cancelar item</h2>
                <p style={S.p}>{itens[selecionado].nome} — {reais(itens[selecionado].totalCentavos)}</p>
                <input ref={modalRef} style={{ position: "absolute", opacity: 0, width: 1 }} readOnly aria-label="confirmar" />
                <button style={S.botao} onClick={() => void cancelarItem()}>Cancelar este item (Enter)</button>
                <p style={S.dica}>Pede a senha do gerente quando a loja tem uma.</p>
              </>
            )}
            {modal === "pagamento" && (
              <>
                <h2 style={S.h2}>Pagamento — total {reais(total)}</h2>
                {pagamentos.map((p, n) => <div key={n} style={S.linhaPag}><span>{NOME_DA_FORMA[p.forma]}</span><strong>{reais(p.valorCentavos)}</strong></div>)}
                <div style={{ ...S.linhaPag, fontSize: 20 }}><span>Falta</span><strong>{reais(restante)}</strong></div>
                <label style={S.p}>Valor (no dinheiro, o que o cliente entregou)</label>
                <input ref={modalRef} style={S.campoModal} value={campoModal} onChange={(e) => setCampoModal(e.target.value)} aria-label="Valor do pagamento" />
                {(() => { const v = centavosDoTexto(campoModal) ?? 0; return v > restante ? <div style={{ fontSize: 22, fontWeight: 900, color: "#047857" }}>Troco: {reais(v - restante)}</div> : null; })()}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 }}>
                  {(["DINHEIRO", "PIX", "TEF", "CREDITO", "DEBITO", "VALE"] as FormaDoCaixa[]).map((f, n) => (
                    <button key={f} style={{ ...S.botaoForma, opacity: (f === "TEF" && !portaTef) || (f === "PIX" && !temPix) ? 0.4 : 1 }} disabled={ocupado}
                      onClick={() => void (pendenteTef ? escolherFormaPendente(f) : escolherForma(f))}>
                      <small>Alt+{n + 1}</small><br />{NOME_DA_FORMA[f]}
                    </button>
                  ))}
                </div>
                <p style={S.dica}>Enter = dinheiro · Alt+número escolhe a forma · misto: lance uma forma de cada vez · Esc volta</p>
              </>
            )}
            {modal === "pix" && pix && (
              <div style={{ textAlign: "center" }}>
                <h2 style={S.h2}>Pix — {reais(pix.valorCentavos)}</h2>
                <img src={pix.qr} alt="QR Code Pix" style={{ width: 300, height: 300 }} />
                <p style={{ ...S.p, wordBreak: "break-all", fontSize: 11 }}>{pix.brcode}</p>
                <p style={S.p}>Recebedor: <strong>{pix.titular}</strong> · confira no app do banco antes de confirmar.</p>
                <input ref={modalRef} style={{ position: "absolute", opacity: 0, width: 1 }} readOnly aria-label="confirmar pix" />
                <button style={S.finalizar} onClick={pixRecebido}>RECEBIDO (Enter)</button>
                <p style={S.dica}>Esc volta sem receber</p>
              </div>
            )}
            {modal === "tef" && tef && (
              <div style={{ textAlign: "center" }}>
                <h2 style={S.h2}>Cartão no pinpad — {reais(tef.valorCentavos)}</h2>
                <p style={{ fontSize: 24, fontWeight: 800, margin: "18px 0" }} data-testid="tef-mensagem">{tef.mensagem || "…"}</p>
                {tef.pergunta && (
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    {(tef.pergunta.opcoes || []).map((o: any) => <button key={o.valor} style={S.botao} onClick={() => void responderTef(o.valor)}>{o.texto}</button>)}
                  </div>
                )}
                {!tef.final && <button style={S.botaoLeve} onClick={() => void cancelarNoPinpad()}>Cancelar no pinpad</button>}
                {tef.final && tef.fase !== "aprovado" && (
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button style={S.botao} onClick={() => void cobrarNoPinpad(tef.orderId, tef.valorCentavos)}>Tentar de novo</button>
                    <button style={S.botaoLeve} onClick={() => void desistirDoTef("outra")}>Outra forma</button>
                    <button style={S.botaoLeve} onClick={() => void desistirDoTef("cancelar")}>Cancelar o pagamento</button>
                  </div>
                )}
                <input ref={modalRef} style={{ position: "absolute", opacity: 0, width: 1 }} readOnly aria-label="pinpad" />
              </div>
            )}
            {modal === "sucesso" && sucesso && (
              <div style={{ textAlign: "center" }}>
                <h2 style={{ ...S.h2, color: "#047857" }}>Venda {sucesso.numero ? `#${sucesso.numero} ` : ""}concluída</h2>
                <p style={{ fontSize: 20 }}>Total {reais(sucesso.totalCentavos)}</p>
                {sucesso.trocoCentavos > 0 && <p style={{ fontSize: 44, fontWeight: 900, color: "#047857", margin: "8px 0" }} data-testid="troco">Troco {reais(sucesso.trocoCentavos)}</p>}
                {sucesso.nota && <p style={S.p}>{sucesso.nota}</p>}
                <input ref={modalRef} style={{ position: "absolute", opacity: 0, width: 1 }} readOnly aria-label="nova venda" />
                <button style={S.finalizar} onClick={() => { setSucesso(null); setModal(null); }}>NOVA VENDA (Enter)</button>
              </div>
            )}
            {modal === "turno" && (
              <>
                <h2 style={S.h2}>Turno — {turno?.operador}</h2>
                {resumo && <p style={S.p}>{resumo.vendas} venda(s), {reais(resumo.totalVendidoCentavos)}. Na gaveta (esperado): <strong>{reais(resumo.esperado.DINHEIRO ?? 0)}</strong></p>}
                <label style={S.p}>Valor da sangria ou do suprimento</label>
                <input ref={modalRef} style={S.campoModal} value={campoModal} onChange={(e) => setCampoModal(e.target.value)} aria-label="Valor do movimento" />
                <input style={{ ...S.campoModal, fontSize: 16, height: 40 }} value={campoModal2} onChange={(e) => setCampoModal2(e.target.value)} placeholder="Motivo (opcional)" aria-label="Motivo" />
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button style={S.botao} onClick={async () => { const v = centavosDoTexto(campoModal); if (!v) return avisar(false, "Digite o valor."); const d = await acaoDoTurno({ acao: "sangria", valorCentavos: v, descricao: campoModal2 }); if (d) { setResumo(d.resumo); setModal(null); avisar(true, `Sangria de ${reais(v)} registrada.`); } }}>Sangria</button>
                  <button style={S.botao} onClick={async () => { const v = centavosDoTexto(campoModal); if (!v) return avisar(false, "Digite o valor."); const d = await acaoDoTurno({ acao: "suprimento", valorCentavos: v, descricao: campoModal2 }); if (d) { setResumo(d.resumo); setModal(null); avisar(true, `Suprimento de ${reais(v)} registrado.`); } }}>Suprimento</button>
                  <button style={S.botaoLeve} onClick={() => { if (itens.length) return avisar(false, "Termine ou cancele a venda na tela antes de fechar o turno."); setFechamento({ contado: {} }); setModal("fechar"); }}>Fechar o turno</button>
                </div>
              </>
            )}
            {modal === "fechar" && resumo && fechamento && (
              <>
                <h2 style={S.h2}>Fechar o turno</h2>
                {fechamento.resultado ? (
                  <>
                    <p style={{ fontSize: 22, fontWeight: 900 }} data-testid="diferenca">{fechamento.resultado}</p>
                    <button style={S.finalizar} onClick={() => { setFechamento(null); setTurno(null); setCampoModal("0,00"); setModal("abrir"); }}>OK</button>
                  </>
                ) : (
                  <>
                    <p style={S.p}>Conte cada forma (em branco = não conferida). O esperado aparece depois de fechar.</p>
                    {["DINHEIRO", "PIX", "CREDITO", "DEBITO", "TEF", "VALE"].filter((f) => f === "DINHEIRO" || (resumo.porForma[f] ?? 0) > 0).map((f, n) => (
                      <label key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, margin: "6px 0" }}>
                        <span>{NOME_DA_FORMA[f as FormaDoCaixa]}</span>
                        <input ref={n === 0 ? modalRef : undefined} style={{ ...S.campoModal, width: 180, height: 40, fontSize: 18 }} aria-label={`Contado ${f}`}
                          value={fechamento.contado[f] ?? ""} onChange={(e) => setFechamento({ ...fechamento, contado: { ...fechamento.contado, [f]: e.target.value } })} />
                      </label>
                    ))}
                    <button style={S.finalizar} onClick={async () => {
                      const contado: Record<string, number | null> = {};
                      for (const [f, v] of Object.entries(fechamento.contado)) contado[f] = centavosDoTexto(String(v));
                      const d = await acaoDoTurno({ acao: "fechar", contado });
                      if (!d) return;
                      const dif = d.fechamento.diferencaCentavos;
                      const linhas = Object.entries(d.fechamento.esperado as Record<string, number>).map(([f, v]) => `${NOME_DA_FORMA[f as FormaDoCaixa] || f}: esperado ${reais(v)}`).join(" · ");
                      setFechamento({ ...fechamento, resultado: `${dif == null ? "Sem conferência" : dif === 0 ? "Confere" : dif < 0 ? `Falta ${reais(-dif)}` : `Sobra ${reais(dif)}`} — ${linhas}` });
                    }}>FECHAR O TURNO</button>
                  </>
                )}
              </>
            )}
            {modal === "ajuda" && (
              <>
                <h2 style={S.h2}>Atalhos do caixa</h2>
                <ul style={{ lineHeight: 1.8, fontSize: 16 }}>
                  <li><b>Leitor ou Enter</b>: lança o código. <b>3*código</b>: 3 unidades. <b>0,452*código</b>: peso de produto por quilo.</li>
                  <li><b>F2</b> busca pelo nome · <b>F3</b> quantidade do próximo · <b>F4</b> conecta a balança</li>
                  <li><b>F6</b> desconto · <b>F7</b> cancela o item escolhido (↑↓) com a senha do gerente · <b>F8</b> CPF na nota</li>
                  <li><b>F9</b> turno: sangria, suprimento, fechar · <b>F10</b> ou <b>F12</b> finalizar</li>
                  <li>Etiqueta da balança (código que começa com 2) entra com o preço impresso.</li>
                </ul>
                <input ref={modalRef} style={{ position: "absolute", opacity: 0, width: 1 }} readOnly aria-label="fechar ajuda" />
                <p style={S.dica}>Esc fecha</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  tela: { position: "fixed", inset: 0, zIndex: 9000, background: "#0F172A", color: "#F8FAFC", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif" },
  topo: { display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#1E293B", flexWrap: "wrap" },
  etiq: { fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#334155", fontWeight: 700 },
  corpo: { flex: 1, display: "flex", gap: 14, padding: 14, minHeight: 0 },
  esquerda: { flex: "1 1 60%", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 },
  direita: { flex: "0 0 min(440px, 40%)", display: "flex", flexDirection: "column", gap: 12 },
  ultimo: { background: "#1E3A8A", borderRadius: 14, padding: "12px 16px", minHeight: 96 },
  lista: { flex: 1, overflowY: "auto", background: "#fff", color: "#0F172A", borderRadius: 14 },
  th: { padding: "10px 12px", borderBottom: "2px solid #E2E8F0", position: "sticky", top: 0, background: "#fff", fontSize: 13 },
  td: { padding: "9px 12px", borderBottom: "1px solid #F1F5F9" },
  campo: { height: 64, fontSize: 30, fontWeight: 800, borderRadius: 12, border: "3px solid #38BDF8", padding: "0 16px", background: "#fff", color: "#0F172A", outline: "none" },
  contas: { background: "#1E293B", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 6, fontSize: 17 },
  linhaConta: { display: "flex", justifyContent: "space-between" },
  total: { background: "#065F46", borderRadius: 16, padding: "14px 18px", textAlign: "right" },
  finalizar: { height: 60, borderRadius: 14, border: 0, background: "#10B981", color: "#fff", fontSize: 22, fontWeight: 900, cursor: "pointer", padding: "0 24px", marginTop: 10, width: "100%" },
  rodape: { display: "flex", gap: 8, padding: "8px 14px", background: "#1E293B", flexWrap: "wrap" },
  tecla: { fontSize: 13, padding: "4px 8px", borderRadius: 8, background: "#334155" },
  fundo: { position: "fixed", inset: 0, zIndex: 9010, background: "rgba(2,6,23,.7)", display: "grid", placeItems: "center", padding: 16 },
  janela: { background: "#fff", color: "#0F172A", borderRadius: 18, padding: 22, width: "min(620px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", position: "relative" },
  h2: { margin: "0 0 10px", fontSize: 22 },
  p: { color: "#475569", fontSize: 15, margin: "6px 0" },
  dica: { color: "#64748B", fontSize: 13, marginTop: 10 },
  campoModal: { width: "100%", height: 54, fontSize: 26, fontWeight: 800, borderRadius: 10, border: "2px solid #38BDF8", padding: "0 12px", boxSizing: "border-box", marginTop: 6 },
  linhaPag: { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F1F5F9", fontSize: 17 },
  botao: { height: 46, padding: "0 18px", borderRadius: 10, border: 0, background: "#2563EB", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer" },
  botaoLeve: { height: 46, padding: "0 18px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 8 },
  botaoForma: { minHeight: 64, borderRadius: 12, border: "2px solid #CBD5E1", background: "#F8FAFC", color: "#0F172A", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  botaoMini: { padding: "4px 8px", borderRadius: 6, border: 0, background: "#FBBF24", color: "#111827", fontWeight: 800, cursor: "pointer" },
  aviso: { position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 9100, padding: "12px 18px", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 16, boxShadow: "0 10px 30px rgba(0,0,0,.4)", cursor: "pointer", maxWidth: "min(640px, calc(100% - 32px))" },
};
