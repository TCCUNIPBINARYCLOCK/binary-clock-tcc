// Dentro de src/preload.js

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Funções que já tínhamos
  explainCode: (code) => ipcRenderer.invoke("ask-gemini-explain", code),
  saveFile: (content) => ipcRenderer.invoke("save-file", content),

  // Nova função adicionada para carregar módulos do Node.js de forma segura
  require: (module) => require(module),
});
