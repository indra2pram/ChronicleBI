const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  ping: () => ipcRenderer.invoke("app:ping"),
  getProjectState: () => ipcRenderer.invoke("project:get-state"),
  createProject: (project) => ipcRenderer.invoke("project:create", project),
  openProject: (projectCode) => ipcRenderer.invoke("project:open", projectCode),
  updateProject: (projectCode, project) => ipcRenderer.invoke("project:update", projectCode, project),
  deleteProject: (projectCode) => ipcRenderer.invoke("project:delete", projectCode),
  saveCatalog: (projectCode, catalog, existingCatalogPath) =>
    ipcRenderer.invoke("catalog:save", projectCode, catalog, existingCatalogPath),
  validateCatalogPath: (projectCode, connectionName, catalogPath) =>
    ipcRenderer.invoke("catalog:validate", projectCode, connectionName, catalogPath),
  deleteCatalog: (projectCode, catalogPath) =>
    ipcRenderer.invoke("catalog:delete", projectCode, catalogPath),
  saveConnection: (projectCode, connection, existingConnectionName) =>
    ipcRenderer.invoke("connection:save", projectCode, connection, existingConnectionName),
  deleteConnection: (projectCode, connectionName) =>
    ipcRenderer.invoke("connection:delete", projectCode, connectionName),
  downloadBipObject: (projectCode, connectionName, catalogPath) =>
    ipcRenderer.invoke("bip:download-object", projectCode, connectionName, catalogPath),
  downloadCatalogToFile: (projectCode, connectionName, catalogPath) =>
    ipcRenderer.invoke("catalog:download-to-file", projectCode, connectionName, catalogPath),
  getCachedCatalogMetadata: (projectCode, catalogPath, historyEntryId) =>
    ipcRenderer.invoke("catalog:get-cached-metadata", projectCode, catalogPath, historyEntryId),
  saveMetadataJson: (defaultFileName, metadata) =>
    ipcRenderer.invoke("metadata:save-json", defaultFileName, metadata),
  onMenuAction: (callback) => {
    const listener = (_event, command) => {
      callback(command);
    };

    ipcRenderer.on("menu:command", listener);

    return () => {
      ipcRenderer.removeListener("menu:command", listener);
    };
  }
});
