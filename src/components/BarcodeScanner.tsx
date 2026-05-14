"use client";

import { useEffect, useState, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

interface BarcodeScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const [errorMsg, setErrorMsg] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    const scanner = new Html5Qrcode("reader", { 
      verbose: false,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13
      ]
    });
    scannerRef.current = scanner;

    scanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 300, height: 100 }
      },
      (decodedText) => {
        // Sucesso!
        scanner.stop().then(() => {
          onScan(decodedText);
        }).catch(console.error);
      },
      (error) => {
        // Erros de leitura ignorados
      }
    ).catch((err) => {
      console.error(err);
      setErrorMsg("Permissão da câmera negada ou câmera não encontrada.");
    });

    return () => {
      if (scanner.isScanning) {
        scanner.stop().catch(console.error);
      }
    };
  }, [onScan]);

  return (
    <div style={{
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0,0,0,0.8)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
      padding: "1rem"
    }}>
      <div style={{ backgroundColor: "white", padding: "1rem", borderRadius: "10px", width: "100%", maxWidth: "500px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem", alignItems: "center" }}>
          <h3 className="font-bold">Escanear Boleto</h3>
          <button type="button" onClick={() => {
            if (scannerRef.current?.isScanning) {
              scannerRef.current.stop().then(onClose).catch(() => onClose());
            } else {
              onClose();
            }
          }} style={{ color: "red", fontWeight: "bold" }}>FECHAR (X)</button>
        </div>
        
        {errorMsg && (
          <div style={{ padding: "1rem", backgroundColor: "#fee2e2", color: "#b91c1c", borderRadius: "8px", marginBottom: "1rem", textAlign: "center" }}>
            {errorMsg}
          </div>
        )}

        <div id="reader" style={{ width: "100%", minHeight: "200px", backgroundColor: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {!errorMsg && <p className="text-muted text-sm">Iniciando câmera...</p>}
        </div>
        
        <p style={{ textAlign: "center", fontSize: "0.8rem", color: "#666", marginTop: "1rem" }}>
          Aponte a câmera para o código de barras do boleto (linhas pretas).
        </p>
      </div>
    </div>
  );
}
