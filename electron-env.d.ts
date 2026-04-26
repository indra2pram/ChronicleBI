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

type EnvironmentType = "Dev" | "Test" | "Prod";

interface ConnectionDraft {
  name: string;
  url: string;
  username: string;
  password: string;
  environmentType: EnvironmentType;
}

interface CatalogDraft {
  path: string;
}

interface StoredConnection extends ConnectionDraft {
  createdAt: string;
  updatedAt: string;
}

type CatalogMetadataHistoryStatus = "success" | "failed";

interface CatalogMetadataHistoryEntry {
  id: string;
  requestedAt: string;
  completedAt: string;
  status: CatalogMetadataHistoryStatus;
  connectionName: string;
  environmentType: EnvironmentType | null;
  fileName: string | null;
  tempFilePath: string | null;
  detail: string;
}

interface StoredCatalog extends CatalogDraft {
  createdAt: string;
  updatedAt: string;
  latestMetadataFileName: string | null;
  latestMetadataTempPath: string | null;
  latestMetadataConnectionName: string | null;
  latestMetadataDownloadedAt: string | null;
  metadataHistory: CatalogMetadataHistoryEntry[];
}

interface BipPayloadMetadata {
  transportEncoding: string;
  originalLength: number;
  normalizedLength: number;
  decodedBytes: number;
  sha256: string;
  format: string;
  isLikelyText: boolean;
  rootPayloadName: string;
  text?: Record<string, unknown>;
  zip?: Record<string, unknown>;
}

interface BipDownloadMetadata {
  generatedAt: string;
  catalogPath: string;
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
  environmentType: EnvironmentType;
  endpoint: string;
  variantUsed: string;
  httpStatus: number;
  catalogPath: string;
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
  tempMetadataPath: string;
}

interface CatalogDownloadToFileResult {
  canceled: boolean;
  filePath: string | null;
  fileName: string;
  catalogPath: string;
  connectionName: string;
}

interface MetadataSaveResult {
  canceled: boolean;
  filePath: string | null;
}

interface CachedCatalogMetadata {
  fileName: string;
  filePath: string;
  projectCode: string;
  catalogPath: string;
  connectionName: string | null;
  downloadedAt: string | null;
  content: string;
}

interface StoredProject extends ProjectDraft {
  createdAt: string;
  updatedAt: string;
  connections: StoredConnection[];
  catalogs: StoredCatalog[];
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
    updateProject: (projectCode: string, project: ProjectDraft) => Promise<ProjectState>;
    deleteProject: (projectCode: string) => Promise<ProjectState>;
    saveCatalog: (
      projectCode: string,
      catalog: CatalogDraft,
      existingCatalogPath?: string | null
    ) => Promise<ProjectState>;
    validateCatalogPath: (
      projectCode: string,
      connectionName: string,
      catalogPath: string
    ) => Promise<void>;
    deleteCatalog: (projectCode: string, catalogPath: string) => Promise<ProjectState>;
    saveConnection: (
      projectCode: string,
      connection: ConnectionDraft,
      existingConnectionName?: string | null
    ) => Promise<ProjectState>;
    deleteConnection: (projectCode: string, connectionName: string) => Promise<ProjectState>;
    downloadBipObject: (
      projectCode: string,
      connectionName: string,
      catalogPath: string
    ) => Promise<BipDownloadResult>;
    downloadCatalogToFile: (
      projectCode: string,
      connectionName: string,
      catalogPath: string
    ) => Promise<CatalogDownloadToFileResult>;
    getCachedCatalogMetadata: (
      projectCode: string,
      catalogPath: string,
      historyEntryId?: string | null
    ) => Promise<CachedCatalogMetadata>;
    deleteCatalogMetadataHistoryEntry: (
      projectCode: string,
      catalogPath: string,
      historyEntryId: string
    ) => Promise<ProjectState>;
    saveMetadataJson: (
      defaultFileName: string,
      metadata: BipDownloadMetadata
    ) => Promise<MetadataSaveResult>;
    onMenuAction: (callback: (command: ProjectMenuAction) => void) => () => void;
  };
}
