const path = require("node:path");
const { createServer } = require("node:http");

const next = require("next");
const { app, BrowserWindow, ipcMain, Menu } = require("electron");

const {
  createProject,
  deleteConnection,
  deleteProject,
  openProject,
  readProjectState,
  saveConnection,
  testConnection
} = require("./project-store");
const { downloadBipObject } = require("./bip-catalog-service");

const hostname = "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const isDev = process.env.APP_ENV === "development";

let mainWindow = null;
let rendererServer = null;
let queuedMenuCommand = null;

function sendMenuCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    queuedMenuCommand = command;
    return;
  }

  if (mainWindow.webContents.isLoadingMainFrame()) {
    queuedMenuCommand = command;
    return;
  }

  mainWindow.webContents.send("menu:command", command);
}

function buildApplicationMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" }
            ]
          }
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Add Project",
          accelerator: "CmdOrCtrl+N",
          click: () => sendMenuCommand("add-project")
        },
        {
          label: "Open Project",
          accelerator: "CmdOrCtrl+O",
          click: () => sendMenuCommand("open-project")
        },
        {
          label: "Manage Projects",
          accelerator: "CmdOrCtrl+Shift+M",
          click: () => sendMenuCommand("manage-projects")
        },
        ...(!isMac
          ? [
              { type: "separator" },
              { role: "quit" }
            ]
          : [])
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers() {
  ipcMain.handle("app:info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }));

  ipcMain.handle("app:ping", () => {
    const formattedTime = new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date());

    return `Main process says hello at ${formattedTime}.`;
  });

  ipcMain.handle("project:get-state", () => readProjectState());
  ipcMain.handle("project:create", (_event, projectInput) => createProject(projectInput));
  ipcMain.handle("project:open", (_event, projectCode) => openProject(projectCode));
  ipcMain.handle("project:delete", (_event, projectCode) => deleteProject(projectCode));
  ipcMain.handle("connection:save", (_event, projectCode, connectionInput, existingConnectionName) =>
    saveConnection(projectCode, connectionInput, existingConnectionName)
  );
  ipcMain.handle("connection:delete", (_event, projectCode, connectionName) =>
    deleteConnection(projectCode, connectionName)
  );
  ipcMain.handle("connection:test", (_event, projectCode, connectionInput, existingConnectionName) =>
    testConnection(projectCode, connectionInput, existingConnectionName)
  );
  ipcMain.handle("bip:download-object", (_event, projectCode, connectionName, reportPath) =>
    downloadBipObject(projectCode, connectionName, reportPath)
  );
}

async function startRendererServer() {
  if (rendererServer) {
    return;
  }

  const nextApp = next({
    dev: isDev,
    dir: app.getAppPath(),
    hostname,
    port
  });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  rendererServer = createServer((req, res) => {
    handle(req, res);
  });

  await new Promise((resolve, reject) => {
    rendererServer.once("error", reject);
    rendererServer.listen(port, hostname, () => resolve());
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    backgroundColor: "#08111f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (!queuedMenuCommand) {
      return;
    }

    mainWindow?.webContents.send("menu:command", queuedMenuCommand);
    queuedMenuCommand = null;
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

async function loadRenderer(window) {
  await window.loadURL(`http://${hostname}:${port}`);
}

async function bootstrap() {
  await startRendererServer();
  buildApplicationMenu();
  const window = createMainWindow();
  await loadRenderer(window);
}

function stopRendererServer() {
  if (!rendererServer) {
    return;
  }

  rendererServer.close();
  rendererServer = null;
}

registerIpcHandlers();

app.whenReady().then(bootstrap).catch((error) => {
  console.error("Failed to bootstrap the Electron app.", error);
  app.quit();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const window = createMainWindow();
    await loadRenderer(window);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopRendererServer();
});
