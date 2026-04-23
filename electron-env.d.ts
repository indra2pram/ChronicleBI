interface ElectronAppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
}

interface ProjectDraft {
  code: string;
  name: string;
  description: string;
}

interface ConnectionDraft {
  name: string;
  url: string;
  username: string;
  password: string;
}

interface StoredConnection extends ConnectionDraft {
  createdAt: string;
  updatedAt: string;
}

interface ConnectionTestResult {
  status: "passed";
  message: string;
  testedAt: string;
}

interface StoredProject extends ProjectDraft {
  createdAt: string;
  updatedAt: string;
  connections: StoredConnection[];
}

interface ProjectState {
  activeProjectCode: string | null;
  projects: StoredProject[];
}

type ProjectMenuAction = "add-project" | "open-project" | "manage-projects";

interface Window {
  electronAPI: {
    getAppInfo: () => Promise<ElectronAppInfo>;
    ping: () => Promise<string>;
    getProjectState: () => Promise<ProjectState>;
    createProject: (project: ProjectDraft) => Promise<ProjectState>;
    openProject: (projectCode: string) => Promise<ProjectState>;
    deleteProject: (projectCode: string) => Promise<ProjectState>;
    saveConnection: (
      projectCode: string,
      connection: ConnectionDraft,
      existingConnectionName?: string | null
    ) => Promise<ProjectState>;
    deleteConnection: (projectCode: string, connectionName: string) => Promise<ProjectState>;
    testConnection: (
      projectCode: string,
      connection: ConnectionDraft,
      existingConnectionName?: string | null
    ) => Promise<ConnectionTestResult>;
    onMenuAction: (callback: (command: ProjectMenuAction) => void) => () => void;
  };
}
