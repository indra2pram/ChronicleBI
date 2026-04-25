const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  ping: () => ipcRenderer.invoke("app:ping"),
  getProjectState: () => ipcRenderer.invoke("project:get-state"),
  createProject: (project) => ipcRenderer.invoke("project:create", project),
  openProject: (projectCode) => ipcRenderer.invoke("project:open", projectCode),
  deleteProject: (projectCode) => ipcRenderer.invoke("project:delete", projectCode),
  saveConnection: (projectCode, connection, existingConnectionName) =>
    ipcRenderer.invoke("connection:save", projectCode, connection, existingConnectionName),
  deleteConnection: (projectCode, connectionName) =>
    ipcRenderer.invoke("connection:delete", projectCode, connectionName),
  testConnection: (projectCode, connection, existingConnectionName) =>
    ipcRenderer.invoke("connection:test", projectCode, connection, existingConnectionName),
  downloadBipObject: (projectCode, connectionName, reportPath) =>
    ipcRenderer.invoke("bip:download-object", projectCode, connectionName, reportPath),
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
