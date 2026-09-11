"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RoteirizacaoModal from "@/components/customer/RoteirizacaoModal";

/**
 * Casca da página /store/roteirizacao: mantém a lista de pedidos viva e
 * entrega ao RoteirizacaoModal em modo tela cheia.
 *
 * O feed é o mesmo do painel (/api/customer-order/poll, a cada 8 s). Sem
 * `from`/`to` ele devolve as últimas 24 h mais tudo que está em andamento —
 * o que a roteirização precisa. Só troca o estado quando o corpo da resposta
 * muda, pelo mesmo motivo do painel: re-render à toa fecha menu aberto e
 * reposiciona o mapa embaixo do mouse de quem está montando rota.
 */
export default function RoteirizacaoIndependente({
  user,
  initialOrders,
}: {
  user: {
    id: string;
    storeAddress?: string | null;
    city?: string | null;
    slug?: string | null;
    storeLatLng?: any;
    storeName?: string | null;
  };
  initialOrders: any[];
}) {
  const [orders, setOrders] = useState<any[]>(initialOrders);
  const ultimoCorpo = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer-order/poll?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
      });
      if (!res.ok) return;
      const corpo = await res.text();
      if (corpo === ultimoCorpo.current) return;
      ultimoCorpo.current = corpo;
      const lista = JSON.parse(corpo);
      if (Array.isArray(lista)) setOrders(lista);
    } catch (err: any) {
      console.warn("[Roteirizacao] poll falhou:", err?.message);
    }
  }, []);

  useEffect(() => {
    let ativo = true;
    const ciclo = async () => {
      await carregar();
      if (ativo) timer.current = setTimeout(ciclo, 8000);
    };
    timer.current = setTimeout(ciclo, 1000);
    return () => {
      ativo = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [carregar]);

  useEffect(() => {
    const anterior = document.title;
    document.title = `Roteirização · ${user.storeName || "FireHub"}`;
    return () => { document.title = anterior; };
  }, [user.storeName]);

  const fechar = () => {
    // Aberta por window.open/target=_blank, a aba pode se fechar sozinha. Se o
    // navegador recusar (aba aberta pela barra de endereço), leva ao painel.
    window.close();
    setTimeout(() => {
      if (!window.closed) window.location.href = "/store/pedidos-clientes";
    }, 150);
  };

  return (
    <RoteirizacaoModal
      isOpen
      modoIndependente
      onClose={fechar}
      orders={orders}
      storeAddress={user.storeAddress || undefined}
      storeCity={user.city || undefined}
      storeSlug={user.slug || undefined}
      storeId={user.id}
      storeLatLng={user.storeLatLng}
      onRefreshOrders={() => { ultimoCorpo.current = ""; void carregar(); }}
    />
  );
}
