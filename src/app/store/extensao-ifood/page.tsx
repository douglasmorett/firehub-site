"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Puzzle,
  CheckCircle,
  AlertTriangle,
  Zap,
  Flame,
  Clock,
  Bike,
  ShieldCheck,
  Sparkles,
  Bot,
  Layers,
  HelpCircle,
} from "lucide-react";

export default function ExtensaoIfoodPage() {
  const [selectedMotoboys, setSelectedMotoboys] = useState<number>(3);

  // Tabela Hakim por motoboys
  const getHakimRanges = (m: number) => ({
    max38: m * 2,
    max58: m * 3,
    max78: m * 4,
  });

  const activeRanges = getHakimRanges(selectedMotoboys);

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", color: "#0F172A", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      
      {/* Top Header Bar */}
      <div style={{ background: "linear-gradient(90deg, #E8360C 0%, #FF5722 100%)", color: "#FFF", padding: "0.85rem 1.5rem", boxShadow: "0 4px 12px rgba(232, 54, 12, 0.25)" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link
            href="/store/pedidos-clientes"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#FFF", textDecoration: "none", fontSize: "0.85rem", fontWeight: 800, background: "rgba(255,255,255,0.18)", padding: "5px 12px", borderRadius: 8 }}
          >
            <ArrowLeft size={16} /> Voltar ao Painel
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, fontSize: "0.95rem" }}>
            <Flame size={20} /> FIREHUB AUTO-ETA
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* HERO SECTION */}
        <div style={{ background: "#FFF", borderRadius: 24, padding: "2.5rem", border: "1px solid #E2E8F0", boxShadow: "0 10px 30px rgba(0,0,0,0.05)", marginBottom: "2rem", display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "2rem", alignItems: "center" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", fontSize: "0.75rem", fontWeight: 900, padding: "4px 12px", borderRadius: 20, marginBottom: 12 }}>
              <Sparkles size={14} /> INOVAÇÃO EXCLUSIVA FIREHUB
            </div>

            <h1 style={{ fontSize: "2.2rem", fontWeight: 900, lineHeight: 1.2, color: "#0F172A", margin: "0 0 12px", letterSpacing: "-0.5px" }}>
              Revolucione a Gestão do Tempo de Entrega no iFood & Site
            </h1>

            <p style={{ fontSize: "1rem", color: "#475569", lineHeight: 1.6, margin: "0 0 1.5rem" }}>
              Nós sabemos como é estressante para o dono de restaurante ter que ficar ajustando o iFood manualmente no meio da correria do atendimento. 
              <br />
              <strong style={{ color: "#E8360C" }}>Focamos em inovar para você NUNCA MAIS se preocupar com esse problema!</strong> A primeira tecnologia que lê a carga real da sua cozinha e ajusta o iFood e seu site nos bastidores!
            </p>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <a
                href="/api/download/extension"
                download="firehub-ifood-extension.zip"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "14px 28px",
                  borderRadius: 14,
                  background: "linear-gradient(135deg, #E8360C 0%, #FF5722 100%)",
                  color: "#FFF",
                  fontWeight: 900,
                  fontSize: "1.05rem",
                  textDecoration: "none",
                  boxShadow: "0 6px 20px rgba(232, 54, 12, 0.4)",
                }}
              >
                <Download size={20} /> Baixar Extensão Grátis (.ZIP)
              </a>

              <span style={{ fontSize: "0.78rem", color: "#64748B", fontWeight: 700 }}>
                ⚡ Instalação em menos de 1 minuto
              </span>
            </div>
          </div>

          {/* Banner Hero Image */}
          <div style={{ borderRadius: 20, overflow: "hidden", border: "1px solid #E2E8F0", boxShadow: "0 8px 24px rgba(0,0,0,0.08)", background: "#FFF" }}>
            <img
              src="/images/ifood-eta-banner.jpg"
              alt="FireHub iFood Dynamic ETA"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>
        </div>

        {/* ANTES x DEPOIS (A DOR vs A SOLUÇÃO) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "2.5rem" }}>
          
          {/* A Dor do Lojista */}
          <div style={{ background: "#FFF", border: "1.5px solid #FCA5A5", borderRadius: 20, padding: "1.5rem", boxShadow: "0 4px 14px rgba(239, 68, 68, 0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#DC2626", fontWeight: 900, fontSize: "1.1rem", marginBottom: 12 }}>
              <AlertTriangle size={20} /> O Problema no Seu Dia a Dia (Antes)
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10, fontSize: "0.88rem", color: "#475569" }}>
              <li style={{ display: "flex", gap: 8 }}>❌ <span>Esquecer de aumentar o tempo no iFood quando a cozinha enche.</span></li>
              <li style={{ display: "flex", gap: 8 }}>❌ <span>Clientes reclamando de atrasos, cancelamentos e avaliações 1 estrela.</span></li>
              <li style={{ display: "flex", gap: 8 }}>❌ <span>Ter que parar o atendimento para ficar mexendo no Portal do iFood.</span></li>
              <li style={{ display: "flex", gap: 8 }}>❌ <span>Divergência entre o tempo do seu site próprio e do iFood.</span></li>
            </ul>
          </div>

          {/* A Revolução FireHub */}
          <div style={{ background: "#FFF", border: "1.5px solid #86EFAC", borderRadius: 20, padding: "1.5rem", boxShadow: "0 4px 14px rgba(34, 197, 94, 0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#166534", fontWeight: 900, fontSize: "1.1rem", marginBottom: 12 }}>
              <CheckCircle size={20} /> A Solução Inteligente FireHub (Agora)
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10, fontSize: "0.88rem", color: "#475569" }}>
              <li style={{ display: "flex", gap: 8 }}>✅ <b>Automação 100% Silenciosa:</b> Atualiza o iFood nos bastidores sem atrapalhar a tela do caixa.</li>
              <li style={{ display: "flex", gap: 8 }}>✅ <b>Inteligência do KDS:</b> Lê exatamente quantos pedidos estão em produção e quantos motoboys estão na casa.</li>
              <li style={{ display: "flex", gap: 8 }}>✅ <b>Sincronização Dupla:</b> Altera o iFood e seu site próprio ao mesmo tempo.</li>
              <li style={{ display: "flex", gap: 8 }}>✅ <b>Trava de Estouro:</b> Pausa a loja por 40 min se estourar o limite de segurança.</li>
            </ul>
          </div>

        </div>

        {/* TABELA HAKIM INTERATIVA */}
        <div style={{ background: "#FFF", borderRadius: 24, padding: "2rem", border: "1px solid #E2E8F0", boxShadow: "0 6px 20px rgba(0,0,0,0.04)", marginBottom: "2.5rem" }}>
          <div style={{ textAlign: "center", maxWidth: "650px", margin: "0 auto 1.5rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 900, color: "#E8360C", background: "#FFF1F0", padding: "4px 12px", borderRadius: 12 }}>
              REGRA DE INTELIGÊNCIA DA COZINHA
            </span>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 900, color: "#0F172A", margin: "8px 0 6px" }}>
              Simulador da Planilha Oficial de Prazos Hakim
            </h2>
            <p style={{ fontSize: "0.88rem", color: "#64748B" }}>
              Selecione a quantidade de motoboys abaixo e veja como o robô calcula a capacidade de entrega em tempo real:
            </p>
          </div>

          {/* Selector de Motoboys */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: "1.5rem", flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5, 6].map((m) => (
              <button
                key={m}
                onClick={() => setSelectedMotoboys(m)}
                style={{
                  padding: "10px 20px",
                  borderRadius: 12,
                  border: selectedMotoboys === m ? "2px solid #E8360C" : "1.5px solid #CBD5E1",
                  background: selectedMotoboys === m ? "#E8360C" : "#FFF",
                  color: selectedMotoboys === m ? "#FFF" : "#475569",
                  fontWeight: 900,
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  boxShadow: selectedMotoboys === m ? "0 4px 12px rgba(232, 54, 12, 0.3)" : "none",
                  transition: "all 0.2s",
                }}
              >
                🛵 {m} {m === 1 ? "Motoboy" : "Motoboys"}
              </button>
            ))}
          </div>

          {/* Cards da Faixa Calculada */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
            
            <div style={{ background: "#F0FDF4", border: "1.5px solid #86EFAC", borderRadius: 16, padding: "1.2rem", textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#166534" }}>38 min</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#15803D", marginTop: 4 }}>
                Até {activeRanges.max38} Pedidos
              </div>
              <div style={{ fontSize: "0.7rem", color: "#475569", marginTop: 4 }}>Cozinha Leve</div>
            </div>

            <div style={{ background: "#FEFCE8", border: "1.5px solid #FDE047", borderRadius: 16, padding: "1.2rem", textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#CA8A04" }}>58 min</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#A16207", marginTop: 4 }}>
                Até {activeRanges.max58} Pedidos
              </div>
              <div style={{ fontSize: "0.7rem", color: "#475569", marginTop: 4 }}>Cozinha Moderada</div>
            </div>

            <div style={{ background: "#FFF7ED", border: "1.5px solid #FDBA74", borderRadius: 16, padding: "1.2rem", textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#C2410C" }}>78 min</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#9A3412", marginTop: 4 }}>
                Até {activeRanges.max78} Pedidos
              </div>
              <div style={{ fontSize: "0.7rem", color: "#475569", marginTop: 4 }}>Cozinha Movimentada</div>
            </div>

            <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 16, padding: "1.2rem", textAlign: "center" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#DC2626", marginTop: 4 }}>⚠️ PAUSAR 40m</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#991B1B", marginTop: 4 }}>
                Acima de {activeRanges.max78} Pedidos
              </div>
              <div style={{ fontSize: "0.7rem", color: "#DC2626", fontWeight: 700, marginTop: 4 }}>Trava de Segurança</div>
            </div>

          </div>
        </div>

        {/* OS 2 MODOS PODEROSOS */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "2.5rem" }}>
          
          <div style={{ background: "#FFF", borderRadius: 20, padding: "1.75rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 14px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#EFF6FF", color: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Bot size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 900, margin: 0, color: "#0F172A" }}>Aba 🤖 Modo Automático</h3>
                <span style={{ fontSize: "0.72rem", color: "#64748B" }}>Inteligência Total KDS + Motoboys</span>
              </div>
            </div>
            <p style={{ fontSize: "0.88rem", color: "#475569", lineHeight: 1.5 }}>
              O operador seleciona apenas a quantidade de motoboys na casa. O robô monitora o KDS em segundo plano e ajusta o iFood e o site a cada 5 minutos automaticamente.
            </p>
          </div>

          <div style={{ background: "#FFF", borderRadius: 20, padding: "1.75rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 14px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FFF7ED", color: "#EA580C", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Layers size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 900, margin: 0, color: "#0F172A" }}>Aba ✍️ Modo Manual</h3>
                <span style={{ fontSize: "0.72rem", color: "#64748B" }}>Override Instantâneo do Operador</span>
              </div>
            </div>
            <p style={{ fontSize: "0.88rem", color: "#475569", lineHeight: 1.5 }}>
              Não exige informar motoboys. O operador pode digitar diretamente a quantidade de pedidos e o prazo em minutos para travar o tempo imediatamente quando desejar.
            </p>
          </div>

        </div>

        {/* PASSO A PASSO DE INSTALAÇÃO */}
        <div style={{ background: "#FFF", borderRadius: 24, padding: "2rem", border: "1px solid #E2E8F0", boxShadow: "0 6px 20px rgba(0,0,0,0.04)", marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 900, color: "#0F172A", margin: "0 0 1.5rem", textAlign: "center" }}>
            📖 Instalação em 3 Passos Simples no Google Chrome
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.25rem" }}>
            
            <div style={{ background: "#F8FAFC", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0" }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: "#E8360C", color: "#FFF", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                1
              </div>
              <h4 style={{ fontSize: "0.95rem", fontWeight: 900, color: "#0F172A", margin: "0 0 6px" }}>Baixe o Arquivo .ZIP</h4>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.4, margin: 0 }}>
                Clique no botão de download acima para baixar o arquivo <code style={{ background: "#E2E8F0", padding: "2px 6px", borderRadius: 4, color: "#E8360C" }}>firehub-ifood-extension.zip</code>. Extraia o conteúdo no seu computador.
              </p>
            </div>

            <div style={{ background: "#F8FAFC", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0" }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: "#E8360C", color: "#FFF", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                2
              </div>
              <h4 style={{ fontSize: "0.95rem", fontWeight: 900, color: "#0F172A", margin: "0 0 6px" }}>Abra as Extensões</h4>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.4, margin: 0 }}>
                Abra uma nova aba no Chrome, acesse <code style={{ background: "#E2E8F0", padding: "2px 6px", borderRadius: 4, color: "#2563EB" }}>chrome://extensions</code> e ative o <b>"Modo do desenvolvedor"</b> no canto superior direito.
              </p>
            </div>

            <div style={{ background: "#F8FAFC", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0" }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: "#E8360C", color: "#FFF", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                3
              </div>
              <h4 style={{ fontSize: "0.95rem", fontWeight: 900, color: "#0F172A", margin: "0 0 6px" }}>Carregar sem Compactação</h4>
              <p style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.4, margin: 0 }}>
                Clique em <b>"Carregar sem compactação"</b> (Load Unpacked) e selecione a pasta extraída. O ícone 🔥 do FireHub aparecerá pronto no seu navegador!
              </p>
            </div>

          </div>
        </div>

        {/* ORIENTAÇÃO AO LOJISTA */}
        <div style={{ background: "linear-gradient(135deg, #FEF3C7 0%, #FFFBEB 100%)", border: "1.5px solid #F59E0B", borderRadius: 20, padding: "1.5rem", display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ fontSize: "2rem" }}>💡</div>
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 900, color: "#92400E", margin: "0 0 4px" }}>
              Dica de Ouro de Operação
            </h3>
            <p style={{ fontSize: "0.88rem", color: "#78350F", lineHeight: 1.5, margin: 0 }}>
              Mantenha a aba do <b>Portal do Parceiro iFood (<a href="https://portal.ifood.com.br" target="_blank" rel="noopener noreferrer" style={{ color: "#D97706", textDecoration: "underline" }}>portal.ifood.com.br</a>)</b> aberta no computador do caixa. Se por acaso a aba for fechada por engano, a extensão abrirá a página automaticamente no Chrome para garantir que sua loja nunca fique desatualizada!
            </p>
          </div>
        </div>

        {/* BOTTOM CTA */}
        <div style={{ textAlign: "center", marginTop: "3rem", paddingBottom: "2rem" }}>
          <a
            href="/api/download/extension"
            download="firehub-ifood-extension.zip"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "16px 36px",
              borderRadius: 16,
              background: "linear-gradient(135deg, #E8360C 0%, #FF5722 100%)",
              color: "#FFF",
              fontWeight: 900,
              fontSize: "1.1rem",
              textDecoration: "none",
              boxShadow: "0 8px 25px rgba(232, 54, 12, 0.4)",
            }}
          >
            <Download size={22} /> Baixar Extensão do Chrome Agora (.ZIP)
          </a>
        </div>

      </div>
    </div>
  );
}
