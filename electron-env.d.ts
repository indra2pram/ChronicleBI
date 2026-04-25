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

interface BipPayloadMetadata {
  transportEncoding: string;
  originalLength: number;
  normalizedLength: number;
  decodedBytes: number;
  sha256: string;
  format: string;
  isLikelyText: boolean;
  text?: Record<string, unknown>;
  zip?: Record<string, unknown>;
}

interface BipDownloadMetadata {
  generatedAt: string;
  reportPath: string;
  payload: BipPayloadMetadata;
  extraction?: Record<string, unknown>;
  structure?: Record<string, unknown>;
  dataModel?: Record<string, unknown>;
  sqlQueries?: Record<string, unknown>;
  metadataProperties?: Record<string, unknown>;
}

interface BipDownloadResult {
  requestedAt: string;
  projectCode: string;
  projectName: string;
  connectionName: string;
  endpoint: string;
  variantUsed: string;
  httpStatus: number;
  reportPath: string;
  downloadObjectReturn: string;
  payloadBase64Length: number;
  payloadDecodedBytes: number | null;
  payloadPreview: string;
  responseSnippet: string;
  metadataFileName: string;
  metadata: BipDownloadMetadata;
  metadataSavedPath: string;
  metadataSavedFolder: string;
  bipJsonRootFolder: string;
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
    downloadBipObject: (
      projectCode: string,
      connectionName: string,
      reportPath: string
    ) => Promise<BipDownloadResult>;
    onMenuAction: (callback: (command: ProjectMenuAction) => void) => () => void;
  };
}
