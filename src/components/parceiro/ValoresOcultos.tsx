"use client";

/**
 * O OLHO DO PORTAL — esconde o dinheiro da tela (comissão, repasses, valor por
 * loja, médias) para o parceiro mostrar o celular em lugar público.
 *
 * Pedido do Victor pelo Douglas (14/10/2026): o portal abre SEMPRE com os
 * valores escondidos; tocar no olho mostra, tocar de novo esconde. Não guarda
 * a escolha de propósito — a próxima visita começa oculta de novo.
 *
 * Porcentagem e contagem (lojas, pedidos) continuam à vista: o que se esconde
 * é só o valor em R$. Todo valor em dinheiro do portal passa por useDinheiro().
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const OCULTO = "R$ •••••";

const Contexto = createContext<{ oculto: boolean; alternar: () => void }>({ oculto: false, alternar: () => {} });

export function OcultarValoresProvider({ inicioOculto, children }: { inicioOculto: boolean; children: ReactNode }) {
  const [oculto, setOculto] = useState(inicioOculto);
  return <Contexto.Provider value={{ oculto, alternar: () => setOculto((o) => !o) }}>{children}</Contexto.Provider>;
}

/** O formatador de R$ da tela: devolve "R$ •••••" enquanto o olho estiver fechado. */
export function useDinheiro() {
  const { oculto } = useContext(Contexto);
  return (v: number) => (oculto ? OCULTO : brl(v));
}

/** O botão do cabeçalho. O ícone mostra o que o toque faz, como no campo de senha do login. */
export function OlhoDosValores({ className }: { className?: string }) {
  const { oculto, alternar } = useContext(Contexto);
  const rotulo = oculto ? "Mostrar valores" : "Ocultar valores";
  return (
    <button type="button" className={className} onClick={alternar} title={rotulo} aria-label={rotulo}>
      {oculto ? <Eye size={17} aria-hidden /> : <EyeOff size={17} aria-hidden />}
    </button>
  );
}
