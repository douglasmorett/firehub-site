const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("fa", {
  permitir: () => ipcRenderer.send("permitir"),
  encerrar: () => ipcRenderer.send("encerrar"),
  aoEstado: (f) => ipcRenderer.on("estado", (_e, dado) => f(dado)),
});
