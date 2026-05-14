"use client";
/**
 * FireHub — Som de alerta para novos pedidos
 * Toca um som configurável quando chega pedido novo
 * Sounds: bell | chime | beep | none
 */
import { useEffect, useRef } from "react";

const SOUNDS: Record<string, string> = {
  bell: "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAA...", // placeholder — usar arquivo real
  chime: "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAA...",
  beep: "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAA...",
};

// Gera um beep sintético via Web Audio API (funciona sem arquivo)
function playBeep(type: string) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (type === "bell") {
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.8);
    } else if (type === "chime") {
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(1046, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 1.2);
    } else if (type === "beep") {
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(440, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
      gainNode.gain.setValueAtTime(0, ctx.currentTime + 0.15);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.15);
    }
  } catch (e) {
    console.warn("AudioContext não disponível:", e);
  }
}

export default function OrderAlertSound({
  enabled, soundType = "bell", trigger
}: {
  enabled: boolean;
  soundType?: string;
  trigger: number; // Incrementar para tocar o som
}) {
  const prevTrigger = useRef(trigger);

  useEffect(() => {
    if (!enabled || soundType === "none") return;
    if (trigger > prevTrigger.current) {
      playBeep(soundType);
    }
    prevTrigger.current = trigger;
  }, [trigger, enabled, soundType]);

  return null;
}

// Exporta para uso manual
export { playBeep };
