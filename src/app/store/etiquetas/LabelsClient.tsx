"use client";

import { useState, useEffect } from "react";
import { saveLabelData, updateStoreLabelInfo } from "@/app/actions/labels";
import { createKitchenItem, updateKitchenItem, deleteKitchenItem, fillNutritionWithAI } from "@/app/actions/kitchenItems";
import { Printer, Settings, AlertTriangle, Save, Plus, Trash2, Store, Sparkles, Tag, Sliders, Check, XCircle, Info } from "lucide-react";
import EtiquetaPapel from "./EtiquetaPapel";
import AbaLayoutDaEtiqueta from "./AbaLayoutDaEtiqueta";
import { BandejaDaEtiqueta, EtiquetaFantasma } from "./PreviaDaEtiqueta";
import { CSS_DA_ETIQUETA } from "./etiqueta-css";
import { salvarConfigDaEtiqueta } from "@/app/actions/labels";
import {
  resolverCamposDaEtiqueta,
  CHAVES_DE_CAMPO,
  PADRAO,
  type ChaveDeCampo,
  type PresetDaEtiqueta,
  textoDeConservacao,
  quantidadeDaEtiqueta,
  textoDeQuantidade,
  presetDoItem,
  seloAltoEmSuprimido,
  TEXTOS_PADRAO,
  type ChaveDeTexto,
} from "@/lib/etiqueta-campos";

/**
 * Formata a data da etiqueta SEM passar por `Date`.
 *
 * `fabDate` e `valDate` vem de <input type="date">, entao sao sempre a string
 * "YYYY-MM-DD" — uma data de calendario, nao um instante. Mandar isso para
 * `new Date()` a interpreta como meia-noite UTC, e o `toLocaleDateString`
 * seguinte reimprime esse instante no fuso de Sao Paulo (UTC-3), voltando um
 * dia: "2026-08-28" saia impresso como 27/08/2026.
 *
 * Isso saiu em TODA etiqueta impressa ate hoje, no Fab e no Val — validade
 * errada no papel que a vigilancia le. O calculo da validade nunca esteve
 * errado (na conta, os dois deslocamentos de fuso se cancelam); errado estava
 * so o que ia para a folha.
 *
 * Fatiar a string resolve de vez porque nao existe fuso nenhum no caminho —
 * e continua certo em qualquer servidor, em qualquer horario de verao.
 */
function dataDaEtiqueta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "--";
}

export default function LabelsClient({ products, kitchenItems, storeAddress, storeCnpj, storeName, storeLogo, labelFieldsConfig, stockItems = [] }: { products: any[], kitchenItems: any[], storeAddress: string, storeCnpj: string, storeName: string, storeLogo: string, labelFieldsConfig?: any, stockItems?: { id: string, name: string, unit: string }[] }) {
  const [selectedProductId, setSelectedProductId] = useState("");
  const [mode, setMode] = useState<"print" | "layout" | "config">("print");
  const [items, setItems] = useState<any[]>(kitchenItems.map(ki => ({ ...ki, isKitchenItem: true })));
  
  // Modal Novo Item
  const [showNewItemModal, setShowNewItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState("");

  // Modal Dados da Loja
  const [showStoreDataModal, setShowStoreDataModal] = useState(false);
  const [globalCnpj, setGlobalCnpj] = useState(storeCnpj);
  const [globalAddress, setGlobalAddress] = useState(storeAddress);
  const [globalStoreName, setGlobalStoreName] = useState(storeName);
  const [showLogo, setShowLogo] = useState(false);

  useEffect(() => {
    setShowLogo(localStorage.getItem("labelShowLogo") === "true");
  }, []);

  // Print State
  const [lote, setLote] = useState("");

  // ── QR CODE DE RASTREIO ───────────────────────────────────────────────────
  //
  // O QR carrega https://<host>/e/<CODIGO>, e o código é gravado no banco ANTES
  // de o papel sair (action criarLotesDaImpressao). Etiqueta impressa com código
  // que o servidor nunca viu abriria "não encontrada" no celular — o pior
  // resultado possível, porque o funcionário confia no papel.
  //
  // O QR precisa ser <img src="data:..."> e não <canvas>: o handlePrint copia
  // `printArea.innerHTML` para um iframe, e o bitmap de um canvas não sobrevive
  // a essa cópia — sairia um quadrado branco na etiqueta.
  const [usarQr, setUsarQr] = useState(true);
  const [quantidade, setQuantidade] = useState(1);
  const [codigoUnico, setCodigoUnico] = useState(true);
  const [etiquetas, setEtiquetas] = useState<{ code: string; qr: string }[]>([]);
  const [preparando, setPreparando] = useState(false);
  const [erroLote, setErroLote] = useState("");
  // Só imprime DEPOIS que o React pintou as etiquetas com o QR na tela —
  // imprimir no mesmo tick copiaria o innerHTML sem as imagens.
  const [imprimirQuandoPronto, setImprimirQuandoPronto] = useState(false);
  const [fabDate, setFabDate] = useState("");
  const [valDate, setValDate] = useState("");
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  // Config State
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    shelfLifeDays: 90,
    ingredients: "",
    allergens: "",
    preparation: "",
    highSugar: false,
    highSodium: false,
    highFat: false,
    transgenic: false,
    weightStr: "1,00 kg",
    energy: "0",
    carbs: "0",
    sugars: "0",
    addedSugars: "0",
    proteins: "0",
    fatTotal: "0",
    fatSat: "0",
    sodium: "0",
    // Os três campos que a ficha SEMPRE teve e que nenhuma tela mostrava: o
    // lojista podia gravá-los pela action e nunca via o resultado. O CNPJ e o
    // endereço próprios existem para o item produzido por outra cozinha (ou
    // pela fábrica da rede), que não pode sair rotulado com o CNPJ desta loja.
    customCnpj: "",
    customAddress: "",
    stockItemId: ""
  });

  const selectedProduct = items.find(p => p.id === selectedProductId);

  // ── O LAYOUT DA ETIQUETA ─────────────────────────────────────────────────
  //
  // Estado SEPARADO do `config`, e isso não é organização: o useEffect logo
  // abaixo tem `fabDate` e `items` nas dependências e reescreve o `config`
  // inteiro. Se os interruptores morassem lá dentro, mudar a data de fabricação
  // religaria sozinho tudo o que o lojista tinha acabado de desligar, na cara
  // dele, sem nada explicando.
  const [layout, setLayout] = useState<any>(labelFieldsConfig || null);
  const [chaveDeConservacao, setChaveDeConservacao] = useState<ChaveDeTexto>("conservacaoCongelado");

  const preset = presetDoItem(selectedProduct?.labelSize);

  // O que REALMENTE vai sair no papel, já considerando o preset, o que a loja
  // desligou e o que simplesmente não tem dado para mostrar. A prévia lê daqui,
  // e a impressão também — é o que impede a tela de prometer o que o papel não
  // cumpre.
  const camposDoPapel = resolverCamposDaEtiqueta(layout, selectedProduct?.labelSize, {
    pesoPreenchido: !!String(config.weightStr || "").trim() && !/^(n\/a|0)$/i.test(String(config.weightStr || "").trim()),
    temIngredientes: !!String(config.ingredients || "").trim(),
    temAlergicos: !!String(config.allergens || "").trim(),
    temModoPreparo: !!String(config.preparation || "").trim(),
    // Tabela inteira em zero não é campo em branco: é a declaração de que o
    // alimento não tem caloria, não tem sódio e não tem gordura nenhuma.
    tabelaTodaZerada: [config.energy, config.carbs, config.sugars, config.addedSugars, config.proteins, config.fatTotal, config.fatSat, config.sodium]
      .every(v => !String(v ?? "").trim() || Number(String(v).replace(",", ".")) === 0),
    temLogo: !!storeLogo,
    temLote: !!String(lote || "").trim(),
    temNomeDaLoja: !!String(storeName || "").trim(),
    temCnpj: !!String(config.customCnpj || storeCnpj || "").trim(),
    temEndereco: !!String(config.customAddress || storeAddress || "").trim(),
    qrPedido: usarQr,
  });

  // O que os interruptores mostram: o que a loja gravou, ou o padrão. Separado
  // de `camposDoPapel` porque aquele já sofreu as travas do preset e as
  // ausências de dado — e um interruptor que anda sozinho quando o campo do
  // produto está vazio é interruptor quebrado aos olhos de quem o usa.
  const ligados = CHAVES_DE_CAMPO.reduce((acc, k) => {
    const g = layout?.campos?.[k];
    acc[k] = typeof g === "boolean" ? g : PADRAO[k];
    return acc;
  }, {} as Record<ChaveDeCampo, boolean>);

  // ── QUANTO CADA ETIQUETA VALE NO ESTOQUE ─────────────────────────────────
  //
  // Sai do peso JÁ CADASTRADO na ficha — o mesmo que é impresso no papel. Antes
  // disto a tela não mandava quantidade nenhuma, o servidor caía no fallback de
  // uma unidade por etiqueta, e o saco de 5 kg entrava no estoque como "1".
  const porEtiqueta = quantidadeDaEtiqueta(config.weightStr);

  // ── O PESO EM DOIS CAMPOS ────────────────────────────────────────────────
  //
  // `weightStr` continua sendo uma string ("0,90 kg") porque é ela que vai
  // impressa no papel e é o que o schema guarda. Mas a TELA deixa de aceitar
  // texto livre: o número e a unidade são separados, e a unidade sai de uma
  // lista com as cinco que o estoque entende. Assim não há como digitar "cx"
  // nem esquecer a unidade.
  const pesoOk = porEtiqueta.reconhecido;
  const pesoQuantidade = (() => {
    const m = /^\s*([\d]+(?:[.,]\d+)?)/.exec(String(config.weightStr || ""));
    return m ? m[1] : "";
  })();
  const pesoUnidade = pesoOk ? porEtiqueta.unidade : "";

  const aplicarPeso = (quantidade: string, unidade: string) => {
    const q = String(quantidade).replace(/[^\d.,]/g, "");
    setConfig({ ...config, weightStr: q && unidade ? `${q} ${unidade}` : q });
  };

  // A rota de entrada soma a quantidade CRUA no saldo do insumo, sem converter
  // unidade. Então uma etiqueta em gramas caindo num insumo cadastrado em quilos
  // multiplica o saldo por mil — em silêncio, e sem nada para investigar depois.
  // Achar isso antes de o papel sair custa uma comparação de nome.
  // O insumo vinculado na ficha vence o palpite por nome. Casar por nome é o
  // que o servidor faz quando NÃO há vínculo, e é justamente o caminho que
  // duplica insumo ("Frango Desfiado 5kg" e "Frango desfiado"); aqui ele é só
  // o segundo melhor, para avisar também quem ainda não vinculou.
  const insumoDoMesmoNome =
    stockItems.find(i => i.id === config.stockItemId) ||
    stockItems.find(
      i => i.name.trim().toLowerCase() === String(selectedProduct?.name || "").trim().toLowerCase()
    );
  const unidadeDiverge = !!insumoDoMesmoNome
    && porEtiqueta.reconhecido
    && insumoDoMesmoNome.unit.trim().toLowerCase() !== porEtiqueta.unidade.trim().toLowerCase();

  // A unidade gravada no lote é a do INSUMO quando existe vínculo, e não a que
  // o texto do peso sugere. O servidor sobrescreve o lote com `insumo.unit` no
  // momento da entrada de qualquer forma — gravar diferente aqui só produziria
  // uma etiqueta cujo lote muda de unidade sozinho depois do primeiro scan.
  // A quantidade continua sendo a do peso: é ela que o aviso da tela mostra, e
  // é ela que o funcionário confere contra o papel.
  const unidadeDoLote = insumoDoMesmoNome?.unit?.trim() || porEtiqueta.unidade;

  // O que acabou de ser impresso — a frase que mata o "imprimi 40 etiquetas e
  // o estoque não mudou nada". Imprimir NÃO põe nada em estoque: é a leitura do
  // QR que põe, e isso precisa estar escrito no momento em que a pessoa acabou
  // de imprimir, não numa tela de ajuda.
  const [ultimaImpressao, setUltimaImpressao] = useState<{ etiquetas: number; unico: boolean } | null>(null);

  const [salvandoLayout, setSalvandoLayout] = useState(false);

  /**
   * O QR que aparece na PRÉVIA, e só nela.
   *
   * O código é impossível de propósito: "LOLOLOLO" usa L e O, que não existem
   * no alfabeto de `lote.ts` (ele evita I, L, O, U, 0 e 1 justamente para não
   * haver ambiguidade visual no papel). Assim, quem apontar a câmera para o
   * MONITOR cai em CÓDIGO INVÁLIDO por construção — e não por sorte.
   *
   * Sem isso a alternativa seria gerar um QR de verdade para ver na tela, e aí
   * qualquer pessoa poderia fotografar o monitor e movimentar um lote que nunca
   * foi impresso: o StockLot é gravado ANTES de o papel sair.
   *
   * Gerado uma única vez na montagem: gerar a cada tecla digitada queimaria CPU
   * do tablet no meio da digitação dos ingredientes.
   */
  const [qrDeExemplo, setQrDeExemplo] = useState("");
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL("HTTPS://EXEMPLO/E/LOLOLOLO", {
          errorCorrectionLevel: "Q", margin: 4, scale: 8,
          color: { dark: "#000000", light: "#FFFFFF" },
        });
        if (vivo) setQrDeExemplo(url);
      } catch {
        // Sem QR de exemplo a prévia continua fiel em todo o resto — só o
        // quadradinho fica em branco. Não vale derrubar a tela por isso.
      }
    })();
    return () => { vivo = false; };
  }, []);

  /**
   * Grava a mudança na hora, sem botão de salvar.
   *
   * O estado local muda PRIMEIRO e a prévia acompanha no mesmo frame: esse
   * feedback imediato é literalmente o momento em que o dono sente que a tela
   * evoluiu. Se o servidor recusar, o valor volta e a tela diz o motivo — bem
   * melhor que travar o interruptor esperando a resposta.
   */
  const gravarLayout = async (proximo: any) => {
    const anterior = layout;
    setLayout(proximo);
    setSalvandoLayout(true);
    try {
      const r = await salvarConfigDaEtiqueta(proximo);
      if (!r.success) {
        setLayout(anterior);
        // "Não autorizado" é o que a action devolve quando a sessão morreu, e
        // sozinho ele não diz o que fazer: quem lê acha que não tem permissão
        // para configurar a própria etiqueta.
        avisar("erro", r.error === "Não autorizado"
          ? "Sua sessão expirou. Entre de novo e a mudança poderá ser salva."
          : r.error || "Não consegui salvar essa mudança.");
      }
    } catch (e: any) {
      setLayout(anterior);
      avisar("erro", "Sem conexão. A mudança não foi salva — tente de novo.");
    } finally {
      setSalvandoLayout(false);
    }
  };

  const alternarCampo = (chave: ChaveDeCampo, valor: boolean) => {
    gravarLayout({ ...(layout || {}), campos: { ...ligados, [chave]: valor } });
  };

  const trocarPreset = async (p: PresetDaEtiqueta) => {
    if (!selectedProductId) return;
    setSalvandoLayout(true);
    try {
      // O preset é do PRODUTO e mora em `labelSize` — coluna que existia desde
      // o boot da estrutura de lotes e que nenhuma tela jamais gravou.
      const atualizado = await updateKitchenItem(selectedProductId, { labelSize: p });
      setItems(items.map(i => (i.id === selectedProductId ? { ...atualizado, isKitchenItem: true } : i)));
      avisar("ok", "Pronto. A etiqueta ao lado já está no formato de " + (p === "cozinha" ? "uso interno" : p === "venda" ? "venda" : "fornecimento") + ".");
    } catch (e: any) {
      avisar("erro", "Não consegui trocar o formato: " + (e?.message || "erro desconhecido"));
    } finally {
      setSalvandoLayout(false);
    }
  };

  // ── AVISOS ────────────────────────────────────────────────────────────────
  // O alerta nativo do Chrome é o sinal mais forte de "software interno" que
  // uma tela pode emitir: ele tapa a tela, não diz de onde veio e some sem
  // deixar rastro. Eram cinco nesta tela.
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro" | "atencao" | "info"; texto: string } | null>(null);
  const avisar = (tom: "ok" | "erro" | "atencao" | "info", texto: string) => setAviso({ tom, texto });

  useEffect(() => {
    // Sucesso some sozinho; erro NUNCA some, porque erro que some sozinho é
    // erro que ninguém leu.
    if (!aviso || aviso.tom === "erro") return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    if (selectedProduct) {
      if (selectedProduct.isKitchenItem) {
        setConfig({
          shelfLifeDays: selectedProduct.shelfLifeDays || 90,
          ingredients: selectedProduct.ingredients || "",
          allergens: selectedProduct.allergens || "",
          preparation: selectedProduct.preparation || "",
          highSugar: selectedProduct.highSugar || false,
          highSodium: selectedProduct.highSodium || false,
          highFat: selectedProduct.highFat || false,
          transgenic: selectedProduct.transgenic || false,
          weightStr: selectedProduct.weightStr || "1,00 kg",
          energy: selectedProduct.energy || "0",
          carbs: selectedProduct.carbs || "0",
          sugars: selectedProduct.sugars || "0",
          addedSugars: selectedProduct.addedSugars || "0",
          proteins: selectedProduct.proteins || "0",
          fatTotal: selectedProduct.fatTotal || "0",
          fatSat: selectedProduct.fatSat || "0",
          sodium: selectedProduct.sodium || "0",
          customCnpj: selectedProduct.customCnpj || "",
          customAddress: selectedProduct.customAddress || "",
          stockItemId: selectedProduct.stockItemId || ""
        });
      } else if (selectedProduct.labelData) {
        setConfig({ ...config, ...selectedProduct.labelData });
      } else {
        setConfig({
          shelfLifeDays: 90,
          ingredients: "",
          allergens: "",
          preparation: "",
          highSugar: false,
          highSodium: false,
          highFat: false,
          transgenic: false,
          weightStr: "1,00 kg",
          energy: "0", carbs: "0", sugars: "0", addedSugars: "0", proteins: "0", fatTotal: "0", fatSat: "0", sodium: "0",
          customCnpj: "", customAddress: "", stockItemId: ""
        });
      }
      
      const days = selectedProduct.isKitchenItem ? selectedProduct.shelfLifeDays : selectedProduct.labelData?.shelfLifeDays;
      if (fabDate && days) {
        const date = new Date(fabDate);
        date.setDate(date.getDate() + Number(days));
        setValDate(date.toISOString().split("T")[0]);
      }
    }
  }, [selectedProductId, fabDate, items]);

  const handleCreateNewItem = async () => {
    if (!newItemName) return;
    setSaving(true);
    try {
      const newItem = await createKitchenItem({ name: newItemName });
      setItems([...items, { ...newItem, isKitchenItem: true }]);
      setSelectedProductId(newItem.id);
      setMode("config");
      setShowNewItemModal(false);
      setNewItemName("");
    } catch (e: any) {
      avisar("erro", "Não consegui criar o item: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este item da cozinha?")) return;
    setSaving(true);
    try {
      await deleteKitchenItem(id);
      setItems(items.filter(i => i.id !== id));
      if (selectedProductId === id) setSelectedProductId("");
    } catch (e: any) {
      avisar("erro", "Não consegui excluir: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Grava o(s) lote(s), gera o(s) QR e só então manda imprimir.
   *
   * Se qualquer coisa aqui falhar, a etiqueta AINDA IMPRIME — sem QR. Melhor
   * etiqueta sem rastreio do que loja sem conseguir etiquetar a comida.
   */
  const prepararEImprimir = async () => {
    setErroLote("");

    if (!usarQr) {
      setEtiquetas(Array.from({ length: quantidade }, () => ({ code: "", qr: "" })));
      setImprimirQuandoPronto(true);
      return;
    }

    setPreparando(true);
    try {
      const { criarLotesDaImpressao } = await import("@/app/actions/lotes");
      const QRCode = (await import("qrcode")).default;

      const r = await criarLotesDaImpressao({
        kitchenItemId: selectedProduct?.isKitchenItem ? selectedProductId : null,
        productName: selectedProduct?.name || "",
        loteRef: lote || null,
        fabricadoEm: fabDate || null,
        validoAte: valDate || null,
        weightStr: config.weightStr || null,
        // O peso da etiqueta, multiplicado pelas etiquetas da fornada. O
        // servidor divide de volta por lote conforme a escolha da numeração.
        unit: unidadeDoLote,
        quantidadeTotal: porEtiqueta.quantidade * quantidade,
        // Sem o vínculo, a primeira ENTRADA procura o insumo pelo NOME e cria
        // se não achar — é assim que "Frango Desfiado 5kg" e "Frango desfiado"
        // viram dois insumos separados no estoque.
        stockItemId: config.stockItemId || selectedProduct?.stockItemId || null,
        etiquetas: quantidade,
        codigoUnicoParaTodas: codigoUnico,
      });

      if (!r.ok || r.lotes.length === 0) {
        // Não trava a impressão: segue sem QR e avisa por quê.
        setErroLote("Não consegui gerar o QR agora — a etiqueta vai sair sem ele.");
        setEtiquetas(Array.from({ length: quantidade }, () => ({ code: "", qr: "" })));
        setImprimirQuandoPronto(true);
        return;
      }

      const host = window.location.hostname;
      const geradas: { code: string; qr: string }[] = [];
      for (let i = 0; i < quantidade; i++) {
        // Um código para a fornada inteira, ou um por etiqueta — a escolha da
        // tela. O modelo aguenta os dois sem mudança nenhuma.
        const code = codigoUnico ? r.lotes[0].code : r.lotes[i].code;
        const url = `HTTPS://${host.toUpperCase()}/E/${code}`;
        const qr = await QRCode.toDataURL(url, {
          // Correção 25%: cozinha tem gordura, condensação e atrito. O mínimo
          // teórico falha de forma intermitente, que é o pior defeito para
          // diagnosticar por telefone.
          errorCorrectionLevel: "Q",
          // O default 4 é a zona de silêncio da norma ISO/IEC 18004. Zerar aqui
          // faz o leitor perder o símbolo mesmo com a impressão perfeita.
          margin: 4,
          scale: 8,
          color: { dark: "#000000", light: "#FFFFFF" },
        });
        geradas.push({ code, qr });
      }
      setEtiquetas(geradas);
      setImprimirQuandoPronto(true);
    } catch (e: any) {
      console.error("[Etiquetas] Falha ao preparar o QR:", e?.message);
      setErroLote("Não consegui gerar o QR agora — a etiqueta vai sair sem ele.");
      setEtiquetas(Array.from({ length: quantidade }, () => ({ code: "", qr: "" })));
      setImprimirQuandoPronto(true);
    } finally {
      setPreparando(false);
    }
  };

  // Espera o React pintar as etiquetas antes de copiar o innerHTML para o
  // iframe. Sem esse intervalo, o QR sai em branco.
  useEffect(() => {
    if (!imprimirQuandoPronto) return;
    setImprimirQuandoPronto(false);
    const t = setTimeout(() => handlePrint(), 120);
    return () => clearTimeout(t);
  }, [imprimirQuandoPronto]);

  const handlePrint = () => {
    const printArea = document.querySelector<HTMLElement>(".print-area");
    if (!printArea) return;

    const old = document.getElementById("label-print-frame");
    if (old) old.remove();

    const iframe = document.createElement("iframe");
    iframe.id = "label-print-frame";
    iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:384px;height:576px;border:none;";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>${CSS_DA_ETIQUETA}</style>
</head>
<body>
${printArea.innerHTML}
</body>
</html>`);
    doc.close();

    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          iframe.remove();
          // A prévia volta para o QR de exemplo.
          //
          // Sem isto, os códigos REAIS recém-gravados ficam desenhados na tela
          // depois da impressão — e qualquer pessoa que aponte a câmera para o
          // monitor movimenta um lote que ainda está saindo da impressora. O
          // StockLot é gravado ANTES de o papel sair, então o código na tela
          // vale tanto quanto o do papel.
          setEtiquetas([]);
          setUltimaImpressao({ etiquetas: quantidade, unico: codigoUnico });
        }, 2000);
      }, 500);
    };
  };

  const handleSaveConfig = async () => {
    if (!selectedProductId) return;
    setSaving(true);
    try {
      if (selectedProduct.isKitchenItem) {
        const updated = await updateKitchenItem(selectedProductId, config);
        setItems(items.map(i => i.id === selectedProductId ? { ...updated, isKitchenItem: true } : i));
      } else {
        await saveLabelData(selectedProductId, config);
        setItems(items.map(i => i.id === selectedProductId ? { ...i, labelData: config } : i));
      }
      avisar("ok", "Ficha salva. A etiqueta ao lado já está com os dados novos.");
    } catch (e: any) {
      avisar("erro", "Não consegui salvar a ficha: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStoreData = async () => {
    setSaving(true);
    try {
      localStorage.setItem("labelShowLogo", showLogo.toString());
      const res = await updateStoreLabelInfo(globalCnpj, globalAddress, globalStoreName, storeLogo);
      if (res && res.error) {
        avisar("erro", res.error);
      } else {
        avisar("ok", "Dados da loja salvos. Eles já aparecem no rodapé da etiqueta.");
        setShowStoreDataModal(false);
      }
    } catch (e: any) {
      avisar("erro", "Não consegui salvar os dados da loja: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFillWithAI = async () => {
    if (!selectedProduct) return;
    setSaving(true);
    try {
      const data = await fillNutritionWithAI(selectedProduct.name);
      if (data.error) {
        avisar("erro", "A IA não conseguiu preencher: " + data.error);
        return;
      }
      setConfig({ ...config, ...data });
      avisar("atencao", "A IA preencheu os campos com uma estimativa. Confira valor por valor e clique em Salvar — o que sai no papel é responsabilidade da sua loja.");
    } catch (e: any) {
      avisar("erro", "Não consegui falar com a IA: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fh-tela labels-container">
      <div className="no-print">
        <header className="fh-cabecalho">
          <span className="fh-cabecalho__icone"><Tag size={24} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="fh-micro">MÓDULO · VALIDADE</div>
            <h1 className="fh-h1">Etiquetas de validade</h1>
            <p className="fh-corpo">
              Monte a etiqueta, veja como ela vai sair e imprima. Cada etiqueta leva um QR que a cozinha escaneia
              para dar entrada e baixa no estoque{storeName ? " da " + storeName : ""}.
            </p>
          </div>
          <div className="fh-cabecalho__acoes">
            <button className="fh-btn fh-btn--secundario" onClick={() => setShowStoreDataModal(true)}>
              <Store size={18} /> Dados da loja
            </button>
            <button className="fh-btn fh-btn--primario" onClick={() => setShowNewItemModal(true)}>
              <Plus size={18} /> Novo item
            </button>
          </div>
        </header>

        {showStoreDataModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
            <div style={{ background: "#FFF", padding: "24px", borderRadius: "16px", width: "100%", maxWidth: "450px" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", marginBottom: "8px" }}>Dados da Loja (Vigilância)</h2>
              <p style={{ fontSize: "0.85rem", color: "#64748B", marginBottom: "16px" }}>Esses dados serão impressos no rodapé de todas as etiquetas para fins de conformidade com a vigilância sanitária.</p>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Nome da Loja (Fabricante)</label>
                <input 
                  type="text" 
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", boxSizing: "border-box" }}
                  value={globalStoreName} 
                  onChange={e => setGlobalStoreName(e.target.value)} 
                  placeholder="Ex: Hakim Esfirraria"
                />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>CNPJ da Loja</label>
                <input 
                  type="text" 
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", boxSizing: "border-box" }}
                  value={globalCnpj} 
                  onChange={e => setGlobalCnpj(e.target.value)} 
                  placeholder="Ex: 00.000.000/0000-00"
                />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Endereço de Fabricação</label>
                <textarea 
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", boxSizing: "border-box", resize: "none" }} 
                  rows={2}
                  value={globalAddress} 
                  onChange={e => setGlobalAddress(e.target.value)} 
                  placeholder="Ex: Rua das Flores, 123 - Centro"
                ></textarea>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                <input 
                  type="checkbox" 
                  id="chkLogo"
                  checked={showLogo}
                  onChange={e => setShowLogo(e.target.checked)}
                  style={{ width: "16px", height: "16px" }}
                />
                <label htmlFor="chkLogo" style={{ margin: 0, cursor: "pointer", fontSize: "0.85rem" }}>Imprimir Logo no Rodapé</label>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button onClick={() => setShowStoreDataModal(false)} disabled={saving} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #CBD5E1", background: "none", cursor: "pointer" }}>Cancelar</button>
                <button className="fh-btn fh-btn--primario" onClick={handleSaveStoreData} disabled={saving} style={{ height: 44 }}>
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showNewItemModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
            <div style={{ background: "#FFF", padding: "24px", borderRadius: "16px", width: "100%", maxWidth: "450px" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", marginBottom: "8px" }}>Adicionar Novo Item de Cozinha</h2>
              <p style={{ fontSize: "0.85rem", color: "#64748B", marginBottom: "16px" }}>Use para itens de preparo interno que não estão no cardápio de vendas (ex: Massas, Molhos, Temperos).</p>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Nome do Item</label>
                <input 
                  type="text" 
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", boxSizing: "border-box" }}
                  value={newItemName} 
                  onChange={e => setNewItemName(e.target.value)} 
                  placeholder="Ex: Massa de Esfirra"
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button onClick={() => setShowNewItemModal(false)} disabled={saving} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #CBD5E1", background: "none", cursor: "pointer" }}>Cancelar</button>
                <button className="fh-btn fh-btn--primario" onClick={handleCreateNewItem} disabled={saving || !newItemName} style={{ height: 44 }}>
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── ESCOLHER O INSUMO ──────────────────────────────────────── */}
        <div className="fh-card" style={{ marginTop: "var(--fh-s6)" }}>
          <div className="fh-card__body">
            <div className="fh-campo">
              <label htmlFor="insumo">Qual insumo você vai etiquetar?</label>
              <div style={{ display: "flex", gap: 10 }}>
                <select id="insumo" value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Escolha um insumo…</option>
                  {items.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {selectedProduct && (
                  <button className="fh-btn fh-btn--perigo fh-btn--icone" onClick={() => handleDeleteItem(selectedProductId)} title="Excluir item de cozinha" aria-label="Excluir item de cozinha">
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>

            {items.length === 0 && (
              <div className="fh-vazio" style={{ paddingBottom: 8 }}>
                <div className="fh-vazio__titulo">Nenhum insumo cadastrado ainda</div>
                <div className="fh-vazio__texto">
                  Insumo é o que a sua cozinha prepara e guarda: massas, molhos, queijo fatiado, carnes.
                  Cadastre o primeiro e a etiqueta dele já aparece aqui do lado.
                </div>
                <button className="fh-btn fh-btn--primario" onClick={() => setShowNewItemModal(true)} style={{ marginTop: 8 }}>
                  <Plus size={18} /> Cadastrar meu primeiro insumo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── AS TRÊS ABAS ───────────────────────────────────────────────
            Antes eram dois botões sólidos 50/50, que é aparência de
            interruptor e não de aba: nada dizia que havia um terceiro lugar
            para ir, e a configuração do papel não existia em lugar nenhum. */}
        {selectedProduct && (
          <div role="tablist" className="fh-abas" style={{ ["--n" as any]: 3, ["--i" as any]: mode === "print" ? 0 : mode === "layout" ? 1 : 2, marginTop: "var(--fh-s6)" }}>
            <button role="tab" aria-selected={mode === "print"} className="fh-aba" onClick={() => setMode("print")}>
              <Printer size={18} /> Imprimir
            </button>
            <button role="tab" aria-selected={mode === "layout"} className="fh-aba" onClick={() => setMode("layout")}>
              <Sliders size={18} /> O que sai no papel
            </button>
            <button role="tab" aria-selected={mode === "config"} className="fh-aba" onClick={() => setMode("config")}>
              <Settings size={18} /> Ficha do produto
            </button>
          </div>
        )}

        <div className="fh-duas-colunas" style={{ marginTop: "var(--fh-s6)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--fh-s6)", minWidth: 0 }}>

            {/* O aviso vive AQUI, ao lado do que a pessoa acabou de fazer —
                não no topo da página, onde ela não está olhando. */}
            {aviso && (
              <div className={`fh-aviso fh-aviso--${aviso.tom}`} role={aviso.tom === "erro" ? "alert" : "status"}>
                {aviso.tom === "ok" ? <Check size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                  : aviso.tom === "erro" ? <XCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                  : aviso.tom === "atencao" ? <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                  : <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />}
                <span style={{ flex: 1 }}>{aviso.texto}</span>
                <button onClick={() => setAviso(null)} aria-label="Fechar aviso"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", width: 32, height: 32, borderRadius: 8, flexShrink: 0 }}>
                  ✕
                </button>
              </div>
            )}

            {selectedProduct && mode === "layout" && (
              <AbaLayoutDaEtiqueta
                preset={preset}
                resolvido={camposDoPapel}
                ligados={ligados}
                onAlternar={alternarCampo}
                onTrocarPreset={trocarPreset}
                onIrParaFicha={() => setMode("config")}
                temSeloAltoEm={!!(config.highSugar || config.highSodium || config.highFat)}
                temTransgenico={!!config.transgenic}
                salvando={salvandoLayout}
              />
            )}

        {selectedProduct && mode === "config" && (
          <div style={{ background: "#FFF", padding: "24px", borderRadius: "16px", border: "1px solid #E2E8F0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid #F1F5F9", paddingBottom: "8px" }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", margin: 0 }}>Informações Gerais</h3>
                <button className="fh-btn fh-btn--secundario" onClick={handleFillWithAI} disabled={saving} style={{ height: 40, fontSize: 14 }}>
                  <Sparkles size={15} /> {saving ? "Gerando…" : "Preencher com IA"}
                </button>
              </div>
              
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Validade em Dias (Shelf Life)</label>
                <input type="number" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={config.shelfLifeDays} onChange={e => setConfig({...config, shelfLifeDays: Number(e.target.value)})} />
              </div>
              {/* ── QUANTO VEM NA EMBALAGEM — obrigatório, e sem campo livre ──
                  Era um texto livre ("Ex: 0,90kg"). Vazio, o sistema supunha
                  1 unidade; só o número, supunha unidade também. O saco de 5 kg
                  entrava no estoque como "1", em silêncio — e saldo errado por
                  palpite ninguém descobre, porque não há erro para investigar.
                  Agora são dois campos: o número e a unidade, escolhida numa
                  lista. Sem os dois, a etiqueta não imprime. */}
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>
                  Quanto vem na embalagem <span style={{ color: "#B71C1C" }}>*</span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 0,90"
                    aria-label="Quantidade"
                    value={pesoQuantidade}
                    onChange={e => aplicarPeso(e.target.value, pesoUnidade)}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: `1px solid ${pesoOk ? "#CBD5E1" : "#FCA5A5"}` }}
                  />
                  <select
                    aria-label="Unidade"
                    value={pesoUnidade}
                    onChange={e => aplicarPeso(pesoQuantidade, e.target.value)}
                    style={{ width: 130, padding: "8px 12px", borderRadius: "8px", border: `1px solid ${pesoOk ? "#CBD5E1" : "#FCA5A5"}`, background: "#fff" }}
                  >
                    <option value="">Unidade…</option>
                    <option value="un">unidade(s)</option>
                    <option value="kg">quilo (kg)</option>
                    <option value="g">grama (g)</option>
                    <option value="L">litro (L)</option>
                    <option value="ml">mililitro (ml)</option>
                  </select>
                </div>
                <div style={{ fontSize: "0.78rem", color: pesoOk ? "#64748B" : "#B71C1C", marginTop: 6, lineHeight: 1.45 }}>
                  {pesoOk
                    ? <>Cada etiqueta vai dar entrada de <strong>{textoDeQuantidade(porEtiqueta.quantidade, porEtiqueta.unidade)}</strong> no estoque.</>
                    : "Obrigatório. É o que o sistema usa para dar entrada no estoque — sem isso ele teria que adivinhar."}
                </div>
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Ingredientes</label>
                <textarea style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", resize: "none" }} rows={3} value={config.ingredients} onChange={e => setConfig({...config, ingredients: e.target.value})}></textarea>
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Alérgicos (Ex: CONTÉM OVO, LEITE...)</label>
                <textarea style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", resize: "none" }} rows={2} value={config.allergens} onChange={e => setConfig({...config, allergens: e.target.value})}></textarea>
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Modo de Preparo</label>
                <textarea style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", resize: "none" }} rows={3} value={config.preparation} onChange={e => setConfig({...config, preparation: e.target.value})}></textarea>
              </div>

              <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "12px", marginTop: "24px", borderBottom: "1px solid #F1F5F9", paddingBottom: "8px" }}>Alertas RDC 429 (Lupa) e Transgênico</h3>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.85rem" }}>
                  <input type="checkbox" checked={config.highSugar} onChange={e => setConfig({...config, highSugar: e.target.checked})} />
                  Alto em Açúcar Adicionado
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.85rem" }}>
                  <input type="checkbox" checked={config.highSodium} onChange={e => setConfig({...config, highSodium: e.target.checked})} />
                  Alto em Sódio
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.85rem" }}>
                  <input type="checkbox" checked={config.highFat} onChange={e => setConfig({...config, highFat: e.target.checked})} />
                  Alto em Gordura Sat.
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", color: "#D97706", fontWeight: "bold", fontSize: "0.85rem" }}>
                  <input type="checkbox" checked={config.transgenic} onChange={e => setConfig({...config, transgenic: e.target.checked})} />
                  Símbolo Transgênico (T)
                </label>
              </div>

              {/* ── ESTOQUE E RASTREIO ───────────────────────────────────────
                  A ficha sempre teve estes três campos e NENHUMA tela os
                  mostrava: dava para gravá-los pela action e nunca ver o
                  resultado em lugar nenhum. Sem o vínculo, a primeira leitura
                  do QR procura o insumo pelo NOME e cria um novo se não achar —
                  é assim que a mesma carne vira dois insumos no estoque. */}
              <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "6px", marginTop: "24px", borderBottom: "1px solid #F1F5F9", paddingBottom: "8px" }}>
                Estoque e rastreio
              </h3>
              <p className="fh-corpo" style={{ marginBottom: 14 }}>
                Diz ao sistema qual insumo do estoque este item alimenta quando alguém escaneia o QR.
              </p>

              <div className="fh-campo" style={{ marginBottom: 14 }}>
                <label htmlFor="insumo-vinculado">Insumo do estoque</label>
                <select
                  id="insumo-vinculado"
                  value={config.stockItemId || ""}
                  onChange={e => setConfig({ ...config, stockItemId: e.target.value })}
                >
                  <option value="">Criar um insumo com o nome deste item</option>
                  {stockItems.map(i => (
                    <option key={i.id} value={i.id}>{i.name} — saldo em {i.unit}</option>
                  ))}
                </select>
                <span className="fh-campo__dica">
                  {config.stockItemId
                    ? "Ao escanear, a entrada e a baixa caem neste insumo."
                    : "Sem escolher, o sistema procura um insumo com o mesmo nome e cria um novo se não achar — e o mesmo produto pode acabar duplicado no estoque."}
                </span>
              </div>

              <div className="fh-campo" style={{ marginBottom: 14 }}>
                <label htmlFor="cnpj-proprio">CNPJ próprio deste item (opcional)</label>
                <input
                  id="cnpj-proprio"
                  type="text"
                  value={config.customCnpj}
                  onChange={e => setConfig({ ...config, customCnpj: e.target.value })}
                  placeholder={storeCnpj || "Use o CNPJ da loja"}
                />
                <span className="fh-campo__dica">
                  Só preencha se este item for produzido por outra cozinha ou pela fábrica da rede. Vazio, a
                  etiqueta sai com o CNPJ da loja.
                </span>
              </div>

              <div className="fh-campo" style={{ marginBottom: 14 }}>
                <label htmlFor="endereco-proprio">Endereço próprio deste item (opcional)</label>
                <input
                  id="endereco-proprio"
                  type="text"
                  value={config.customAddress}
                  onChange={e => setConfig({ ...config, customAddress: e.target.value })}
                  placeholder={storeAddress || "Use o endereço da loja"}
                />
                <span className="fh-campo__dica">
                  Vazio, a etiqueta sai com o endereço da loja.
                </span>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "16px", borderBottom: "1px solid #F1F5F9", paddingBottom: "8px" }}>Informação Nutricional (100g)</h3>
              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Valor Energético (kcal)</label>
                <input type="text" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={config.energy} onChange={e => setConfig({...config, energy: e.target.value})} />
              </div>
              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Carboidratos (g)</label>
                <input type="text" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={config.carbs} onChange={e => setConfig({...config, carbs: e.target.value})} />
              </div>
              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Açúcares Totais (g)</label>
                <input type="text" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={config.sugars} onChange={e => setConfig({...config, sugars: e.target.value})} />
              </div>
              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Açúcares Adicionados (g)</label>
                <input type="text" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={config.addedSugars} onChange={e => setConfig({...config, addedSugars: e.target.value})} />
              </div>
              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Proteínas (g)</label>
                <input type="text" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={config.proteins} onChange={e => setConfig({...config, proteins: e.target.value})} />
              </div>
              <div style={{ display: "flex", gap: "1rem" }}>
                <div style={{ flex: 1, marginBottom: "10px" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Gorduras Totais (g)</label>
                  <input type="text" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={config.fatTotal} onChange={e => setConfig({...config, fatTotal: e.target.value})} />
                </div>
                <div style={{ flex: 1, marginBottom: "10px" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Gorduras Sat. (g)</label>
                  <input type="text" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={config.fatSat} onChange={e => setConfig({...config, fatSat: e.target.value})} />
                </div>
              </div>
              <div style={{ marginBottom: "10px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Sódio (mg)</label>
                <input type="text" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={config.sodium} onChange={e => setConfig({...config, sodium: e.target.value})} />
              </div>

              <button className="fh-btn fh-btn--primario" onClick={handleSaveConfig} disabled={saving} style={{ width: "100%", marginTop: 16 }}>
                <Save size={18} /> {saving ? "Salvando…" : "Salvar ficha do produto"}
              </button>
            </div>
          </div>
        )}

        {selectedProduct && mode === "print" && (
          <div className="fh-card" style={{ padding: 24 }}>
            <h2 className="fh-h2" style={{ marginBottom: 4 }}>Dados da impressão</h2>
            <p className="fh-corpo" style={{ marginBottom: 20 }}>
              A data de validade se preenche sozinha a partir do prazo cadastrado na ficha do produto.
            </p>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Lote (Opcional)</label>
                <div style={{ display: "flex", gap: "5px" }}>
                  <input type="text" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", flex: 1 }} value={lote} onChange={e => setLote(e.target.value)} placeholder="Ex: 030326" />
                  <button 
                    onClick={() => setLote(Math.floor(100000 + Math.random() * 900000).toString())} 
                    title="Gerar Lote Aleatório" 
                    style={{ padding: "0 12px", borderRadius: "8px", border: "1px solid #CBD5E1", background: "#FFF", cursor: "pointer", fontSize: "1.1rem" }}
                  >
                    🎲
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Data de Fabricação</label>
                {/* SEM `min`: com ele era literalmente impossível etiquetar o
                    que foi preparado ONTEM — o caso mais comum de cozinha, e
                    justamente o que mais precisa de etiqueta. O `min` continua
                    fazendo sentido na validade, que não pode nascer vencida. */}
                <input type="date" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={fabDate} onChange={e => setFabDate(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "4px" }}>Data de Validade</label>
                <input type="date" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }} value={valDate} onChange={e => setValDate(e.target.value)} min={todayStr} />
              </div>
            </div>

            {/* ── QR DE RASTREIO ────────────────────────────────────────────
                Explicado NA PRÓPRIA TELA onde se liga, porque é aqui que a
                dúvida aparece. */}
            <div style={{ marginTop: "18px", border: "1px solid #E2E8F0", borderRadius: "14px", overflow: "hidden" }}>
              <label style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "16px", cursor: "pointer", background: usarQr ? "#FFF4EF" : "#FFF" }}>
                <input
                  type="checkbox"
                  checked={usarQr}
                  onChange={e => setUsarQr(e.target.checked)}
                  style={{ width: 22, height: 22, marginTop: 2, accentColor: "#E8360C", flexShrink: 0, cursor: "pointer" }}
                />
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.98rem", color: "#0F172A" }}>Imprimir QR code na etiqueta</div>
                  <div style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginTop: 4 }}>
                    Na hora de usar o produto, o funcionário <strong>aponta a câmera do celular</strong> para o QR
                    e dá baixa no estoque em dois toques — sem abrir o sistema, sem procurar o item na lista.
                    A tela que abre já mostra o produto, a validade e quanto resta do lote.
                  </div>
                </div>
              </label>

              {usarQr && (
                <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: "160px" }}>
                      <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Quantas etiquetas</label>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button onClick={() => setQuantidade(q => Math.max(1, q - 1))}
                                style={{ width: 44, height: 44, borderRadius: 10, border: "1px solid #CBD5E1", background: "#FFF", fontSize: "1.3rem", fontWeight: 900, cursor: "pointer", lineHeight: 1 }}>−</button>
                        <input type="number" min={1} max={500} value={quantidade}
                               onChange={e => setQuantidade(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                               style={{ flex: 1, height: 44, textAlign: "center", borderRadius: 10, border: "1px solid #CBD5E1", fontWeight: 900, fontSize: "1.1rem" }} />
                        <button onClick={() => setQuantidade(q => Math.min(500, q + 1))}
                                style={{ width: 44, height: 44, borderRadius: 10, border: "1px solid #CBD5E1", background: "#FFF", fontSize: "1.3rem", fontWeight: 900, cursor: "pointer", lineHeight: 1 }}>+</button>
                      </div>
                    </div>
                  </div>

                  {quantidade > 1 && (
                    <div>
                      <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Numeração</label>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={() => setCodigoUnico(true)}
                                style={{ flex: 1, textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                                         border: codigoUnico ? "2px solid #E8360C" : "1px solid #E2E8F0",
                                         background: codigoUnico ? "#FFF4EF" : "#FFF" }}>
                          <div style={{ fontWeight: 800, fontSize: "0.88rem", color: codigoUnico ? "#C92E09" : "#334155" }}>Um código para a fornada</div>
                          <div style={{ fontSize: "0.76rem", color: "#64748B", lineHeight: 1.4, marginTop: 2 }}>As {quantidade} etiquetas levam o mesmo código</div>
                        </button>
                        <button onClick={() => setCodigoUnico(false)}
                                style={{ flex: 1, textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                                         border: !codigoUnico ? "2px solid #E8360C" : "1px solid #E2E8F0",
                                         background: !codigoUnico ? "#FFF4EF" : "#FFF" }}>
                          <div style={{ fontWeight: 800, fontSize: "0.88rem", color: !codigoUnico ? "#C92E09" : "#334155" }}>Um por etiqueta</div>
                          <div style={{ fontSize: "0.76rem", color: "#64748B", lineHeight: 1.4, marginTop: 2 }}>Rastreio individual, {quantidade} códigos</div>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {ultimaImpressao && (
              <div className="fh-aviso fh-aviso--ok" role="status" style={{ marginTop: 18 }}>
                <Check size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1 }}>
                  <strong>
                    {ultimaImpressao.etiquetas > 1
                      ? `${ultimaImpressao.etiquetas} etiquetas foram para a impressora.`
                      : "A etiqueta foi para a impressora."}
                  </strong>{" "}
                  {ultimaImpressao.etiquetas > 1 && (ultimaImpressao.unico ? "Todas com o mesmo código. " : "Cada uma com o código próprio. ")}
                  O estoque só se mexe quando alguém <strong>escanear o QR</strong> — cole na embalagem e escaneie
                  para dar entrada.
                </div>
                <button onClick={() => setUltimaImpressao(null)} aria-label="Fechar aviso"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", width: 32, height: 32, borderRadius: 8, flexShrink: 0 }}>
                  ✕
                </button>
              </div>
            )}

            {/* ── O QUE ISTO VAI FAZER NO ESTOQUE ─────────────────────────
                Escrito antes de imprimir, e não depois: quem descobre que a
                conta entrou errada só ao abrir o estoque já colou a etiqueta
                no pote e já guardou a mercadoria. */}
            {/* Âmbar também quando falta o peso: azul é a cor de "informação",
                e informação é justamente o que ninguém lê no meio do serviço.
                Falta de dado que impede imprimir precisa parecer o que é. */}
            <div className={`fh-aviso ${unidadeDiverge || !porEtiqueta.reconhecido ? "fh-aviso--atencao" : "fh-aviso--info"}`} style={{ marginTop: 18 }}>
              {unidadeDiverge || !porEtiqueta.reconhecido ? <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} /> : <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />}
              <div>
                {porEtiqueta.reconhecido ? (
                  <>
                    Ao escanear o QR, cada etiqueta dá entrada de{" "}
                    <strong>{textoDeQuantidade(porEtiqueta.quantidade, porEtiqueta.unidade)}</strong> no estoque
                    {quantidade > 1 && (
                      <> — as {quantidade} etiquetas somam{" "}
                        <strong>{textoDeQuantidade(porEtiqueta.quantidade * quantidade, porEtiqueta.unidade)}</strong></>
                    )}.
                    {" "}Isso vem do peso da embalagem, na aba Ficha do produto.
                    {unidadeDiverge && (
                      <>
                        {" "}<strong>Atenção:</strong> o insumo &quot;{insumoDoMesmoNome?.name}&quot; já está no seu
                        estoque em <strong>{insumoDoMesmoNome?.unit}</strong>, e esta etiqueta está em{" "}
                        <strong>{porEtiqueta.unidade}</strong>. O sistema soma o número do jeito que ele está — deixe
                        as duas na mesma unidade antes de imprimir, senão o saldo sai errado.
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <strong>Falta dizer quanto vem na embalagem.</strong> Sem isso o sistema teria que adivinhar —
                    e adivinhar quantidade vira saldo errado que ninguém descobre, porque não sobra erro nenhum
                    para investigar. Preencha o número e a unidade na aba <strong>Ficha do produto</strong>.
                  </>
                )}
              </div>
            </div>

            {erroLote && (
              <div style={{ marginTop: "12px", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 12, padding: "12px 14px", fontSize: "0.86rem", color: "#B45309", fontWeight: 700, lineHeight: 1.45 }}>
                {erroLote}
              </div>
            )}

            <button
              className="fh-btn fh-btn--primario fh-btn--cozinha"
              style={{ width: "100%", marginTop: 16 }}
              onClick={prepararEImprimir}
              disabled={!fabDate || !valDate || preparando || !porEtiqueta.reconhecido}
            >
              <Printer size={22} />
              {preparando
                ? "Preparando…"
                : quantidade > 1
                  ? `Imprimir ${quantidade} etiquetas`
                  : "Imprimir etiqueta"}
            </button>
            {(!fabDate || !valDate || !porEtiqueta.reconhecido) && (
              <p className="fh-campo__dica" style={{ marginTop: 8, textAlign: "center" }}>
                {!porEtiqueta.reconhecido
                  ? "Informe quanto vem na embalagem, na aba Ficha do produto, para liberar a impressão."
                  : "Preencha a data de fabricação para liberar a impressão."}
              </p>
            )}
            <p className="fh-campo__dica" style={{ marginTop: 8, textAlign: "center" }}>
              Na janela de impressão do navegador, deixe a margem em &quot;Nenhuma&quot; para a etiqueta sair no tamanho certo.
            </p>
          </div>
        )}

          </div>

          {/* ── A COLUNA DA PRÉVIA ─────────────────────────────────────────
              A `.print-area` mora DENTRO da bandeja: é o mesmo nó que o
              handlePrint copia para o iframe, só que encolhido por
              `transform: scale()`. Prévia com markup próprio divergiria do
              papel na primeira mudança, e o selo "PRÉVIA FIEL" viraria uma
              mentira que o lojista só descobre depois de gastar a etiqueta. */}
          <div style={{ position: "sticky", top: 16 }}>
            {selectedProduct ? (
              <BandejaDaEtiqueta quantidade={quantidade} preparando={preparando} avisos={camposDoPapel.avisos}>
            <div className="print-area">
              {/* Uma página por etiqueta. O @page de 4x6in pagina sozinho, então
                  imprimir 20 etiquetas é renderizar 20 blocos — antes um clique
                  produzia exatamente uma, e a cozinha imprimia 20 vezes na mão.

                  O markup do papel saiu daqui e virou <EtiquetaPapel>, o MESMO
                  componente que a prévia desenha: enquanto eram dois blocos de JSX,
                  nada impedia a tela e o papel de divergirem em silêncio. */}
              {(etiquetas.length > 0 ? etiquetas : [{ code: "LOLOLOLO", qr: qrDeExemplo }]).map((etq, idx) => (
                <EtiquetaPapel
                  key={idx}
                  etq={etq}
                  nomeDoProduto={selectedProduct.name}
                  config={config}
                  campos={camposDoPapel.campos}
                  textoConservacao={textoDeConservacao(layout, chaveDeConservacao)}
                  textoTransgenico={(layout?.textos?.transgenico || TEXTOS_PADRAO.transgenico)}
                  textoPorcao={(layout?.textos?.porcao || TEXTOS_PADRAO.porcao)}
                  mostrarSeloAltoEm={!seloAltoEmSuprimido(preset)}
                  storeLogo={storeLogo}
                  nomeDaLoja={storeName}
                  // A ficha do produto vence a da loja quando está preenchida:
                  // item produzido por outra cozinha não pode sair rotulado com
                  // o CNPJ desta loja. Os dois campos existiam na ficha desde
                  // sempre e a etiqueta simplesmente os ignorava.
                  cnpj={config.customCnpj?.trim() || storeCnpj}
                  endereco={config.customAddress?.trim() || storeAddress}
                  fabDate={fabDate}
                  valDate={valDate}
                  lote={lote}
                />
              ))}
            </div>
              </BandejaDaEtiqueta>
            ) : (
              <EtiquetaFantasma />
            )}
          </div>
        </div>
      </div>

      {/* A `.print-area` deixou de ser `display:none`. Ela agora é a prévia:
          fica visível dentro da bandeja, encolhida por `transform: scale()`
          (a regra vive em fh-componentes.css, em `.fh-folha .print-area`).
          O `display:none` daqui existia para esconder o papel do painel — o
          que também escondia do lojista o que ele estava prestes a imprimir. */}
    </div>
  );
}
