// ======================================================
//  src/renderer/renderer.js  —  Adicionado botão Dashboard
// ======================================================

const { ipcRenderer } = require("electron");
const path = require("path");
const { Terminal } = require("@xterm/xterm");
const { FitAddon } = require("@xterm/addon-fit");

// --- Estado Global ---
const appState = {
  editor: null,
  openFiles: [],
  activeFileIndex: -1,
  untitledCounter: 1,
  currentFolderPath: null,
  lastActivityTimestamp: Date.now(),
};

let aiOutput,
  fileTreePanel,
  tabBar,
  sidebar,
  panel,
  activityFilesButton,
  activityAiButton,
  activitySettingsButton,
  activityDashboardButton, // !!! MUDANÇA 1: Variável adicionada
  openFolderButton,
  newFileButton,
  explainButton,
  refactorButton,
  executeCodeButton,
  saveFileButton,
  panelToggleButton,
  panelCloseButton,
  statusBarLineCol,
  statusBarLanguage,
  settingsModal,
  statsModal,
  closeSettingsModal,
  closeStatsModal,
  saveSettingsButton,
  themeSelect,
  fontSizeInput,
  statsButton,
  findButton,
  replaceButton;

let term, fitAddon;

// --- Carregamento do Monaco ---
const amdLoader = require("../../node_modules/monaco-editor/min/vs/loader.js");
const amdRequire = amdLoader.require;

function uriFromPath(_path) {
  let pathName = path.resolve(_path).replace(/\\/g, "/");
  if (pathName.length > 0 && pathName.charAt(0) !== "/")
    pathName = "/" + pathName;
  return encodeURI("file://" + pathName);
}

amdRequire.config({
  baseUrl: uriFromPath(
    path.join(__dirname, "../../node_modules/monaco-editor/min")
  ),
});

self.module = undefined;

// =========================================================
// == INICIALIZAÇÃO PRINCIPAL - Espera o Monaco Carregar ==
// =========================================================
amdRequire(["vs/editor/editor.main"], async function () {
  const editorContainer = document.getElementById("editor-container");
  if (!editorContainer) {
    console.error("ERRO CRÍTICO: #editor-container não encontrado!");
    return;
  }

  const settings = await ipcRenderer.invoke("get-settings");

  appState.editor = monaco.editor.create(editorContainer, {
    value: "// Use 📁 para abrir",
    language: "plaintext",
    theme: settings.theme || "vs-dark",
    fontSize: settings.fontSize || 14,
    readOnly: true,
    automaticLayout: true,
    minimap: { enabled: true },
    wordWrap: "on",
  });

  appState.editor.onDidChangeModelContent(() => {
    appState.lastActivityTimestamp = Date.now();
    markActiveTabUnsaved(true);
  });
  appState.editor.onDidChangeCursorPosition(updateStatusBarPosition);

  if (!captureUIElements()) return;

  setupAICompletions();
  initializeTerminal();

  // força estado inicial consistente: TERMINAL visível
  switchPanelTabById("terminal-content");
  panel?.classList.remove("collapsed");

  attachEventListeners();
  updateStatusBar();
});

// =========================================================
// --- Captura Referências da UI ---
function captureUIElements() {
  try {
    aiOutput = document.getElementById("ai-output");
    fileTreePanel = document.getElementById("file-tree-panel");
    tabBar = document.getElementById("tab-bar");
    sidebar = document.querySelector(".sidebar");
    panel = document.querySelector(".panel");
    activityFilesButton = document.getElementById("activity-files");
    activityAiButton = document.getElementById("activity-ai");
    activitySettingsButton = document.getElementById("activity-settings");
    activityDashboardButton = document.getElementById("activity-dashboard"); // !!! MUDANÇA 2: Elemento capturado
    openFolderButton = document.getElementById("open-folder-button");
    newFileButton = document.getElementById("new-file-button");
    explainButton = document.getElementById("explain-button");
    refactorButton = document.getElementById("refactor-button");
    executeCodeButton = document.getElementById("execute-code-button");
    saveFileButton = document.getElementById("save-file-button");
    panelToggleButton = document.getElementById("panel-toggle-button");
    panelCloseButton = document.getElementById("panel-close-button");
    statusBarLineCol = document.getElementById("status-line-col");
    statusBarLanguage = document.getElementById("status-language");
    settingsModal = document.getElementById("settings-modal");
    statsModal = document.getElementById("stats-modal");
    closeSettingsModal = document.getElementById("close-settings-modal");
    closeStatsModal = document.getElementById("close-stats-modal");
    saveSettingsButton = document.getElementById("save-settings-button");
    themeSelect = document.getElementById("theme-select");
    fontSizeInput = document.getElementById("font-size-input");
    statsButton = document.getElementById("stats-button");
    findButton = document.getElementById("find-button");
    replaceButton = document.getElementById("replace-button");

    if (
      !aiOutput ||
      !fileTreePanel ||
      !tabBar ||
      !sidebar ||
      !panel ||
      !activityFilesButton ||
      !openFolderButton ||
      !executeCodeButton ||
      !statusBarLineCol
    ) {
      console.error("ERRO CRÍTICO: Falha ao encontrar elementos da UI!");
      return false;
    }
    return true;
  } catch (error) {
    console.error("ERRO CRÍTICO ao capturar UI:", error);
    return false;
  }
}

// =========================================================
// --- Terminal ---
function initializeTerminal() {
  try {
    const terminalContainer = document.getElementById("terminal-container");
    if (!terminalContainer) {
      console.error("ERRO CRÍTICO: #terminal-container não encontrado!");
      return;
    }

    term = new Terminal({
      cursorBlink: true,
      theme: { background: "#0b0b12", foreground: "#f3f4f6" },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalContainer);
    try {
      fitAddon.fit();
    } catch {}

    // Mensagens iniciais removidas para um terminal limpo

    // Envio/recepção com o processo principal
    term.onData((e) => ipcRenderer.send("terminal-command", e));
    ipcRenderer.on("terminal-data", (_event, data) => {
      try {
        term.write(data);
      } catch (e) {
        console.error("term.write erro:", e);
      }
    });

    // Aviso 'terminal-renderer-ready' removido

    window.addEventListener("resize", () => {
      try {
        if (fitAddon) fitAddon.fit();
      } catch {}
      if (appState.editor) appState.editor.layout();
    });
  } catch (error) {
    console.error("ERRO durante a inicialização do terminal:", error);
  }
}

// =========================================================
// --- File Tree / Tabs / Editor ---
async function renderFileTree(dirPath) {
  aiOutput.innerText = "Lendo pastas...";
  try {
    const tree = await ipcRenderer.invoke("read-folder-recursive", dirPath);
    function createTreeHtml(nodes) {
      if (!nodes) return "";
      let html = "<ul>";
      for (const node of nodes) {
        if (!node) continue;
        html += `<li class="${node.type}-item" data-path="${node.path}" title="${node.path}">${node.name}</li>`;
        if (node.type === "folder" && node.children?.length > 0) {
          html += createTreeHtml(node.children);
        }
      }
      return html + "</ul>";
    }
    fileTreePanel.innerHTML = createTreeHtml(tree);
    aiOutput.innerText = "Pastas carregadas.";
  } catch (e) {
    console.error("Erro renderFileTree:", e);
    aiOutput.innerText = "Erro ao ler pastas.";
  }
}

async function openFile(filePath) {
  const existingIndex = appState.openFiles.findIndex(
    (f) => f.filePath === filePath
  );
  if (existingIndex !== -1) {
    setActiveTab(existingIndex);
    return;
  }
  aiOutput.innerText = `Abrindo ${path.basename(filePath)}...`;
  try {
    const result = await ipcRenderer.invoke("read-file", filePath);
    if (result.success && appState.editor) {
      const language = getLanguageFromPath(filePath);
      const newModel = monaco.editor.createModel(result.content, language);
      appState.openFiles.push({ filePath, model: newModel, viewState: null });
      renderTabs();
      setActiveTab(appState.openFiles.length - 1);
    } else {
      aiOutput.innerText = `Erro ao abrir: ${
        result.error || "Editor não pronto."
      }`;
    }
  } catch (e) {
    console.error("Erro openFile:", e);
    aiOutput.innerText = "Erro ao abrir arquivo.";
  }
}

function renderTabs() {
  tabBar.innerHTML = "";
  appState.openFiles.forEach((file, index) => {
    const tab = document.createElement("div");
    tab.className = "tab";
    tab.dataset.index = index;

    const title = document.createElement("span");
    title.innerText = file.filePath
      ? path.basename(file.filePath)
      : file.temporaryName;
    tab.appendChild(title);

    const close = document.createElement("span");
    close.className = "close-tab";
    close.innerText = " ×";
    close.dataset.index = index;
    tab.appendChild(close);

    tabBar.appendChild(tab);
  });
  updateActiveTabUI();
  markActiveTabUnsaved(false);
}

function setActiveTab(index) {
  if (index < 0 || index >= appState.openFiles.length || !appState.editor) {
    if (appState.editor) {
      appState.editor.setModel(null);
      appState.editor.setValue("// Nenhum arquivo");
      appState.editor.updateOptions({ readOnly: true });
    }
    appState.activeFileIndex = -1;
    updateStatusBar();
    updateActiveTabUI();
    return;
  }
  if (
    appState.activeFileIndex > -1 &&
    appState.openFiles[appState.activeFileIndex]
  ) {
    appState.openFiles[appState.activeFileIndex].viewState =
      appState.editor.saveViewState();
  }
  appState.activeFileIndex = index;
  const file = appState.openFiles[index];
  appState.editor.setModel(file.model);
  if (file.viewState) appState.editor.restoreViewState(file.viewState);

  if (file.filePath) updateEditorLanguage(file.filePath);
  else monaco.editor.setModelLanguage(file.model, "plaintext");

  appState.editor.updateOptions({ readOnly: false });
  appState.editor.focus();
  updateStatusBar();
  updateActiveTabUI();
  markActiveTabUnsaved(false);
}

function closeTab(index) {
  if (index < 0 || index >= appState.openFiles.length) return;
  const file = appState.openFiles[index];
  file.model.dispose();
  appState.openFiles.splice(index, 1);
  let nextIndex = -1;
  if (appState.activeFileIndex === index) {
    nextIndex = appState.openFiles.length > 0 ? Math.max(0, index - 1) : -1;
  } else if (appState.activeFileIndex > index) {
    nextIndex = appState.activeFileIndex - 1;
  } else {
    nextIndex = appState.activeFileIndex;
  }
  renderTabs();
  setActiveTab(nextIndex);
}

function updateActiveTabUI() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle(
      "active",
      parseInt(tab.dataset.index, 10) === appState.activeFileIndex
    );
  });
}

function getLanguageFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".json": "json",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".less": "less",
    ".py": "python",
    ".java": "java",
    ".cs": "csharp",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cc": "cpp",
    ".go": "go",
    ".php": "php",
    ".rb": "ruby",
    ".rs": "rust",
    ".sql": "sql",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".sh": "shell",
    ".ps1": "powershell",
    ".bat": "bat",
    ".dockerfile": "dockerfile",
  };
  return map[ext] || "plaintext";
}

function updateEditorLanguage(filePath) {
  if (!appState.editor) return;
  const model = appState.editor.getModel();
  if (!model) return;
  const lang = getLanguageFromPath(filePath);
  monaco.editor.setModelLanguage(model, lang);
  updateStatusBarLanguage(lang);
  return lang;
}

function markActiveTabUnsaved(isUnsaved) {
  if (appState.activeFileIndex === -1) return;
  const tab = document.querySelector(
    `.tab[data-index="${appState.activeFileIndex}"]`
  );
  if (!tab) return;
  const title = tab.querySelector("span:not(.close-tab)");
  if (!title) return;
  const marker = " ●";
  const current = title.innerText;
  if (isUnsaved && !current.endsWith(marker)) title.innerText += marker;
  else if (!isUnsaved && current.endsWith(marker))
    title.innerText = current.slice(0, -marker.length);
}

// =========================================================
// --- Status Bar / Util ---
function updateStatusBarPosition(event) {
  if (!statusBarLineCol || !event?.position) return;
  const pos = event.position;
  statusBarLineCol.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
}

function updateStatusBarLanguage(langId) {
  if (statusBarLanguage) statusBarLanguage.textContent = langId || "plaintext";
}

function updateStatusBar() {
  if (!appState.editor) return;
  const model = appState.editor.getModel();
  const pos = appState.editor.getPosition();
  if (pos) updateStatusBarPosition({ position: pos });
  if (model) updateStatusBarLanguage(model.getLanguageId());
  else updateStatusBarLanguage("plaintext");
}

function togglePanel() {
  panel.classList.toggle("collapsed");
  const icon = panelToggleButton.querySelector("i");
  icon.classList.toggle("codicon-chevron-up");
  icon.classList.toggle("codicon-chevron-down");
  setTimeout(() => {
    try {
      if (fitAddon) fitAddon.fit();
    } catch {}
    if (appState.editor) appState.editor.layout();
  }, 250);
}

function openModal(modal) {
  if (modal) modal.classList.remove("hidden");
}
function closeModal(modal) {
  if (modal) modal.classList.add("hidden");
}

function formatSeconds(s = 0) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h}h ${m}m ${sec}s`;
}

// =========================================================
// Função de troca de abas (Robusta)
// =========================================================
function switchPanelTabById(targetId) {
  // Encontra os elementos do DOM pelos seus IDs
  const terminalTabButton = document.querySelector(
    '[data-target="terminal-content"]'
  );
  const aiTabButton = document.querySelector('[data-target="ai-content"]');
  const terminalContentDiv = document.getElementById("terminal-content");
  const aiContentDiv = document.getElementById("ai-content");

  // Se algum elemento não for encontrado, loga um erro e para.
  if (
    !terminalTabButton ||
    !aiTabButton ||
    !terminalContentDiv ||
    !aiContentDiv
  ) {
    console.error(
      "ERRO CRÍTICO: Elementos do painel (abas ou conteúdo) não encontrados!"
    );
    return;
  }

  // Lógica de troca
  if (targetId === "terminal-content") {
    // Ativa o botão do terminal
    terminalTabButton.classList.add("active");
    aiTabButton.classList.remove("active");

    // Mostra o conteúdo do terminal
    terminalContentDiv.classList.add("active");
    aiContentDiv.classList.remove("active");

    // Tenta focar e ajustar o terminal
    try {
      if (fitAddon) fitAddon.fit();
      if (term) term.focus();
    } catch (e) {
      console.error("Falha ao focar/ajustar terminal:", e);
    }
  } else if (targetId === "ai-content") {
    // Ativa o botão da IA
    terminalTabButton.classList.remove("active");
    aiTabButton.classList.add("active");

    // Mostra o conteúdo da IA
    terminalContentDiv.classList.remove("active");
    aiContentDiv.classList.add("active");
  }
}

// compatibilidade com chamadas antigas
function switchPanelTab(tabBtn) {
  if (!tabBtn) return;
  switchPanelTabById(tabBtn.dataset.target);
}

function updateActivityBarSelection(button) {
  document
    .querySelectorAll(".activity-bar .action-item")
    .forEach((b) => b.classList.remove("active"));
  if (button) button.classList.add("active");
}

// =========================================================
// --- Autocomplete IA ---
function setupAICompletions() {
  if (!monaco?.languages) return;
  const langs = [
    "javascript",
    "python",
    "html",
    "css",
    "typescript",
    "java",
    "php",
    "rust",
  ];
  monaco.languages.registerCompletionItemProvider(langs, {
    triggerCharacters:
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ. ()=:[{}]'\"",
    async provideCompletionItems(m, p) {
      try {
        const code = m.getValueInRange({
          startLineNumber: Math.max(1, p.lineNumber - 50),
          startColumn: 1,
          endLineNumber: p.lineNumber,
          endColumn: p.column,
        });
        const lang = m.getLanguageId();
        const suggestion = await ipcRenderer.invoke("get-ai-completion", {
          code,
          language: lang,
        });
        if (!suggestion) return { suggestions: [] };
        return {
          suggestions: [
            {
              label: {
                label: suggestion.split("\n")[0].substring(0, 60),
                description: "IA",
              },
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: suggestion,
              range: new monaco.Range(
                p.lineNumber,
                p.column,
                p.lineNumber,
                p.column
              ),
            },
          ],
        };
      } catch {
        return { suggestions: [] };
      }
    },
  });
}

// =========================================================
/* Event Listeners */
function attachEventListeners() {
  activityFilesButton?.addEventListener("click", () => {
    sidebar?.classList.remove("hidden");
    updateActivityBarSelection(activityFilesButton);
  });

  activityAiButton?.addEventListener("click", () => {
    switchPanelTabById("ai-content");
    panel?.classList.remove("collapsed");
    updateActivityBarSelection(activityAiButton);
  });

  // !!! MUDANÇA 3: Listener do novo botão adicionado
  activityDashboardButton?.addEventListener("click", () => {
    ipcRenderer.send(
      "open-external-link",
      "https://lookerstudio.google.com/s/hYGufeBhKus"
    );
    updateActivityBarSelection(activityDashboardButton);
  });

  activitySettingsButton?.addEventListener("click", async () => {
    try {
      const s = await ipcRenderer.invoke("get-settings");
      themeSelect.value = s.theme || "vs-dark";
      fontSizeInput.value = s.fontSize || 14;
      openModal(settingsModal);
      updateActivityBarSelection(activitySettingsButton);
    } catch (e) {
      console.error("Err Settings:", e);
    }
  });

  openFolderButton?.addEventListener("click", async () => {
    aiOutput.innerText = "Abrindo...";
    try {
      const p = await ipcRenderer.invoke("open-folder");
      if (p) {
        appState.currentFolderPath = p;
        aiOutput.innerText = `Pasta: ${path.basename(p)}`;
        renderFileTree(p);
      } else {
        aiOutput.innerText = "Cancelado.";
      }
    } catch (e) {
      console.error("Err Open Folder:", e);
      aiOutput.innerText = "Erro.";
    }
  });

  newFileButton?.addEventListener("click", () => {
    if (!appState.editor) return;
    const name = `Sem Título-${appState.untitledCounter++}`;
    const model = monaco.editor.createModel("", "plaintext");
    appState.openFiles.push({
      filePath: null,
      model,
      temporaryName: name,
      viewState: null,
    });
    renderTabs();
    setActiveTab(appState.openFiles.length - 1);
  });

  fileTreePanel?.addEventListener("click", (e) => {
    if (e.target.tagName === "LI" && e.target.classList.contains("file-item")) {
      openFile(e.target.dataset.path);
    }
  });

  tabBar?.addEventListener("click", (e) => {
    const target = e.target;
    if (target.classList.contains("close-tab")) {
      closeTab(parseInt(target.dataset.index, 10));
    } else if (target.closest(".tab")) {
      setActiveTab(parseInt(target.closest(".tab").dataset.index, 10));
    }
  });

  // Adiciona o listener aos botões das abas do painel
  document.querySelectorAll(".panel-tab").forEach((t) =>
    t.addEventListener("click", () => {
      switchPanelTabById(t.dataset.target);
    })
  );

  panelToggleButton?.addEventListener("click", () => {
    togglePanel();
  });

  panelCloseButton?.addEventListener("click", () => {
    panel?.classList.add("collapsed");
    togglePanel();
  });

  saveFileButton?.addEventListener("click", async () => {
    if (appState.activeFileIndex === -1 || !appState.editor) return;
    const file = appState.openFiles[appState.activeFileIndex];
    const code = file.model.getValue();
    let res;
    try {
      if (file.filePath) {
        aiOutput.innerText = `Salvando ${path.basename(file.filePath)}...`;
        res = await ipcRenderer.invoke("save-file", {
          filePath: file.filePath,
          content: code,
        });
      } else {
        aiOutput.innerText = "Salvando como...";
        res = await ipcRenderer.invoke("save-file-as", code);
        if (res.success) {
          file.filePath = res.filePath;
          file.temporaryName = null;
          renderTabs();
          updateEditorLanguage(file.filePath);
          if (
            appState.currentFolderPath &&
            res.filePath.startsWith(appState.currentFolderPath)
          ) {
            renderFileTree(appState.currentFolderPath);
          }
        }
      }
      aiOutput.innerText = res.message;
      if (res.success) {
        ipcRenderer.send("track-activity", { type: "save" });
        markActiveTabUnsaved(false);
      }
    } catch (e) {
      console.error("Err Save:", e);
      aiOutput.innerText = "Erro.";
    }
  });

  explainButton?.addEventListener("click", async () => {
    if (!appState.editor || appState.activeFileIndex === -1) return;
    const m = appState.editor.getModel();
    const s = appState.editor.getSelection();
    if (!m || !s || s.isEmpty()) {
      aiOutput.innerText = "Selecione código.";
      return;
    }
    const code = m.getValueInRange(s);
    aiOutput.innerText = "Analisando...";
    ipcRenderer.send("track-activity", { type: "ai-help" });
    try {
      const exp = await ipcRenderer.invoke("ask-gemini-explain", code);
      aiOutput.innerText = exp;
    } catch (e) {
      console.error("Err Explain:", e);
      aiOutput.innerText = "Erro IA.";
    }
  });

  refactorButton?.addEventListener("click", async () => {
    if (!appState.editor || appState.activeFileIndex === -1) return;
    const m = appState.editor.getModel();
    const s = appState.editor.getSelection();
    if (!m || !s || s.isEmpty()) {
      aiOutput.innerText = "Selecione código.";
      return;
    }
    const code = m.getValueInRange(s);
    const lang = m.getLanguageId();
    aiOutput.innerText = "Refatorando...";
    ipcRenderer.send("track-activity", { type: "ai-refactor" });
    try {
      const res = await ipcRenderer.invoke("ask-gemini-refactor", {
        code,
        language: lang,
      });
      if (res.success && res.refactoredCode) {
        appState.editor.executeEdits("ai", [
          { range: s, text: res.refactoredCode, forceMoveMarkers: true },
        ]);
        aiOutput.innerText = "Refatorado!";
      } else {
        aiOutput.innerText = res.message || "Falha.";
      }
    } catch (e) {
      console.error("Err Refactor:", e);
      aiOutput.innerText = "Erro IA.";
    }
  });

  executeCodeButton?.addEventListener("click", () => {
    if (
      appState.activeFileIndex === -1 ||
      !appState.openFiles[appState.activeFileIndex]
    ) {
      aiOutput.innerText = "Nenhum arquivo.";
      return;
    }
    const file = appState.openFiles[appState.activeFileIndex];
    if (!file.filePath) {
      aiOutput.innerText = "Salve antes.";
      return;
    }
    // limpa o terminal e executa
    try {
      term.write("\x1bc");
    } catch {}
    ipcRenderer.invoke("run-code", file.filePath);
    aiOutput.innerText = `Executando ${path.basename(file.filePath)}...`;
    ipcRenderer.send("track-activity", { type: "execute" });
    // garante que o terminal esteja visível
    switchPanelTabById("terminal-content");
    panel?.classList.remove("collapsed");
  });

  findButton?.addEventListener("click", () => {
    appState.editor?.getAction("actions.find").run();
  });

  replaceButton?.addEventListener("click", () => {
    appState.editor?.getAction("editor.action.startFindReplaceAction").run();
  });

  statsButton?.addEventListener("click", async () => {
    try {
      const s = await ipcRenderer.invoke("get-stats");
      const today = new Date().toISOString().slice(0, 10);
      const todayS = s.dailyStats[today] || {};
      document.getElementById("stats-active-time").textContent = formatSeconds(
        todayS.activeCodingTimeSeconds
      );
      document.getElementById("stats-current-streak").textContent =
        s.codingStreak.current || 0;
      const fsEl = document.getElementById("stats-files-saved");
      if (fsEl) fsEl.textContent = todayS.filesSaved || 0;
      const ceEl = document.getElementById("stats-code-executions");
      if (ceEl) ceEl.textContent = todayS.codeExecutions || 0;
      const ahEl = document.getElementById("stats-ai-helps");
      if (ahEl) ahEl.textContent = todayS.aiHelps || 0;
      const arEl = document.getElementById("stats-ai-refactors");
      if (arEl) arEl.textContent = todayS.aiRefactors || 0;
      openModal(statsModal);
    } catch (e) {
      console.error("Err Stats:", e);
    }
  });

  closeSettingsModal?.addEventListener("click", () =>
    closeModal(settingsModal)
  );

  saveSettingsButton?.addEventListener("click", async () => {
    try {
      const nS = {
        theme: themeSelect.value,
        fontSize: parseInt(fontSizeInput.value, 10),
      };
      await ipcRenderer.invoke("save-settings", nS);
      if (appState.editor) {
        monaco.editor.setTheme(nS.theme);
        appState.editor.updateOptions({ fontSize: nS.fontSize });
      }
      closeModal(settingsModal);
      aiOutput.innerText = "Config. salvas.";
    } catch (e) {
      console.error("Err Save Settings:", e);
    }
  });

  closeStatsModal?.addEventListener("click", () => closeModal(statsModal));

  // tracking de tempo ativo
  setInterval(() => {
    if (
      appState.editor &&
      appState.activeFileIndex !== -1 &&
      Date.Now() - appState.lastActivityTimestamp < 10000
    ) {
      const m = appState.editor.getModel();
      const l = m ? m.getLanguageId() : "plaintext";
      ipcRenderer.send("track-activity", {
        type: "activeTime",
        seconds: 5,
        language: l,
      });
    }
  }, 5000);
}
