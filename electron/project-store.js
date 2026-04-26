const fs = require("node:fs/promises");
const path = require("node:path");

const { app } = require("electron");

const defaultProjectState = {
  activeProjectCode: null,
  projects: []
};

const connectionUrlPattern = "https://*.fa.ocs.oraclecloud.com";
const environmentTypeValues = new Set(["Dev", "Test", "Prod"]);
const MAX_METADATA_HISTORY = 10;

function getStoragePath() {
  return path.join(app.getPath("userData"), "projects.json");
}

function getCatalogMetadataTempRoot() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "temp", "catalog-metadata");
  }

  return path.join(app.getAppPath(), "temp", "catalog-metadata");
}

function isPathInsideDirectory(filePath, directoryPath) {
  const resolvedFilePath = path.resolve(String(filePath ?? ""));
  const resolvedDirectoryPath = path.resolve(String(directoryPath ?? ""));

  return (
    resolvedFilePath === resolvedDirectoryPath ||
    resolvedFilePath.startsWith(`${resolvedDirectoryPath}${path.sep}`)
  );
}

function normalizeProjectDraft(input) {
  return {
    code: String(input?.code ?? "").trim(),
    name: String(input?.name ?? "").trim(),
    description: String(input?.description ?? "").trim()
  };
}

function normalizeEnvironmentType(input) {
  const value = String(input ?? "").trim().toLowerCase();

  if (value === "test") {
    return "Test";
  }

  if (value === "prod" || value === "production") {
    return "Prod";
  }

  return "Dev";
}

function normalizeOptionalEnvironmentType(input) {
  const value = String(input ?? "").trim();

  if (!value) {
    return null;
  }

  return normalizeEnvironmentType(value);
}

function normalizeConnectionUrl(input) {
  const value = String(input ?? "").trim();

  if (!value) {
    return "";
  }

  try {
    const parsedUrl = new URL(value);

    if ((parsedUrl.pathname === "" || parsedUrl.pathname === "/") && !parsedUrl.search && !parsedUrl.hash) {
      return `${parsedUrl.protocol}//${parsedUrl.host}`;
    }
  } catch (_error) {
    return value;
  }

  return value;
}

function normalizeConnectionDraft(input) {
  return {
    name: String(input?.name ?? "").trim(),
    url: normalizeConnectionUrl(input?.url),
    username: String(input?.username ?? "").trim(),
    password: String(input?.password ?? ""),
    environmentType: normalizeEnvironmentType(input?.environmentType)
  };
}

function normalizeCatalogDraft(input) {
  return {
    path: String(input?.path ?? "").trim()
  };
}

function normalizeOptionalString(input) {
  const value = String(input ?? "").trim();
  return value ? value : null;
}

function normalizeMetadataHistoryStatus(input) {
  return String(input ?? "").trim().toLowerCase() === "failed" ? "failed" : "success";
}

function normalizeCatalogMetadataHistoryEntry(input) {
  const status = normalizeMetadataHistoryStatus(input?.status);
  const completedAt = String(input?.completedAt ?? new Date().toISOString());
  const requestedAt = String(input?.requestedAt ?? completedAt);

  return {
    id: String(
      input?.id ??
        `${completedAt}:${status}:${String(input?.connectionName ?? "").trim() || "catalog-metadata"}`
    ),
    requestedAt,
    completedAt,
    status,
    connectionName: String(input?.connectionName ?? "").trim(),
    environmentType: normalizeOptionalEnvironmentType(input?.environmentType),
    fileName: normalizeOptionalString(input?.fileName),
    tempFilePath: normalizeOptionalString(input?.tempFilePath),
    detail:
      String(input?.detail ?? "").trim() ||
      (status === "success" ? "Metadata JSON cached." : "Metadata download failed.")
  };
}

function normalizeStoredConnection(input) {
  const connection = normalizeConnectionDraft(input);

  return {
    ...connection,
    createdAt: String(input?.createdAt ?? new Date().toISOString()),
    updatedAt: String(input?.updatedAt ?? new Date().toISOString())
  };
}

function normalizeStoredCatalog(input) {
  const catalog = normalizeCatalogDraft(input);

  return {
    ...catalog,
    createdAt: String(input?.createdAt ?? new Date().toISOString()),
    updatedAt: String(input?.updatedAt ?? new Date().toISOString()),
    latestMetadataFileName: normalizeOptionalString(input?.latestMetadataFileName),
    latestMetadataTempPath: normalizeOptionalString(input?.latestMetadataTempPath),
    latestMetadataConnectionName: normalizeOptionalString(input?.latestMetadataConnectionName),
    latestMetadataDownloadedAt: normalizeOptionalString(input?.latestMetadataDownloadedAt),
    metadataHistory: sanitizeCatalogMetadataHistory(input?.metadataHistory)
  };
}

function sanitizeCatalogMetadataHistory(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map(normalizeCatalogMetadataHistoryEntry)
    .filter((entry) => entry.connectionName || entry.fileName || entry.detail)
    .slice(0, MAX_METADATA_HISTORY);
}

function sanitizeConnections(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenNames = new Set();

  return input.map(normalizeStoredConnection).filter((connection) => {
    if (!connection.name || !connection.url || !connection.username || !connection.password) {
      return false;
    }

    const normalizedName = connection.name.toLowerCase();

    if (seenNames.has(normalizedName)) {
      return false;
    }

    seenNames.add(normalizedName);
    return true;
  });
}

function sanitizeCatalogs(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenPaths = new Set();

  return input.map(normalizeStoredCatalog).filter((catalog) => {
    if (!catalog.path) {
      return false;
    }

    const normalizedPath = catalog.path.toLowerCase();

    if (seenPaths.has(normalizedPath)) {
      return false;
    }

    seenPaths.add(normalizedPath);
    return true;
  });
}

function normalizeStoredProject(input) {
  const project = normalizeProjectDraft(input);

  return {
    ...project,
    createdAt: String(input?.createdAt ?? new Date().toISOString()),
    updatedAt: String(input?.updatedAt ?? new Date().toISOString()),
    connections: sanitizeConnections(input?.connections),
    catalogs: sanitizeCatalogs(input?.catalogs ?? input?.reports)
  };
}

function sanitizeProjectState(input) {
  if (!input || typeof input !== "object") {
    return { ...defaultProjectState };
  }

  const seenCodes = new Set();
  const projects = Array.isArray(input.projects)
    ? input.projects
        .map(normalizeStoredProject)
        .filter((project) => {
          if (!project.code || !project.name || !project.description) {
            return false;
          }

          const normalizedCode = project.code.toLowerCase();

          if (seenCodes.has(normalizedCode)) {
            return false;
          }

          seenCodes.add(normalizedCode);
          return true;
        })
    : [];

  const activeProjectCode =
    typeof input.activeProjectCode === "string" &&
    projects.some((project) => project.code === input.activeProjectCode)
      ? input.activeProjectCode
      : null;

  return {
    activeProjectCode,
    projects
  };
}

async function readProjectState() {
  try {
    const raw = await fs.readFile(getStoragePath(), "utf8");
    return sanitizeProjectState(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { ...defaultProjectState };
    }

    throw error;
  }
}

async function writeProjectState(projectState) {
  const nextState = sanitizeProjectState(projectState);

  await fs.writeFile(getStoragePath(), JSON.stringify(nextState, null, 2), "utf8");

  return nextState;
}

function validateProjectDraft(projectDraft) {
  if (!projectDraft.code) {
    throw new Error("Project code is required.");
  }

  if (!projectDraft.name) {
    throw new Error("Project name is required.");
  }

  if (!projectDraft.description) {
    throw new Error("Project description is required.");
  }
}

function isValidConnectionUrl(value) {
  let parsedUrl = null;

  try {
    parsedUrl = new URL(value);
  } catch (_error) {
    return false;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const requiredSuffix = ".fa.ocs.oraclecloud.com";
  const hasRequiredHost = hostname.endsWith(requiredSuffix) && hostname.length > requiredSuffix.length;
  const hasOnlyRootPath = !parsedUrl.pathname || parsedUrl.pathname === "/";

  return (
    parsedUrl.protocol === "https:" &&
    hasRequiredHost &&
    hasOnlyRootPath &&
    !parsedUrl.search &&
    !parsedUrl.hash
  );
}

function validateConnectionDraft(connectionDraft) {
  if (!connectionDraft.name) {
    throw new Error("Connection name is required.");
  }

  if (!connectionDraft.url) {
    throw new Error("Connection URL is required.");
  }

  if (!connectionDraft.username) {
    throw new Error("Connection username is required.");
  }

  if (!connectionDraft.password) {
    throw new Error("Connection password is required.");
  }

  if (!environmentTypeValues.has(connectionDraft.environmentType)) {
    throw new Error("Environment type must be one of Dev, Test, or Prod.");
  }

  if (!isValidConnectionUrl(connectionDraft.url)) {
    throw new Error(`URL must match the pattern ${connectionUrlPattern}.`);
  }
}

function validateCatalogDraft(catalogDraft) {
  if (!catalogDraft.path) {
    throw new Error("BIP catalog path is required.");
  }

  if (!catalogDraft.path.startsWith("/")) {
    throw new Error("BIP catalog path must start with /.");
  }
}

function getProjectIndex(projectState, projectCode) {
  return projectState.projects.findIndex((project) => project.code === projectCode);
}

function getConnectionIndex(connections, connectionName) {
  const normalizedName = String(connectionName ?? "").trim().toLowerCase();

  if (!normalizedName) {
    return -1;
  }

  return connections.findIndex((connection) => connection.name.toLowerCase() === normalizedName);
}

function getCatalogIndex(catalogs, catalogPath) {
  const normalizedPath = String(catalogPath ?? "").trim().toLowerCase();

  if (!normalizedPath) {
    return -1;
  }

  return catalogs.findIndex((catalog) => catalog.path.toLowerCase() === normalizedPath);
}

function ensureProjectExists(projectState, projectCode, missingMessage) {
  const code = String(projectCode ?? "").trim();
  const projectIndex = getProjectIndex(projectState, code);

  if (projectIndex < 0) {
    throw new Error(missingMessage);
  }

  return {
    code,
    projectIndex,
    project: projectState.projects[projectIndex]
  };
}

function resolveConnectionIndex(connections, existingConnectionName) {
  const name = String(existingConnectionName ?? "").trim();

  if (!name) {
    return -1;
  }

  const connectionIndex = getConnectionIndex(connections, name);

  if (connectionIndex < 0) {
    throw new Error("The selected connection was not found.");
  }

  return connectionIndex;
}

function ensureUniqueConnectionName(connections, connectionName, currentIndex) {
  const normalizedName = connectionName.toLowerCase();
  const duplicateIndex = connections.findIndex(
    (connection, index) => index !== currentIndex && connection.name.toLowerCase() === normalizedName
  );

  if (duplicateIndex >= 0) {
    throw new Error("Connection name must be unique within the selected project.");
  }
}

function ensureUniqueCatalogPath(catalogs, catalogPath, currentIndex) {
  const normalizedPath = catalogPath.toLowerCase();
  const duplicateIndex = catalogs.findIndex(
    (catalog, index) => index !== currentIndex && catalog.path.toLowerCase() === normalizedPath
  );

  if (duplicateIndex >= 0) {
    throw new Error("Catalog path must be unique within the selected project.");
  }
}

async function createProject(projectInput) {
  const draft = normalizeProjectDraft(projectInput);
  validateProjectDraft(draft);

  const projectState = await readProjectState();
  const normalizedCode = draft.code.toLowerCase();

  if (projectState.projects.some((project) => project.code.toLowerCase() === normalizedCode)) {
    throw new Error("Project code must be unique.");
  }

  const now = new Date().toISOString();
  const nextProject = {
    ...draft,
    connections: [],
    catalogs: [],
    createdAt: now,
    updatedAt: now
  };

  return writeProjectState({
    activeProjectCode: nextProject.code,
    projects: [nextProject, ...projectState.projects]
  });
}

async function openProject(projectCode) {
  const code = String(projectCode ?? "").trim();

  if (!code) {
    throw new Error("Choose a project to open.");
  }

  const projectState = await readProjectState();
  const project = projectState.projects.find((item) => item.code === code);

  if (!project) {
    throw new Error("The selected project was not found.");
  }

  return writeProjectState({
    ...projectState,
    activeProjectCode: project.code
  });
}

async function updateProject(projectCode, projectInput) {
  const code = String(projectCode ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before saving changes.");
  }

  const projectState = await readProjectState();
  const { project, projectIndex } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before saving changes."
  );
  const draft = normalizeProjectDraft({
    ...projectInput,
    code
  });

  validateProjectDraft(draft);

  const now = new Date().toISOString();
  const nextProjects = [...projectState.projects];
  nextProjects[projectIndex] = {
    ...project,
    name: draft.name,
    description: draft.description,
    updatedAt: now
  };

  return writeProjectState({
    ...projectState,
    projects: nextProjects
  });
}

async function deleteProject(projectCode) {
  const code = String(projectCode ?? "").trim();

  if (!code) {
    throw new Error("Choose a project to delete.");
  }

  const projectState = await readProjectState();
  const nextProjects = projectState.projects.filter((project) => project.code !== code);

  if (nextProjects.length === projectState.projects.length) {
    throw new Error("The selected project was not found.");
  }

  return writeProjectState({
    activeProjectCode:
      projectState.activeProjectCode === code ? nextProjects[0]?.code ?? null : projectState.activeProjectCode,
    projects: nextProjects
  });
}

async function saveCatalog(projectCode, catalogInput, existingCatalogPath) {
  const code = String(projectCode ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before saving a catalog path.");
  }

  const draft = normalizeCatalogDraft(catalogInput);
  validateCatalogDraft(draft);

  const projectState = await readProjectState();
  const { project, projectIndex } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before saving a catalog path."
  );
  const nextCatalogs = [...project.catalogs];
  const catalogIndex = getCatalogIndex(nextCatalogs, existingCatalogPath);

  ensureUniqueCatalogPath(nextCatalogs, draft.path, catalogIndex);

  const now = new Date().toISOString();
  const nextCatalog =
    catalogIndex >= 0
      ? {
          ...nextCatalogs[catalogIndex],
          ...draft,
          updatedAt: now
        }
      : {
          ...draft,
          createdAt: now,
          updatedAt: now
        };

  if (catalogIndex >= 0) {
    nextCatalogs[catalogIndex] = nextCatalog;
  } else {
    nextCatalogs.unshift(nextCatalog);
  }

  const nextProjects = [...projectState.projects];
  nextProjects[projectIndex] = {
    ...project,
    catalogs: nextCatalogs,
    updatedAt: now
  };

  return writeProjectState({
    ...projectState,
    projects: nextProjects
  });
}

async function recordCatalogMetadataDownload(projectCode, catalogPath, historyInput, latestMetadataInput) {
  const code = String(projectCode ?? "").trim();
  const normalizedCatalogPath = String(catalogPath ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before recording catalog metadata.");
  }

  if (!normalizedCatalogPath) {
    throw new Error("Choose a catalog path before recording catalog metadata.");
  }

  const projectState = await readProjectState();
  const { project, projectIndex } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before recording catalog metadata."
  );
  const catalogIndex = getCatalogIndex(project.catalogs, normalizedCatalogPath);

  if (catalogIndex < 0) {
    throw new Error("The selected catalog path was not found.");
  }

  const now = new Date().toISOString();
  const historyEntry = normalizeCatalogMetadataHistoryEntry({
    ...historyInput,
    completedAt: String(historyInput?.completedAt ?? now),
    requestedAt: String(historyInput?.requestedAt ?? historyInput?.completedAt ?? now)
  });
  const nextCatalogs = [...project.catalogs];
  const currentCatalog = nextCatalogs[catalogIndex];
  const nextHistorySource = [historyEntry, ...currentCatalog.metadataHistory];
  const nextHistory = nextHistorySource.slice(0, MAX_METADATA_HISTORY);
  const trimmedHistory = nextHistorySource.slice(MAX_METADATA_HISTORY);
  const nextCatalog = {
    ...currentCatalog,
    updatedAt: now,
    metadataHistory: nextHistory
  };

  if (latestMetadataInput && latestMetadataInput.tempFilePath) {
    nextCatalog.latestMetadataFileName = normalizeOptionalString(latestMetadataInput.fileName);
    nextCatalog.latestMetadataTempPath = normalizeOptionalString(latestMetadataInput.tempFilePath);
    nextCatalog.latestMetadataConnectionName = normalizeOptionalString(latestMetadataInput.connectionName);
    nextCatalog.latestMetadataDownloadedAt = normalizeOptionalString(latestMetadataInput.downloadedAt);
  }

  nextCatalogs[catalogIndex] = nextCatalog;

  const nextProjects = [...projectState.projects];
  nextProjects[projectIndex] = {
    ...project,
    catalogs: nextCatalogs,
    updatedAt: now
  };

  const persistedState = await writeProjectState({
    ...projectState,
    projects: nextProjects
  });

  const retainedTempPaths = new Set(
    [nextCatalog.latestMetadataTempPath, ...nextHistory.map((entry) => entry.tempFilePath)]
      .filter(Boolean)
  );

  await Promise.all(
    [...new Set(trimmedHistory.map((entry) => entry.tempFilePath).filter(Boolean))].map((tempFilePath) => {
      if (retainedTempPaths.has(tempFilePath)) {
        return Promise.resolve();
      }

      if (!isPathInsideDirectory(tempFilePath, getCatalogMetadataTempRoot())) {
        return Promise.resolve();
      }

      return fs.unlink(tempFilePath).catch((error) => {
        if (error && error.code !== "ENOENT") {
          throw error;
        }
      });
    })
  );

  return persistedState;
}

async function deleteCatalogMetadataHistoryEntry(projectCode, catalogPath, historyEntryId) {
  const code = String(projectCode ?? "").trim();
  const normalizedCatalogPath = String(catalogPath ?? "").trim();
  const normalizedHistoryEntryId = String(historyEntryId ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before deleting catalog metadata history.");
  }

  if (!normalizedCatalogPath) {
    throw new Error("Choose a catalog path before deleting metadata history.");
  }

  if (!normalizedHistoryEntryId) {
    throw new Error("Choose a metadata history entry to delete.");
  }

  const projectState = await readProjectState();
  const { project, projectIndex } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before deleting catalog metadata history."
  );
  const catalogIndex = getCatalogIndex(project.catalogs, normalizedCatalogPath);

  if (catalogIndex < 0) {
    throw new Error("The selected catalog path was not found.");
  }

  const nextCatalogs = [...project.catalogs];
  const currentCatalog = nextCatalogs[catalogIndex];
  const historyEntryToDelete =
    currentCatalog.metadataHistory.find((entry) => entry.id === normalizedHistoryEntryId) ?? null;

  if (!historyEntryToDelete) {
    throw new Error("The selected metadata history entry was not found.");
  }

  const nextHistory = currentCatalog.metadataHistory.filter((entry) => entry.id !== normalizedHistoryEntryId);
  const nextCatalog = {
    ...currentCatalog,
    metadataHistory: nextHistory,
    updatedAt: new Date().toISOString()
  };

  if (
    currentCatalog.latestMetadataTempPath &&
    currentCatalog.latestMetadataTempPath === historyEntryToDelete.tempFilePath
  ) {
    const nextLatestHistoryEntry = nextHistory.find((entry) => entry.tempFilePath) ?? null;

    nextCatalog.latestMetadataFileName = nextLatestHistoryEntry?.fileName ?? null;
    nextCatalog.latestMetadataTempPath = nextLatestHistoryEntry?.tempFilePath ?? null;
    nextCatalog.latestMetadataConnectionName = nextLatestHistoryEntry?.connectionName ?? null;
    nextCatalog.latestMetadataDownloadedAt = nextLatestHistoryEntry?.completedAt ?? null;
  }

  nextCatalogs[catalogIndex] = nextCatalog;

  const nextProjects = [...projectState.projects];
  nextProjects[projectIndex] = {
    ...project,
    catalogs: nextCatalogs,
    updatedAt: nextCatalog.updatedAt
  };

  const persistedState = await writeProjectState({
    ...projectState,
    projects: nextProjects
  });

  const retainedTempPaths = new Set(
    [nextCatalog.latestMetadataTempPath, ...nextHistory.map((entry) => entry.tempFilePath)].filter(Boolean)
  );

  if (
    historyEntryToDelete.tempFilePath &&
    !retainedTempPaths.has(historyEntryToDelete.tempFilePath) &&
    isPathInsideDirectory(historyEntryToDelete.tempFilePath, getCatalogMetadataTempRoot())
  ) {
    await fs.unlink(historyEntryToDelete.tempFilePath).catch((error) => {
      if (error && error.code !== "ENOENT") {
        throw error;
      }
    });
  }

  return persistedState;
}

async function saveConnection(projectCode, connectionInput, existingConnectionName) {
  const code = String(projectCode ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before saving a connection.");
  }

  const draft = normalizeConnectionDraft(connectionInput);
  validateConnectionDraft(draft);

  const projectState = await readProjectState();
  const { project, projectIndex } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before saving a connection."
  );
  const nextConnections = [...project.connections];
  const connectionIndex = resolveConnectionIndex(nextConnections, existingConnectionName);

  ensureUniqueConnectionName(nextConnections, draft.name, connectionIndex);

  const now = new Date().toISOString();
  const nextConnection =
    connectionIndex >= 0
      ? {
          ...nextConnections[connectionIndex],
          ...draft,
          updatedAt: now
        }
      : {
          ...draft,
          createdAt: now,
          updatedAt: now
        };

  if (connectionIndex >= 0) {
    nextConnections[connectionIndex] = nextConnection;
  } else {
    nextConnections.unshift(nextConnection);
  }

  const nextProjects = [...projectState.projects];
  nextProjects[projectIndex] = {
    ...project,
    connections: nextConnections,
    updatedAt: now
  };

  return writeProjectState({
    ...projectState,
    projects: nextProjects
  });
}

async function deleteConnection(projectCode, connectionName) {
  const code = String(projectCode ?? "").trim();
  const name = String(connectionName ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before deleting a connection.");
  }

  if (!name) {
    throw new Error("Choose a connection to delete.");
  }

  const projectState = await readProjectState();
  const { project, projectIndex } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before deleting a connection."
  );
  const nextConnections = project.connections.filter((connection) => connection.name !== name);

  if (nextConnections.length === project.connections.length) {
    throw new Error("The selected connection was not found.");
  }

  const now = new Date().toISOString();
  const nextProjects = [...projectState.projects];
  nextProjects[projectIndex] = {
    ...project,
    connections: nextConnections,
    updatedAt: now
  };

  return writeProjectState({
    ...projectState,
    projects: nextProjects
  });
}

async function deleteCatalog(projectCode, catalogPath) {
  const code = String(projectCode ?? "").trim();
  const normalizedCatalogPath = String(catalogPath ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before deleting a catalog path.");
  }

  if (!normalizedCatalogPath) {
    throw new Error("Choose a catalog path to delete.");
  }

  const projectState = await readProjectState();
  const { project, projectIndex } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before deleting a catalog path."
  );
  const catalogIndex = getCatalogIndex(project.catalogs, normalizedCatalogPath);

  if (catalogIndex < 0) {
    throw new Error("The selected catalog path was not found.");
  }

  const catalogToDelete = project.catalogs[catalogIndex];
  const tempFilePaths = [
    catalogToDelete.latestMetadataTempPath,
    ...catalogToDelete.metadataHistory.map((entry) => entry.tempFilePath)
  ];

  await Promise.all(
    [...new Set(tempFilePaths.filter(Boolean))].map((tempFilePath) => {
      if (!isPathInsideDirectory(tempFilePath, getCatalogMetadataTempRoot())) {
        return Promise.resolve();
      }

      return fs.unlink(tempFilePath).catch((error) => {
        if (error && error.code !== "ENOENT") {
          throw error;
        }
      });
    })
  );

  const nextCatalogs = [...project.catalogs];
  nextCatalogs.splice(catalogIndex, 1);

  const now = new Date().toISOString();
  const nextProjects = [...projectState.projects];
  nextProjects[projectIndex] = {
    ...project,
    catalogs: nextCatalogs,
    updatedAt: now
  };

  return writeProjectState({
    ...projectState,
    projects: nextProjects
  });
}

module.exports = {
  createProject,
  deleteCatalogMetadataHistoryEntry,
  recordCatalogMetadataDownload,
  saveCatalog,
  deleteCatalog,
  deleteConnection,
  deleteProject,
  openProject,
  readProjectState,
  saveConnection,
  updateProject
};
