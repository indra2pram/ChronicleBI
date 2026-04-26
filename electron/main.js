const fs = require("node:fs/promises");
const path = require("node:path");
const { createServer } = require("node:http");
const crypto = require("node:crypto");

const next = require("next");
const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");

const {
  createProject,
  deleteCatalog,
  recordCatalogMetadataDownload,
  saveCatalog,
  deleteConnection,
  deleteProject,
  openProject,
  readProjectState,
  saveConnection,
  updateProject
} = require("./project-store");
const { downloadBipObject, validateCatalogPath } = require("./bip-catalog-service");

const hostname = "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const isDev = process.env.APP_ENV === "development";
const appIconPath = path.join(app.getAppPath(), "public", "assets", "icons", "chronicle_bi_symbol.ico");

let mainWindow = null;
let rendererServer = null;
let queuedMenuCommand = null;

app.setName("Chronicle BI");

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

function getCatalogMetadataTempRoot() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "temp", "catalog-metadata");
  }

  return path.join(app.getAppPath(), "temp", "catalog-metadata");
}

function sanitizePathSegment(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .slice(0, 80);

  return normalized || "catalog";
}

function resolveCatalogMetadataCachePath(projectCode, catalogPath, fileName) {
  const fileBaseName = String(fileName ?? "").trim() || "catalog-metadata.json";
  const normalizedFileName = fileBaseName.toLowerCase().endsWith(".json")
    ? fileBaseName
    : `${fileBaseName}.json`;
  const projectSegment = sanitizePathSegment(projectCode);
  const catalogName = sanitizePathSegment(path.posix.basename(String(catalogPath ?? "").replace(/\\/g, "/")));
  const catalogHash = crypto
    .createHash("sha1")
    .update(`${String(projectCode ?? "").trim()}::${String(catalogPath ?? "").trim()}`)
    .digest("hex")
    .slice(0, 12);

  return path.join(
    getCatalogMetadataTempRoot(),
    projectSegment,
    `${catalogName}-${catalogHash}`,
    sanitizePathSegment(normalizedFileName)
  );
}

async function persistCatalogMetadataTempFile(projectCode, catalogPath, fileName, metadata) {
  const filePath = resolveCatalogMetadataCachePath(projectCode, catalogPath, fileName);
  const content = JSON.stringify(metadata, null, 2);

  await fs.mkdir(path.dirname(filePath), {
    recursive: true
  });
  await fs.writeFile(filePath, content, "utf8");

  return {
    filePath,
    content
  };
}

async function getCachedCatalogMetadata(projectCode, catalogPath) {
  const normalizedProjectCode = String(projectCode ?? "").trim();
  const normalizedCatalogPath = String(catalogPath ?? "").trim();

  if (!normalizedProjectCode) {
    throw new Error("Choose a project before opening cached metadata.");
  }

  if (!normalizedCatalogPath) {
    throw new Error("Choose a catalog before opening cached metadata.");
  }

  const projectState = await readProjectState();
  const project = projectState.projects.find((item) => item.code === normalizedProjectCode);

  if (!project) {
    throw new Error("The selected project was not found.");
  }

  const catalog = project.catalogs.find((item) => item.path === normalizedCatalogPath);

  if (!catalog) {
    throw new Error("The selected catalog was not found.");
  }

  if (!catalog.latestMetadataTempPath) {
    throw new Error("No cached metadata JSON is available for this catalog yet.");
  }

  const resolvedRoot = path.resolve(getCatalogMetadataTempRoot());
  const resolvedFilePath = path.resolve(catalog.latestMetadataTempPath);

  if (!resolvedFilePath.startsWith(`${resolvedRoot}${path.sep}`) && resolvedFilePath !== resolvedRoot) {
    throw new Error("Cached metadata JSON points outside the allowed temp directory.");
  }

  const content = await fs.readFile(resolvedFilePath, "utf8");

  return {
    fileName: catalog.latestMetadataFileName ?? path.basename(resolvedFilePath),
    filePath: resolvedFilePath,
    projectCode: project.code,
    catalogPath: catalog.path,
    connectionName: catalog.latestMetadataConnectionName,
    downloadedAt: catalog.latestMetadataDownloadedAt,
    content
  };
}

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
  Menu.setApplicationMenu(null);
}

async function saveMetadataJson(defaultFileName, metadata) {
  const fileName = String(defaultFileName ?? "").trim() || "catalog-metadata.json";
  const saveDialogResult = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: "Save catalog metadata JSON",
    defaultPath: fileName,
    filters: [
      {
        name: "JSON files",
        extensions: ["json"]
      }
    ]
  });

  if (saveDialogResult.canceled || !saveDialogResult.filePath) {
    return {
      canceled: true,
      filePath: null
    };
  }

  const targetPath = path.extname(saveDialogResult.filePath).toLowerCase() === ".json"
    ? saveDialogResult.filePath
    : `${saveDialogResult.filePath}.json`;

  await fs.writeFile(targetPath, JSON.stringify(metadata, null, 2), "utf8");

  return {
    canceled: false,
    filePath: targetPath
  };
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
  ipcMain.handle("project:update", (_event, projectCode, projectInput) =>
    updateProject(projectCode, projectInput)
  );
  ipcMain.handle("project:delete", (_event, projectCode) => deleteProject(projectCode));
  ipcMain.handle("catalog:save", (_event, projectCode, catalogInput, existingCatalogPath) =>
    saveCatalog(projectCode, catalogInput, existingCatalogPath)
  );
  ipcMain.handle("catalog:validate", (_event, projectCode, connectionName, catalogPath) =>
    validateCatalogPath(projectCode, connectionName, catalogPath)
  );
  ipcMain.handle("catalog:get-cached-metadata", (_event, projectCode, catalogPath) =>
    getCachedCatalogMetadata(projectCode, catalogPath)
  );
  ipcMain.handle("catalog:delete", (_event, projectCode, catalogPath) =>
    deleteCatalog(projectCode, catalogPath)
  );
  ipcMain.handle("connection:save", (_event, projectCode, connectionInput, existingConnectionName) =>
    saveConnection(projectCode, connectionInput, existingConnectionName)
  );
  ipcMain.handle("connection:delete", (_event, projectCode, connectionName) =>
    deleteConnection(projectCode, connectionName)
  );
  ipcMain.handle("bip:download-object", async (_event, projectCode, connectionName, catalogPath) => {
    const requestedAt = new Date().toISOString();

    try {
      const result = await downloadBipObject(projectCode, connectionName, catalogPath);
      const tempMetadata = await persistCatalogMetadataTempFile(
        projectCode,
        result.catalogPath,
        result.metadataFileName,
        result.metadata
      );

      await recordCatalogMetadataDownload(
        projectCode,
        result.catalogPath,
        {
          requestedAt,
          completedAt: result.metadata.generatedAt,
          status: "success",
          connectionName,
          fileName: result.metadataFileName,
          detail: "Metadata JSON cached in the temp folder."
        },
        {
          fileName: result.metadataFileName,
          tempFilePath: tempMetadata.filePath,
          connectionName,
          downloadedAt: result.metadata.generatedAt
        }
      );

      return {
        ...result,
        tempMetadataPath: tempMetadata.filePath
      };
    } catch (error) {
      try {
        await recordCatalogMetadataDownload(projectCode, catalogPath, {
          requestedAt,
          completedAt: new Date().toISOString(),
          status: "failed",
          connectionName,
          fileName: null,
          detail: getErrorMessage(error)
        });
      } catch (historyError) {
        console.error("Failed to record catalog metadata history.", historyError);
      }

      throw error;
    }
  });
  ipcMain.handle("metadata:save-json", (_event, defaultFileName, metadata) =>
    saveMetadataJson(defaultFileName, metadata)
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
    icon: appIconPath,
    title: "Chronicle BI",
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
