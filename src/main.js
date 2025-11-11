// ======================================================
//  MAIN PROCESS - Adicionado shell.openExternal
// ======================================================

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron"); // !!! MUDANÇA 1: 'shell' adicionado
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const axios = require("axios");
require("dotenv").config();

let mainWindow;
let ptyProcess;
const userDataPath = app.getPath("userData");
const statsFilePath = path.join(userDataPath, "developer-stats.json");
const settingsFilePath = path.join(userDataPath, "settings.json");

function readJsonFile(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (error) {
    console.error(`Erro ao ler o arquivo ${filePath}:`, error);
  }
  return defaultValue;
}
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Erro ao escrever no arquivo ${filePath}:`, error);
  }
}

const initialStats = {
  dailyStats: {},
  userGoals: { dailyCodingTimeGoalSeconds: 3600 },
  codingStreak: { current: 0, longest: 0, lastDayCompleted: null },
};
const initialSettings = { theme: "vs-dark", fontSize: 14 };
if (!fs.existsSync(statsFilePath)) writeJsonFile(statsFilePath, initialStats);
if (!fs.existsSync(settingsFilePath))
  writeJsonFile(settingsFilePath, initialSettings);

// ======================================================
//  🔹 Janela + Terminal interativo
// ======================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  mainWindow.loadFile(path.resolve(__dirname, "renderer/index.html"));

  // ---- Terminal interativo (PowerShell/Bash) ----
  const isWin = os.platform() === "win32";
  const shell = isWin ? "powershell.exe" : "bash";

  ptyProcess = spawn(shell, isWin ? ["-NoLogo", "-NoProfile"] : ["-l"], {
    cwd: os.homedir(),
    env: {
      ...process.env,
      // força UTF-8 para processos filhos em geral
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
    },
    windowsHide: true,
    encoding: "utf8", // Define a codificação na origem
  });

  // Removido .toString('utf8') pois já é uma string
  ptyProcess.stdout.on("data", (data) =>
    mainWindow?.webContents.send("terminal-data", data)
  );
  ptyProcess.stderr.on("data", (data) =>
    mainWindow?.webContents.send("terminal-data", data)
  );

  ipcMain.on("terminal-command", (_event, command) => {
    try {
      const text = typeof command === "string" ? command : "";
      ptyProcess.stdin.write(text.endsWith("\n") ? text : text + "\n");
    } catch (e) {
      mainWindow?.webContents.send(
        "terminal-data",
        `[ERRO] Falha ao enviar comando ao shell: ${e.message}\n`
      );
    }
  });

  mainWindow.on("closed", () => (mainWindow = null));
}

// !!! MUDANÇA 2: NOVO OUVINTE ADICIONADO !!!
// Ouve o aviso do renderer para abrir um link
ipcMain.on("open-external-link", (_event, url) => {
  try {
    shell.openExternal(url);
  } catch (e) {
    console.error("Falha ao abrir link externo:", e);
  }
});

// ======================================================
//  🔹 Gemini (Axios direto)
// ======================================================
async function callGeminiDirect(promptText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY ausente no .env");
    return { success: false, message: "Erro: Chave de API não configurada." };
  }
  const url =
    "https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=" +
    apiKey;

  try {
    const response = await axios.post(
      url,
      { contents: [{ parts: [{ text: promptText }] }] },
      { headers: { "Content-Type": "application/json" } }
    );
    const txt = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return txt
      ? { success: true, text: txt }
      : {
          success: false,
          message:
            response?.data?.error?.message || "Resposta inesperada da API.",
        };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const apiMsg =
        error.response.data?.error?.message || "Erro desconhecido.";
      let userMsg = `Erro ${status}: ${apiMsg}`;
      if (status === 400 && /API key not valid/i.test(apiMsg))
        userMsg = "Erro 400: Chave inválida.";
      if (status === 429) userMsg = "Erro 429: Limite atingido.";
      if (status === 404) userMsg = "Erro 404: Modelo/URL incorreta.";
      return { success: false, message: userMsg };
    }
    return { success: false, message: `Erro conexão: ${error.message}` };
  }
}

ipcMain.handle("ask-gemini-explain", async (_e, code) => {
  const result = await callGeminiDirect(`Explique:\n\n${code}`);
  return result.success ? result.text : `Erro: ${result.message}`;
});

ipcMain.handle("ask-gemini-refactor", async (_e, { code, language }) => {
  const result = await callGeminiDirect(
    `Você é ${language}. Refatore retornando APENAS o código:\n\n${code}`
  );
  if (!result.success)
    return { success: false, message: `Erro: ${result.message}` };
  const refactored = result.text
    .trim()
    .replace(/^```[\w]*\n/, "")
    .replace(/\n```$/, "");
  return { success: true, refactoredCode: refactored };
});

ipcMain.handle("get-ai-completion", async (_e, { code, language }) => {
  const maxLen = 1500;
  const trunc = code.length > maxLen ? `...${code.slice(-maxLen)}` : code;
  const result = await callGeminiDirect(
    `Você é ${language}. Complete retornando APENAS o código:\n\n${trunc}`
  );
  if (!result.success || !result.text) return null;
  return result.text
    .trim()
    .replace(/^```[\w]*\n/, "")
    .replace(/\n```$/, "");
});

// ======================================================
//  ✅ EXECUTAR CÓDIGO (UTF-8 garantido)
// ======================================================
ipcMain.handle("run-code", async (_event, filePath) => {
  if (!filePath) return;
  const ext = path.extname(filePath).toLowerCase();
  const directory = path.dirname(filePath);
  const fileName = path.basename(filePath);

  let command,
    args = [],
    opts = {};
  const isWin = os.platform() === "win32";

  switch (ext) {
    case ".py":
      command = isWin ? "python" : "python3";
      // força UTF-8 no Python
      args = ["-X", "utf8", fileName];
      opts = {
        cwd: directory,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          PYTHONUNBUFFERED: "1", // Correção para o "olá mundo" aparecer
        },
        windowsHide: true,
        shell: false, // evita cmd.exe mangling
      };
      break;

    case ".js":
      command = "node";
      args = [fileName];
      opts = { cwd: directory, windowsHide: true, shell: false };
      break;

    case ".html":
      if (isWin) {
        // abre no navegador padrão
        command = "cmd";
        args = ["/c", "start", '""', fileName];
        opts = { cwd: directory, windowsHide: true, shell: false };
      } else {
        command = "open";
        args = [fileName];
        opts = { cwd: directory, shell: false };
      }
      break;

    default:
      mainWindow?.webContents.send(
        "terminal-data",
        `\r\n[ERRO] Execução de '${ext}' não suportada.\r\n`
      );
      return;
  }

  mainWindow?.webContents.send(
    "terminal-data",
    `[Run Code] Executando: ${command} ${args.join(" ")} (cwd=${directory})\r\n`
  );

  try {
    const child = spawn(command, args, opts);

    // Garanta UTF-8 no pipeline
    child.stdout.on("data", (d) =>
      mainWindow?.webContents.send("terminal-data", d.toString("utf8"))
    );
    child.stderr.on("data", (d) =>
      mainWindow?.webContents.send("terminal-data", d.toString("utf8"))
    );

    child.on("close", (code) =>
      mainWindow?.webContents.send(
        "terminal-data",
        `\r\n[Finalizado cód ${code}]\r\n`
      )
    );
    child.on("error", (err) =>
      mainWindow?.webContents.send(
        "terminal-data",
        `\r\n[ERRO] Falha ao executar '${command}': ${err.message}\r\n`
      )
    );
  } catch (e) {
    mainWindow?.webContents.send(
      "terminal-data",
      `\r\n[ERRO GRAVE] spawn: ${e.message}\r\n`
    );
  }
});

// ======================================================
//  🔹 Arquivos / Pastas / Stats / Settings (sem mudanças funcionais)
// ======================================================
ipcMain.handle("save-file-as", async (_e, content) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Salvar Como...",
    buttonLabel: "Salvar",
  });
  if (canceled || !filePath) return { success: false, message: "Cancelado." };
  try {
    fs.writeFileSync(filePath, content);
    return { success: true, message: "Salvo!", filePath };
  } catch (e) {
    return { success: false, message: `Erro: ${e.message}` };
  }
});
ipcMain.handle("save-file", async (_e, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content);
    return { success: true, message: "Salvo!" };
  } catch (e) {
    return { success: false, message: `Erro: ${e.message}` };
  }
});
ipcMain.handle("read-file", async (_e, filePath) => {
  try {
    return { success: true, content: fs.readFileSync(filePath, "utf-8") };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle("open-folder", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
});
ipcMain.handle("read-folder-recursive", async (_e, dirPath) => {
  function readDir(current) {
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      return entries
        .map((e) => {
          const full = path.join(current, e.name);
          if (e.isDirectory()) {
            if (e.name === "node_modules" || e.name.startsWith("."))
              return null;
            return {
              name: e.name,
              type: "folder",
              path: full,
              children: readDir(full),
            };
          } else {
            return { name: e.name, type: "file", path: full };
          }
        })
        .filter(Boolean);
    } catch (e) {
      console.error(`Erro dir ${current}:`, e);
      return [];
    }
  }
  return readDir(dirPath);
});
ipcMain.handle("get-stats", () => readJsonFile(statsFilePath, initialStats));
ipcMain.handle("get-settings", () =>
  readJsonFile(settingsFilePath, initialSettings)
);
ipcMain.handle("save-settings", (_e, settings) => {
  writeJsonFile(settingsFilePath, settings);
  return { success: true };
});
ipcMain.on("track-activity", (_e, data) => {
  const stats = readJsonFile(statsFilePath, initialStats);
  const today = new Date().toISOString().slice(0, 10);
  if (!stats.dailyStats[today]) {
    stats.dailyStats[today] = {
      activeCodingTimeSeconds: 0,
      filesSaved: 0,
      codeExecutions: 0,
      aiHelps: 0,
      aiRefactors: 0,
      timeByLanguage: {},
    };
  }
  const todayS = stats.dailyStats[today];
  switch (data.type) {
    case "activeTime":
      todayS.activeCodingTimeSeconds += data.seconds;
      const lang = data.language || "plaintext";
      todayS.timeByLanguage[lang] =
        (todayS.timeByLanguage[lang] || 0) + data.seconds;
      break;
    case "save":
      todayS.filesSaved += 1;
      break;
    case "execute":
      todayS.codeExecutions += 1;
      break;
    case "ai-help":
      todayS.aiHelps += 1;
      break;
    case "ai-refactor":
      todayS.aiRefactors += 1;
      break;
  }
  const goal = stats.userGoals.dailyCodingTimeGoalSeconds;
  if (goal > 0 && todayS.activeCodingTimeSeconds >= goal) {
    if (stats.codingStreak.lastDayCompleted !== today) {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().slice(0, 10);
      stats.codingStreak.current =
        stats.codingStreak.lastDayCompleted === yStr
          ? stats.codingStreak.current + 1
          : 1;
      stats.codingStreak.longest = Math.max(
        stats.codingStreak.longest,
        stats.codingStreak.current
      );
      stats.codingStreak.lastDayCompleted = today;
    }
  }
  writeJsonFile(statsFilePath, stats);
});

// ======================================================
//  🔹 App lifecycle
// ======================================================
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
