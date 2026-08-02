"use client";

import Link from "next/link";
import { ArrowLeft, Download, Puzzle, CheckCircle, AlertTriangle, ShieldCheck, Clock, Bike, Zap } from "lucide-react";

export default function ExtensaoIfoodPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0F172A", color: "#F8FAFC", padding: "1.5rem" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        
        {/* Header Voltar */}
        <div style={{ marginBottom: "1.5rem" }}>
          <Link
            href="/store/pedidos-clientes"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#94A3B8", textDecoration: "none", fontSize: "0.88rem", fontWeight: 700 }}
          >
            <ArrowLeft size={16} /> Voltar para o Painel de Pedidos
          </Link>
        </div>

        {/* Hero Section */}
        <div style={{ background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)", border: "1px solid #334155", borderRadius: 20, padding: "2rem", marginBottom: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg, #FF5722, #F44336)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", fontWeight: 900, boxShadow: "0 4px 14px rgba(255,87,34,0.4)" }}>
              🧩
            </div>
            <div>
              <span style={{ fontSize: "0.72rem", fontWeight: 800, background: "#064E3B", color: "#34D399", padding: "2px 10px", borderRadius: 12, border: "1px solid #059669" }}>
                EXTENSÃO OFICIAL FIREHUB
              </span>
              <h1 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "4px 0 0", color: "#FFF" }}>
                Automação de Prazo de Entrega iFood
              </h1>
            </div>
          </div>

          <p style={{ color: "#94A3B8", fontSize: "0.95rem", lineHeight: 1.5, marginBottom: "1.5rem" }}>
            Ajuste automaticamente os prazos de entrega da sua loja no **Portal do iFood** e no **Cardápio Próprio FireHub** com base na carga real da cozinha (KDS) e na quantidade de motoboys em atendimento na casa.
          </p>

          <a
            href="/api/download/extension"
            download="firehub-ifood-extension.zip"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 28px",
              borderRadius: 14,
              background: "linear-gradient(135deg, #FF5722 0%, #E64A19 100%)",
              color: "#FFF",
              fontWeight: 900,
              fontSize: "1rem",
              textDecoration: "none",
              boxShadow: "0 6px 20px rgba(255,87,34,0.5)",
              transition: "transform 0.2s",
            }}
          >
            <Download size={20} /> Baixar Extensão do Chrome (.ZIP)
          </a>
        </div>

        {/* Linha de Raciocínio & Modos */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
          
          {/* Modo Automático */}
          <div style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 16, padding: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#38BDF8", fontWeight: 900, fontSize: "1rem", marginBottom: 8 }}>
              🤖 Modo Automático (Planilha Hakim)
            </div>
            <p style={{ fontSize: "0.82rem", color: "#94A3B8", lineHeight: 1.4, marginBottom: 12 }}>
              Você só informa a quantidade de **motoboys na casa** (`1, 2, 3... 6`). O robô monitora o KDS em tempo real e calcula a regra exata:
            </p>
            <ul style={{ fontSize: "0.78rem", color: "#CBD5E1", paddingLeft: 18, lineHeight: 1.6 }}>
              <li><b>1 Motoboy:</b> até 2 ped (38m) • 3 ped (58m) • 4 ped (78m)</li>
              <li><b>2 Motoboys:</b> até 4 ped (38m) • 6 ped (58m) • 8 ped (78m)</li>
              <li><b>3 Motoboys:</b> até 6 ped (38m) • 9 ped (58m) • 12 ped (78m)</li>
              <li><b style={{ color: "#FCA5A5" }}>🚨 Estouro de Capacidade:</b> Fecha a loja por 40 min!</li>
            </ul>
          </div>

          {/* Modo Manual */}
          <div style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 16, padding: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#F59E0B", fontWeight: 900, fontSize: "1rem", marginBottom: 8 }}>
              ✍️ Modo Manual (Override Rápido)
            </div>
            <p style={{ fontSize: "0.82rem", color: "#94A3B8", lineHeight: 1.4, marginBottom: 12 }}>
              Não exige informar motoboys. Permite ao operador digitar diretamente o parâmetro desejado na hora:
            </p>
            <ul style={{ fontSize: "0.78rem", color: "#CBD5E1", paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Informe a <b>quantidade de pedidos</b> (ex: 15 pedidos)</li>
              <li>Informe o <b>prazo em minutos</b> (ex: 60 min)</li>
              <li>Clique em <b>"Aplicar Tempo Manual"</b> e trava na hora no iFood.</li>
            </ul>
          </div>

        </div>

        {/* Guia de Instalação */}
        <div style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 900, margin: "0 0 1rem", color: "#FFF" }}>
            📖 Como Instalar a Extensão no Google Chrome (3 Passos Rápidos)
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ background: "#FF5722", color: "#FFF", fontWeight: 900, borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", flexShrink: 0 }}>
                1
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#FFF" }}>Baixe e Extraia o Arquivo .ZIP</div>
                <div style={{ fontSize: "0.82rem", color: "#94A3B8", marginTop: 2 }}>
                  Clique no botão vermelho acima para baixar o arquivo <code style={{ background: "#0F172A", padding: "2px 6px", borderRadius: 4, color: "#FF7A59" }}>firehub-ifood-extension.zip</code>. Extraia o conteúdo para uma pasta no seu computador.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ background: "#FF5722", color: "#FFF", fontWeight: 900, borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", flexShrink: 0 }}>
                2
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#FFF" }}>Acesse chrome://extensions no Navegador</div>
                <div style={{ fontSize: "0.82rem", color: "#94A3B8", marginTop: 2 }}>
                  Abra uma nova aba no Google Chrome, digite <code style={{ background: "#0F172A", padding: "2px 6px", borderRadius: 4, color: "#38BDF8" }}>chrome://extensions</code> e ative a chave <b>"Modo do desenvolvedor"</b> no canto superior direito.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ background: "#FF5722", color: "#FFF", fontWeight: 900, borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", flexShrink: 0 }}>
                3
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#FFF" }}>Carregar sem compactação (Load Unpacked)</div>
                <div style={{ fontSize: "0.82rem", color: "#94A3B8", marginTop: 2 }}>
                  Clique no botão <b>"Carregar sem compactação"</b> no canto superior esquerdo e selecione a pasta da extensão descompactada. Pronto! O ícone 🔥 do FireHub aparecerá no seu navegador.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Orientação ao Lojista */}
        <div style={{ background: "rgba(245, 158, 11, 0.1)", border: "1.5px solid #F59E0B", borderRadius: 16, padding: "1.25rem", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: "1.8rem" }}>💡</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: "0.95rem", color: "#FDE68A", marginBottom: 2 }}>
              Orientação Importante de Operação
            </div>
            <div style={{ fontSize: "0.82rem", color: "#FEF3C7", lineHeight: 1.4 }}>
              Mantenha a aba do <b>Portal do Parceiro iFood (<a href="https://portal.ifood.com.br" target="_blank" rel="noopener noreferrer" style={{ color: "#38BDF8", textDecoration: "underline" }}>portal.ifood.com.br</a>)</b> aberta no seu computador, logada na área de entregas. Caso a aba seja fechada por engano, a extensão abrirá a página automaticamente no seu Chrome!
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
