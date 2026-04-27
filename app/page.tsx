"use client";

import { FormEvent, useEffect, useState } from "react";

const defaultProjectForm: ProjectDraft = {
  code: "",
  name: "",
  description: ""
};

const defaultCatalogForm: CatalogFormState = {
  path: "",
  connectionName: ""
};

const defaultCatalogDownloadForm: CatalogDownloadDraft = {
  connectionName: "",
  catalogPath: ""
};

const defaultConnectionForm: ConnectionDraft = {
  name: "",
  url: "",
  username: "",
  password: "",
  environmentType: "Dev"
};

const connectionUrlPattern = "https://*.fa.ocs.oraclecloud.com";
const environmentTypeOptions: ReadonlyArray<EnvironmentType> = ["Dev", "Test", "Prod"];

type ExplorerSection = "project" | "connections" | "catalogs" | "connection" | "catalog";
type ExplorerFolderName = "connections" | "catalogs";
type ConnectionDialogMode = "create" | "edit";
type CatalogDialogMode = "create";
type ProjectDialogMode = ProjectMenuAction | "edit-project";
type CatalogDownloadMode = "metadata" | "catalog";
type MetadataPreviewTab = "metadata" | "overview";
type BannerTone = "info" | "success" | "error";
type ActionButtonTone = "primary" | "secondary" | "ghost" | "danger";
type AppIconKind =
  | "add"
  | "open"
  | "manage"
  | "refresh"
  | "projects"
  | "connections"
  | "connection"
  | "catalogs"
  | "catalog"
  | "tool"
  | "trash"
  | "close-square"
  | "empty";

interface BannerState {
  tone: BannerTone;
  message: string;
  detail?: string;
}

interface ExpandedFolderState {
  connections: boolean;
  catalogs: boolean;
}

interface ActionButtonConfig {
  label: string;
  tone: ActionButtonTone;
  icon?: AppIconKind;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}

interface MetricItem {
  label: string;
  value: string | number;
}

interface CatalogFormState extends CatalogDraft {
  connectionName: string;
}

interface CatalogDownloadDraft {
  connectionName: string;
  catalogPath: string;
}

interface MetadataPreviewState {
  fileName: string;
  catalogPath: string;
  connectionName: string;
  projectCode: string;
  content: string;
  metadata: BipDownloadMetadata;
  downloadedAt: string;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

function matchesConnectionUrlPattern(value: string) {
  try {
    const parsedUrl = new URL(value.trim());
    const hostname = parsedUrl.hostname.toLowerCase();
    const requiredSuffix = ".fa.ocs.oraclecloud.com";

    return (
      parsedUrl.protocol === "https:" &&
      hostname.endsWith(requiredSuffix) &&
      hostname.length > requiredSuffix.length &&
      (!parsedUrl.pathname || parsedUrl.pathname === "/") &&
      !parsedUrl.search &&
      !parsedUrl.hash
    );
  } catch (_error) {
    return false;
  }
}

function formatTimestamp(value: string) {
  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  } catch (_error) {
    return value;
  }
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "Unavailable";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function formatConnectionCount(count: number) {
  return `${count} connection${count === 1 ? "" : "s"}`;
}

function formatCatalogCount(count: number) {
  return `${count} catalog${count === 1 ? "" : "s"}`;
}

function getCatalogDisplayName(catalogPath: string) {
  const segments = String(catalogPath ?? "").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? catalogPath;
}

function isEnvironmentType(value: string | number): value is EnvironmentType {
  return environmentTypeOptions.includes(value as EnvironmentType);
}

function getDefaultExpandedFolders(): ExpandedFolderState {
  return {
    connections: false,
    catalogs: false
  };
}

type MetadataScalarValue = string | number | boolean | null;

interface MetadataOverviewSection {
  id: string;
  title: string;
  value: unknown;
}

function isMetadataScalarValue(value: unknown): value is MetadataScalarValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatMetadataLabel(value: string) {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\bsql\b/gi, "SQL")
    .replace(/\bxml\b/gi, "XML")
    .replace(/\bjson\b/gi, "JSON")
    .replace(/\bsha\b/gi, "SHA");

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatMetadataScalar(label: string, value: MetadataScalarValue) {
  if (value === null) {
    return "None";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    const normalizedLabel = label.toLowerCase();

    if (normalizedLabel.includes("bytes")) {
      return `${value.toLocaleString()} (${formatBytes(value)})`;
    }

    return value.toLocaleString();
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "None";
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmedValue)) {
    return formatTimestamp(trimmedValue);
  }

  return trimmedValue;
}

function isMetadataScalarArray(values: unknown[]): values is MetadataScalarValue[] {
  return values.every((value) => isMetadataScalarValue(value));
}

function getMetadataTableColumns(rows: Array<Record<string, unknown>>) {
  const columnSet = new Set<string>();

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        if (!isMetadataScalarArray(value)) {
          return [];
        }

        columnSet.add(key);
        continue;
      }

      if (!isMetadataScalarValue(value)) {
        return [];
      }

      columnSet.add(key);
    }
  }

  return [...columnSet];
}

function renderMetadataTableCell(label: string, value: unknown) {
  if (Array.isArray(value) && isMetadataScalarArray(value)) {
    return value.length > 0 ? value.map((entry) => formatMetadataScalar(label, entry)).join(", ") : "None";
  }

  if (isMetadataScalarValue(value)) {
    return formatMetadataScalar(label, value);
  }

  if (value === undefined) {
    return "None";
  }

  return JSON.stringify(value);
}

function renderMetadataOverviewValue(label: string, value: unknown, keyPath: string) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="metadata-overview-empty">No entries.</p>;
    }

    if (isMetadataScalarArray(value)) {
      return (
        <ul className="metadata-overview-list">
          {value.map((entry, index) => (
            <li key={`${keyPath}-${index}`}>{formatMetadataScalar(label, entry)}</li>
          ))}
        </ul>
      );
    }

    if (value.every((entry) => isMetadataRecord(entry))) {
      const rows = value as Array<Record<string, unknown>>;
      const columns = getMetadataTableColumns(rows);

      if (columns.length > 0) {
        return (
          <div className="metadata-overview-table-wrap">
            <table className="metadata-overview-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={`${keyPath}-${column}`}>{formatMetadataLabel(column)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${keyPath}-row-${rowIndex}`}>
                    {columns.map((column) => (
                      <td key={`${keyPath}-row-${rowIndex}-${column}`}>
                        {renderMetadataTableCell(column, row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }

    return (
      <div className="metadata-overview-stack">
        {value.map((entry, index) => (
          <section className="metadata-overview-group" key={`${keyPath}-${index}`}>
            <h4 className="metadata-overview-group-title">{`${formatMetadataLabel(label)} ${index + 1}`}</h4>
            {renderMetadataOverviewValue(label, entry, `${keyPath}-${index}`)}
          </section>
        ))}
      </div>
    );
  }

  if (isMetadataRecord(value)) {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    const scalarEntries = entries.filter(([, entryValue]) => isMetadataScalarValue(entryValue));
    const nestedEntries = entries.filter(([, entryValue]) => !isMetadataScalarValue(entryValue));

    return (
      <div className="metadata-overview-block">
        {scalarEntries.length > 0 ? (
          <div className="meta-list metadata-preview-meta metadata-overview-meta">
            {scalarEntries.map(([entryLabel, entryValue]) => {
              const scalarValue = entryValue as MetadataScalarValue;

              return (
                <div className="meta-item" key={`${keyPath}-${entryLabel}`}>
                  <span className="meta-label">{formatMetadataLabel(entryLabel)}</span>
                  <span className="meta-value">{formatMetadataScalar(entryLabel, scalarValue)}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {nestedEntries.map(([entryLabel, entryValue]) => (
          <section className="metadata-overview-group" key={`${keyPath}-${entryLabel}`}>
            <h4 className="metadata-overview-group-title">{formatMetadataLabel(entryLabel)}</h4>
            {renderMetadataOverviewValue(entryLabel, entryValue, `${keyPath}-${entryLabel}`)}
          </section>
        ))}
      </div>
    );
  }

  return <p className="metadata-overview-inline-value">{renderMetadataTableCell(label, value)}</p>;
}

function getProjectCatalogCount(project: StoredProject) {
  return project.catalogs.length;
}

function getInitialCatalogConnectionName(project: StoredProject | null) {
  return project?.connections[0]?.name ?? "";
}

function createMetadataPreviewState({
  fileName,
  catalogPath,
  connectionName,
  projectCode,
  metadata,
  content,
  downloadedAt
}: Readonly<{
  fileName: string;
  catalogPath: string;
  connectionName: string | null;
  projectCode: string;
  metadata: BipDownloadMetadata;
  content?: string;
  downloadedAt?: string | null;
}>): MetadataPreviewState {
  return {
    fileName,
    catalogPath,
    connectionName: String(connectionName ?? "").trim() || "Unavailable",
    projectCode,
    content: content ?? JSON.stringify(metadata, null, 2),
    metadata,
    downloadedAt: String(downloadedAt ?? metadata.generatedAt ?? new Date().toISOString())
  };
}

function renderHighlightedJsonLine(line: string) {
  const tokenPattern =
    /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}\[\],:]/g;
  const tokens: Array<{ className?: string; value: string }> = [];
  let lastIndex = 0;
  let match = tokenPattern.exec(line);

  while (match) {
    if (match.index > lastIndex) {
      tokens.push({
        value: line.slice(lastIndex, match.index)
      });
    }

    const token = match[0];
    const trailingContent = line.slice(match.index + token.length);
    let className = "json-token json-punctuation";

    if (token.startsWith('"')) {
      className = /^\s*:/.test(trailingContent) ? "json-token json-key" : "json-token json-string";
    } else if (token === "true" || token === "false") {
      className = "json-token json-boolean";
    } else if (token === "null") {
      className = "json-token json-null";
    } else if (/^-?\d/.test(token)) {
      className = "json-token json-number";
    }

    tokens.push({
      className,
      value: token
    });
    lastIndex = match.index + token.length;
    match = tokenPattern.exec(line);
  }

  if (lastIndex < line.length) {
    tokens.push({
      value: line.slice(lastIndex)
    });
  }

  if (tokens.length === 0) {
    return [<span key="json-empty-line">{line || "\u00A0"}</span>];
  }

  return tokens.map((token, index) => (
    <span className={token.className} key={`json-token-${index}`}>
      {token.value || "\u00A0"}
    </span>
  ));
}

function AppIcon({
  kind,
  className = ""
}: Readonly<{
  kind: AppIconKind;
  className?: string;
}>) {
  const oracleReferenceClassName =
    kind === "connections" || kind === "catalogs"
      ? "oj-ux-ico-folder-closed"
      : kind === "connection"
        ? "oj-ux-ico-connection"
        : kind === "catalog"
          ? "oj-ux-ico-report"
          : kind === "trash"
            ? "oj-ux-ico-trash"
            : kind === "close-square"
              ? "oj-ux-ico-close-square"
              : "";

  function renderIconShape() {
    if (kind === "projects") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path
            d="M4 5.5h16v13H4zM8 3.5h8v2H8zM7.5 9h3v3h-3zm6 0h3v3h-3zm-6 5h3v3h-3zm6 0h3v3h-3z"
            fill="currentColor"
          />
        </svg>
      );
    }

    if (kind === "connections" || kind === "catalogs") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path
            d="M3.5 7.5h6l1.6 1.8H20a1 1 0 0 1 1 1v6.7a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 17V8.5a1 1 0 0 1 .5-1z"
            fill="currentColor"
          />
          <path d="M3 9.2h18v1.5H3z" fill="rgba(255,255,255,0.5)" />
        </svg>
      );
    }

    if (kind === "connection") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path
            d="M7.5 4.5h2v4.2h5V4.5h2v4.3a3.3 3.3 0 0 1-2.7 3.2v2.7l2.8 2.8-1.4 1.4-3.4-3.4V12H11v3.5l-3.4 3.4-1.4-1.4 2.8-2.8V12a3.3 3.3 0 0 1-2.7-3.2z"
            fill="currentColor"
          />
        </svg>
      );
    }

    if (kind === "catalog") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path
            d="M6 3.5h8.4L19 8.1V20H6zM14 4.9V9h4.1"
            fill="none"
            stroke="currentColor"
            strokeLinecap="square"
            strokeLinejoin="miter"
            strokeWidth="1.8"
          />
          <path d="M8.5 12.2h7M8.5 15.2h7" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    }

    if (kind === "add") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor" />
        </svg>
      );
    }

    if (kind === "open") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path
            d="M4 7.5h6l1.8 2H20v7.8H4z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="miter"
            strokeWidth="1.8"
          />
          <path d="M11 15.8l4.2-4.1H12.7V8.9h-1.9v2.8H8.3z" fill="currentColor" />
        </svg>
      );
    }

    if (kind === "manage") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path d="M5 7h14v2H5zm0 8h14v2H5zM9 5h2v6H9zm4 8h2v6h-2z" fill="currentColor" />
        </svg>
      );
    }

    if (kind === "refresh") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path
            d="M17.8 10A6 6 0 1 0 18 13.5M18 6v4h-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="square"
            strokeLinejoin="miter"
            strokeWidth="1.8"
          />
        </svg>
      );
    }

    if (kind === "tool") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path
            d="M14.5 4.5a4 4 0 0 0-2.4 6.9l-6.2 6.2 1.8 1.8 6.2-6.2a4 4 0 0 0 5-5L16 10l-2-2z"
            fill="currentColor"
          />
        </svg>
      );
    }

    if (kind === "trash") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path
            d="M8 6.5h8M10 4.5h4M7 6.5l.7 12h8.6L17 6.5M10 10v5.5M14 10v5.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="square"
            strokeLinejoin="miter"
            strokeWidth="1.8"
          />
        </svg>
      );
    }

    if (kind === "close-square") {
      return (
        <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
          <path
            d="M5 5h14v14H5zM9 9l6 6M15 9l-6 6"
            fill="none"
            stroke="currentColor"
            strokeLinecap="square"
            strokeLinejoin="miter"
            strokeWidth="1.8"
          />
        </svg>
      );
    }

    return (
      <svg aria-hidden="true" className="ui-icon-svg" viewBox="0 0 24 24">
        <path
          d="M6 6h12v12H6zM9 9h6v6H9z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="square"
          strokeLinejoin="miter"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`ui-icon ui-icon-${kind} ${oracleReferenceClassName} ${className}`.trim()}
    >
      {renderIconShape()}
    </span>
  );
}

function IconOnlyButton({
  className = "",
  disabled,
  kind,
  label,
  onClick,
  tone = "neutral",
  type = "button"
}: Readonly<{
  className?: string;
  disabled?: boolean;
  kind: "trash" | "close-square";
  label: string;
  onClick: () => void;
  tone?: "neutral" | "danger";
  type?: "button" | "submit";
}>) {
  return (
    <button
      aria-label={label}
      className={`icon-only-button icon-only-button-${tone} ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type={type}
    >
      <AppIcon className="icon-only-button-icon" kind={kind} />
    </button>
  );
}

function EnvironmentBadge({
  environmentType
}: Readonly<{
  environmentType: EnvironmentType | null;
}>) {
  const normalizedEnvironmentType = environmentType ?? "Dev";

  return (
    <span
      className={`environment-badge environment-badge-${normalizedEnvironmentType.toLowerCase()}`}
      title={`Environment: ${normalizedEnvironmentType}`}
    >
      {normalizedEnvironmentType}
    </span>
  );
}

function getActionButtonClassName(tone: ActionButtonTone) {
  if (tone === "primary") {
    return "primary-button";
  }

  if (tone === "secondary") {
    return "secondary-button";
  }

  if (tone === "danger") {
    return "danger-button";
  }

  return "ghost-button";
}

export default function HomePage() {
  const [projectState, setProjectState] = useState<ProjectState>({
    activeProjectCode: null,
    projects: []
  });
  const [projectForm, setProjectForm] = useState<ProjectDraft>(defaultProjectForm);
  const [catalogForm, setCatalogForm] = useState<CatalogFormState>(defaultCatalogForm);
  const [catalogDownloadForm, setCatalogDownloadForm] = useState<CatalogDownloadDraft>(
    defaultCatalogDownloadForm
  );
  const [connectionForm, setConnectionForm] = useState<ConnectionDraft>(defaultConnectionForm);
  const [dialogMode, setDialogMode] = useState<ProjectDialogMode | null>(null);
  const [connectionDialogMode, setConnectionDialogMode] = useState<ConnectionDialogMode | null>(null);
  const [catalogDialogMode, setCatalogDialogMode] = useState<CatalogDialogMode | null>(null);
  const [dialogSelectedProjectCode, setDialogSelectedProjectCode] = useState("");
  const [selectedProjectCode, setSelectedProjectCode] = useState("");
  const [selectedConnectionName, setSelectedConnectionName] = useState<string | null>(null);
  const [selectedCatalogPath, setSelectedCatalogPath] = useState<string | null>(null);
  const [selectedExplorerSection, setSelectedExplorerSection] = useState<ExplorerSection>("project");
  const [expandedProjectCodes, setExpandedProjectCodes] = useState<string[]>([]);
  const [expandedProjectFolders, setExpandedProjectFolders] = useState<
    Record<string, ExpandedFolderState>
  >({});
  const [pendingDeleteCode, setPendingDeleteCode] = useState<string | null>(null);
  const [pendingDeleteConnection, setPendingDeleteConnection] = useState<{
    projectCode: string;
    connectionName: string;
  } | null>(null);
  const [pendingDeleteCatalog, setPendingDeleteCatalog] = useState<{
    projectCode: string;
    catalogPath: string;
  } | null>(null);
  const [isExplorerActionMenuOpen, setIsExplorerActionMenuOpen] = useState(false);
  const [isEditorFocusVisible, setIsEditorFocusVisible] = useState(true);
  const [catalogDialogErrorMessage, setCatalogDialogErrorMessage] = useState("");
  const [isCatalogDownloadDialogOpen, setIsCatalogDownloadDialogOpen] = useState(false);
  const [catalogDownloadMode, setCatalogDownloadMode] = useState<CatalogDownloadMode>("metadata");
  const [statusMessage, setStatusMessage] = useState(
    "Use Explorer actions to add a project, open a saved one, or manage the list."
  );
  const [metadataPreview, setMetadataPreview] = useState<MetadataPreviewState | null>(null);
  const [isMetadataPreviewOpen, setIsMetadataPreviewOpen] = useState(false);
  const [activeMetadataTab, setActiveMetadataTab] = useState<MetadataPreviewTab>("metadata");
  const [dialogErrorMessage, setDialogErrorMessage] = useState("");
  const [catalogDownloadErrorMessage, setCatalogDownloadErrorMessage] = useState("");
  const [, setCatalogDownloadStatusMessage] = useState(
    "Choose a connection and download metadata for the selected catalog path."
  );
  const [connectionBanner, setConnectionBanner] = useState<BannerState>({
    tone: "info",
    message: "Create a project first, then define connections inside it."
  });
  const [isBusy, setIsBusy] = useState(false);
  const [isCatalogSaving, setIsCatalogSaving] = useState(false);
  const [isCatalogDownloading, setIsCatalogDownloading] = useState(false);
  const [isCatalogDeleting, setIsCatalogDeleting] = useState(false);
  const [openingMetadataEntryId, setOpeningMetadataEntryId] = useState<string | null>(null);
  const [deletingMetadataEntryId, setDeletingMetadataEntryId] = useState<string | null>(null);
  const [isMetadataJsonDownloading, setIsMetadataJsonDownloading] = useState(false);
  const [isConnectionSaving, setIsConnectionSaving] = useState(false);
  const [isConnectionDeleting, setIsConnectionDeleting] = useState(false);

  const activeProject =
    projectState.projects.find((project) => project.code === projectState.activeProjectCode) ?? null;
  const selectedProject =
    projectState.projects.find((project) => project.code === selectedProjectCode) ??
    activeProject ??
    projectState.projects[0] ??
    null;
  const selectedConnection =
    selectedProject && selectedConnectionName
      ? selectedProject.connections.find((connection) => connection.name === selectedConnectionName) ?? null
      : null;
  const selectedCatalog =
    selectedProject && selectedCatalogPath
      ? selectedProject.catalogs.find((catalog) => catalog.path === selectedCatalogPath) ?? null
      : null;
  const selectedProjectCatalogCount = selectedProject ? getProjectCatalogCount(selectedProject) : 0;
  const isCatalogsView = selectedExplorerSection === "catalogs";
  const isCatalogSelected = selectedExplorerSection === "catalog";
  const isCatalogsWorkspace = isCatalogsView || isCatalogSelected;
  const isConnectionDialogOpen = connectionDialogMode !== null;
  const isCatalogDialogOpen = catalogDialogMode !== null;
  const pendingDeleteProject =
    projectState.projects.find((project) => project.code === pendingDeleteCode) ?? null;
  const pendingDeleteConnectionDetails =
    pendingDeleteConnection &&
    projectState.projects
      .find((project) => project.code === pendingDeleteConnection.projectCode)
      ?.connections.find((connection) => connection.name === pendingDeleteConnection.connectionName);
  const pendingDeleteCatalogDetails =
    pendingDeleteCatalog &&
    projectState.projects
      .find((project) => project.code === pendingDeleteCatalog.projectCode)
      ?.catalogs.find((catalog) => catalog.path === pendingDeleteCatalog.catalogPath);
  const metadataPreviewLines = metadataPreview ? metadataPreview.content.split("\n") : [];
  const isMetadataSectionVisible = Boolean(metadataPreview && isMetadataPreviewOpen);
  const selectedCatalogHistory = selectedCatalog?.metadataHistory ?? [];
  const metadataOverviewSections: MetadataOverviewSection[] = [];

  if (metadataPreview) {
    metadataOverviewSections.push(
      {
        id: "summary",
        title: "Summary",
        value: {
          project: metadataPreview.projectCode,
          connection: metadataPreview.connectionName,
          catalogPath: metadataPreview.catalogPath,
          generatedAt: metadataPreview.metadata.generatedAt,
          downloadedAt: metadataPreview.downloadedAt,
          metadataFile: metadataPreview.fileName
        }
      },
      {
        id: "payload",
        title: "Payload",
        value: metadataPreview.metadata.payload
      }
    );

    if (metadataPreview.metadata.extraction) {
      metadataOverviewSections.push({
        id: "extraction",
        title: "Extraction",
        value: metadataPreview.metadata.extraction
      });
    }

    if (metadataPreview.metadata.structure) {
      metadataOverviewSections.push({
        id: "structure",
        title: "Structure",
        value: metadataPreview.metadata.structure
      });
    }

    if (metadataPreview.metadata.dataModel) {
      metadataOverviewSections.push({
        id: "data-model",
        title: "Data Model",
        value: metadataPreview.metadata.dataModel
      });
    }

    if (metadataPreview.metadata.sqlQueries) {
      metadataOverviewSections.push({
        id: "sql-queries",
        title: "SQL Queries",
        value: metadataPreview.metadata.sqlQueries
      });
    }

    if (metadataPreview.metadata.metadataProperties) {
      metadataOverviewSections.push({
        id: "metadata-properties",
        title: "Metadata Properties",
        value: metadataPreview.metadata.metadataProperties
      });
    }
  }

  useEffect(() => {
    let isCancelled = false;

    async function hydrateApp() {
      try {
        const nextProjectState = await window.electronAPI.getProjectState();
        const initialProjectCode =
          nextProjectState.activeProjectCode ?? nextProjectState.projects[0]?.code ?? "";

        if (isCancelled) {
          return;
        }

        setProjectState(nextProjectState);
        setSelectedProjectCode(initialProjectCode);
        setExpandedProjectCodes(initialProjectCode ? [initialProjectCode] : []);
        setExpandedProjectFolders(
          initialProjectCode
            ? {
                [initialProjectCode]: {
                  connections: true,
                  catalogs: true
                }
              }
            : {}
        );
      } catch (error) {
        if (!isCancelled) {
          setStatusMessage(
            "The preload bridge is unavailable. Check the Electron console for details."
          );
        }

        console.error(error);
      }
    }

    hydrateApp();

    return () => {
      isCancelled = true;
    };
  }, []);

  async function refreshProjectState() {
    const nextProjectState = await window.electronAPI.getProjectState();
    setProjectState(nextProjectState);
    return nextProjectState;
  }

  function closeMetadataPreview() {
    setIsMetadataPreviewOpen(false);
  }

  function openMetadataPreview(preview: MetadataPreviewState, tab: MetadataPreviewTab = "overview") {
    setMetadataPreview(preview);
    setActiveMetadataTab(tab);
    setIsMetadataPreviewOpen(true);
  }

  async function openCachedCatalogMetadata(
    projectCode: string,
    catalogPath: string,
    historyEntryId?: string | null
  ) {
    setOpeningMetadataEntryId(historyEntryId ?? "__latest__");

    try {
      const cachedMetadata = await window.electronAPI.getCachedCatalogMetadata(
        projectCode,
        catalogPath,
        historyEntryId ?? null
      );
      const parsedMetadata = JSON.parse(cachedMetadata.content) as BipDownloadMetadata;

      openMetadataPreview(
        createMetadataPreviewState({
          fileName: cachedMetadata.fileName,
          catalogPath: cachedMetadata.catalogPath,
          connectionName: cachedMetadata.connectionName,
          projectCode: cachedMetadata.projectCode,
          metadata: parsedMetadata,
          content: cachedMetadata.content,
          downloadedAt: cachedMetadata.downloadedAt
        })
      );
      setStatusMessage(`Opened cached metadata JSON for ${cachedMetadata.catalogPath}.`);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    } finally {
      setOpeningMetadataEntryId(null);
    }
  }

  function downloadMetadataPreviewJson() {
    if (!metadataPreview) {
      return;
    }

    setIsMetadataJsonDownloading(true);

    try {
      const blob = new Blob([metadataPreview.content], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = metadataPreview.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatusMessage(`Downloaded metadata JSON for ${metadataPreview.catalogPath}.`);
    } finally {
      setIsMetadataJsonDownloading(false);
    }
  }

  async function handleDeleteCatalogMetadataHistoryEntry(
    projectCode: string,
    catalogPath: string,
    historyEntryId: string
  ) {
    const deletedEntry =
      selectedCatalog?.metadataHistory.find((entry) => entry.id === historyEntryId) ?? null;

    setDeletingMetadataEntryId(historyEntryId);

    try {
      const nextProjectState = await window.electronAPI.deleteCatalogMetadataHistoryEntry(
        projectCode,
        catalogPath,
        historyEntryId
      );

      setProjectState(nextProjectState);

      if (
        deletedEntry &&
        metadataPreview &&
        metadataPreview.projectCode === projectCode &&
        metadataPreview.catalogPath === catalogPath &&
        metadataPreview.fileName === deletedEntry.fileName &&
        metadataPreview.downloadedAt === deletedEntry.completedAt
      ) {
        closeMetadataPreview();
      }

      setStatusMessage(`Deleted a metadata history entry for ${catalogPath}.`);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    } finally {
      setDeletingMetadataEntryId(null);
    }
  }

  useEffect(() => {
    const unsubscribe = window.electronAPI.onMenuAction((command) => {
      setDialogErrorMessage("");
      setPendingDeleteCode(null);
      setDialogMode(command);
      setStatusMessage(
        command === "add-project"
          ? "Create a new project entry."
          : command === "open-project"
            ? "Choose a saved project to make it current."
            : "Review the saved project list."
      );

      if (command === "add-project") {
        setProjectForm(defaultProjectForm);
      }

      if (command === "open-project") {
        setDialogSelectedProjectCode(
          selectedProject?.code ?? projectState.activeProjectCode ?? projectState.projects[0]?.code ?? ""
        );
      }
    });

    return () => {
      unsubscribe();
    };
  }, [projectState, selectedProject]);

  useEffect(() => {
    if (projectState.projects.length === 0) {
      if (selectedProjectCode) {
        setSelectedProjectCode("");
      }

      if (selectedConnectionName) {
        setSelectedConnectionName(null);
      }

      if (selectedCatalogPath) {
        setSelectedCatalogPath(null);
      }

      setSelectedExplorerSection("project");
      setExpandedProjectCodes([]);
      setExpandedProjectFolders({});
      setCatalogForm(defaultCatalogForm);
      setConnectionForm(defaultConnectionForm);
      setConnectionBanner({
        tone: "info",
        message: "Create a project first, then define connections inside it."
      });
      return;
    }

    if (selectedProjectCode && projectState.projects.some((project) => project.code === selectedProjectCode)) {
      return;
    }

    setSelectedProjectCode(projectState.activeProjectCode ?? projectState.projects[0]?.code ?? "");
  }, [projectState, selectedConnectionName, selectedProjectCode, selectedCatalogPath]);

  useEffect(() => {
    if (!selectedProjectCode) {
      return;
    }

    setExpandedProjectCodes((current) =>
      current.includes(selectedProjectCode) ? current : [...current, selectedProjectCode]
    );
  }, [selectedProjectCode]);

  useEffect(() => {
    setIsEditorFocusVisible(true);
  }, [selectedProjectCode, selectedConnectionName, selectedCatalogPath, selectedExplorerSection]);

  useEffect(() => {
    const knownProjectCodes = new Set(projectState.projects.map((project) => project.code));

    setExpandedProjectCodes((current) => current.filter((projectCode) => knownProjectCodes.has(projectCode)));
    setExpandedProjectFolders((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([projectCode]) => knownProjectCodes.has(projectCode))
      )
    );
  }, [projectState.projects]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    if (!selectedConnectionName) {
      return;
    }

    if (selectedProject.connections.some((connection) => connection.name === selectedConnectionName)) {
      return;
    }

    setSelectedConnectionName(null);
    setSelectedExplorerSection("connections");
    setConnectionForm(defaultConnectionForm);
    setConnectionBanner({
      tone: "info",
      message: `The selected connection is no longer available in ${selectedProject.name}. Choose another one or create a new one.`
    });
  }, [selectedConnectionName, selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    if (!selectedCatalogPath) {
      return;
    }

    if (selectedProject.catalogs.some((catalog) => catalog.path === selectedCatalogPath)) {
      return;
    }

    setSelectedCatalogPath(null);
    setCatalogForm(defaultCatalogForm);

    if (selectedExplorerSection === "catalog") {
      setSelectedExplorerSection("catalogs");
      setStatusMessage(
        `The selected catalog is no longer available in ${selectedProject.name}. Choose another one or add a new catalog path.`
      );
    }
  }, [selectedExplorerSection, selectedProject, selectedCatalogPath]);

  useEffect(() => {
    if (dialogMode !== "open-project") {
      return;
    }

    if (projectState.projects.some((project) => project.code === dialogSelectedProjectCode)) {
      return;
    }

    setDialogSelectedProjectCode(
      selectedProject?.code ?? projectState.activeProjectCode ?? projectState.projects[0]?.code ?? ""
    );
  }, [dialogMode, dialogSelectedProjectCode, projectState, selectedProject]);

  async function syncProjectState(nextStatusMessage?: string) {
    const nextProjectState = await window.electronAPI.getProjectState();
    setProjectState(nextProjectState);

    if (nextStatusMessage) {
      setStatusMessage(nextStatusMessage);
    }

    return nextProjectState;
  }

  function updateExpandedFolderState(
    projectCode: string,
    updates: Partial<ExpandedFolderState> | ((current: ExpandedFolderState) => ExpandedFolderState)
  ) {
    setExpandedProjectFolders((current) => {
      const nextCurrent = {
        ...getDefaultExpandedFolders(),
        ...(current[projectCode] ?? {})
      };
      const nextValue = typeof updates === "function" ? updates(nextCurrent) : { ...nextCurrent, ...updates };

      return {
        ...current,
        [projectCode]: nextValue
      };
    });
  }

  function ensureProjectExpanded(projectCode: string) {
    setExpandedProjectCodes((current) =>
      current.includes(projectCode) ? current : [...current, projectCode]
    );
  }

  function ensureFolderExpanded(projectCode: string, folderName: ExplorerFolderName) {
    ensureProjectExpanded(projectCode);
    updateExpandedFolderState(projectCode, {
      [folderName]: true
    });
  }

  function toggleProjectExpanded(projectCode: string) {
    setExpandedProjectCodes((current) =>
      current.includes(projectCode)
        ? current.filter((item) => item !== projectCode)
        : [...current, projectCode]
    );
  }

  function toggleFolderExpanded(projectCode: string, folderName: ExplorerFolderName) {
    ensureProjectExpanded(projectCode);
    updateExpandedFolderState(projectCode, (current) => ({
      ...current,
      [folderName]: !current[folderName]
    }));
  }

  function openDialog(mode: ProjectMenuAction) {
    setDialogErrorMessage("");
    setPendingDeleteCode(null);
    setDialogMode(mode);

    if (mode === "add-project") {
      setProjectForm(defaultProjectForm);
    }

    if (mode === "open-project") {
      setDialogSelectedProjectCode(
        selectedProject?.code ?? projectState.activeProjectCode ?? projectState.projects[0]?.code ?? ""
      );
    }
  }

  function closeConnectionDialog() {
    setConnectionDialogMode(null);

    if (selectedConnection) {
      setConnectionForm({
        name: selectedConnection.name,
        url: selectedConnection.url,
        username: selectedConnection.username,
        password: selectedConnection.password,
        environmentType: selectedConnection.environmentType
      });
      return;
    }

    setConnectionForm(defaultConnectionForm);
  }

  function closeCatalogDialog() {
    if (isCatalogSaving) {
      return;
    }

    setCatalogDialogMode(null);
    setCatalogDialogErrorMessage("");
    setCatalogForm(defaultCatalogForm);
  }

  function openProjectEditDialog(projectCode?: string) {
    const code = projectCode ?? selectedProject?.code ?? "";
    const project = projectState.projects.find((item) => item.code === code) ?? null;

    if (!project) {
      return;
    }

    setDialogErrorMessage("");
    setPendingDeleteCode(null);
    setProjectForm({
      code: project.code,
      name: project.name,
      description: project.description
    });
    setDialogMode("edit-project");
  }

  function closeDialog() {
    setDialogMode(null);
    setDialogErrorMessage("");
    setIsBusy(false);
  }

  function openCatalogDownloadDialog(
    catalogPath?: string,
    mode: CatalogDownloadMode = "metadata"
  ) {
    if (!selectedProject) {
      return;
    }

    const nextCatalogPath = String(catalogPath ?? selectedCatalog?.path ?? "").trim();

    if (!nextCatalogPath) {
      return;
    }

    const initialConnectionName =
      selectedConnection &&
      selectedProject.connections.some((connection) => connection.name === selectedConnection.name)
        ? selectedConnection.name
        : selectedProject.connections[0]?.name ?? "";

    setCatalogDownloadForm({
      connectionName: initialConnectionName,
      catalogPath: nextCatalogPath
    });
    setCatalogDownloadMode(mode);
    setCatalogDownloadErrorMessage("");
    setCatalogDownloadStatusMessage(
      selectedProject.connections.length > 0
        ? `${
            mode === "catalog" ? "Download the catalog" : "Download metadata"
          } for ${getCatalogDisplayName(nextCatalogPath)} from ${selectedProject.name}.`
        : `Add a saved connection in ${selectedProject.name} before downloading ${
            mode === "catalog" ? "the catalog" : "catalog metadata"
          }.`
    );
    setIsCatalogDownloadDialogOpen(true);
  }

  function closeCatalogDownloadDialog() {
    if (isCatalogDownloading) {
      return;
    }

    setIsCatalogDownloadDialogOpen(false);
    setCatalogDownloadMode("metadata");
    setCatalogDownloadForm(defaultCatalogDownloadForm);
    setCatalogDownloadErrorMessage("");
    setCatalogDownloadStatusMessage(
      "Choose a connection and download metadata for the selected catalog path."
    );
  }

  function requestDeleteProject(projectCode: string) {
    setDialogErrorMessage("");
    setPendingDeleteCode(projectCode);
  }

  function closeDeleteDialog() {
    setPendingDeleteCode(null);
  }

  function focusProject(projectCode: string) {
    const project = projectState.projects.find((item) => item.code === projectCode);

    setIsEditorFocusVisible(true);
    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(null);
    setSelectedCatalogPath(null);
    setSelectedExplorerSection("project");
    ensureProjectExpanded(projectCode);
    updateExpandedFolderState(projectCode, {
      connections: true,
      catalogs: true
    });
    setCatalogForm(defaultCatalogForm);
    setConnectionForm(defaultConnectionForm);
    setConnectionBanner({
      tone: "info",
      message: project
        ? `Browse connections in ${project.name}, or create a new one.`
        : "Select a project to browse its connections."
    });
  }

  function selectExplorerFolder(projectCode: string, folderName: ExplorerFolderName) {
    const project = projectState.projects.find((item) => item.code === projectCode);

    setIsEditorFocusVisible(true);
    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(null);
    setSelectedCatalogPath(null);
    setSelectedExplorerSection(folderName);
    ensureFolderExpanded(projectCode, folderName);
    setCatalogForm(defaultCatalogForm);
    setConnectionForm(defaultConnectionForm);
    setConnectionBanner({
      tone: "info",
      message:
        folderName === "connections"
          ? project
            ? `Browse or create connections inside ${project.name}.`
            : "Browse connections for the selected project."
          : project
            ? `Browse saved catalog paths inside ${project.name}, or add a new catalog path.`
            : "Browse catalogs for the selected project."
    });
  }

  function beginNewCatalog(projectCode: string) {
    const project = projectState.projects.find((item) => item.code === projectCode);

    setIsEditorFocusVisible(true);
    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(null);
    setSelectedCatalogPath(null);
    setSelectedExplorerSection("catalogs");
    ensureFolderExpanded(projectCode, "catalogs");
    setCatalogForm({
      ...defaultCatalogForm,
      connectionName: getInitialCatalogConnectionName(project ?? null)
    });
    setCatalogDialogErrorMessage("");
    setCatalogDialogMode("create");
    setStatusMessage(
      project
        ? project.connections.length > 0
          ? `Add a catalog path inside ${project.name}.`
          : `Add a connection inside ${project.name} before saving a catalog path.`
        : "Add a catalog path for the selected project."
    );
  }

  function beginNewConnection(projectCode: string) {
    const project = projectState.projects.find((item) => item.code === projectCode);

    setIsEditorFocusVisible(true);
    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(null);
    setSelectedCatalogPath(null);
    setSelectedExplorerSection("connections");
    ensureFolderExpanded(projectCode, "connections");
    setCatalogForm(defaultCatalogForm);
    setConnectionForm(defaultConnectionForm);
    setConnectionBanner({
      tone: "info",
      message: project
        ? `Create a new connection inside ${project.name}.`
        : "Create a new connection for the selected project."
    });
    setConnectionDialogMode("create");
  }

  function selectConnection(projectCode: string, connectionName: string) {
    const project = projectState.projects.find((item) => item.code === projectCode);
    const connection = project?.connections.find((item) => item.name === connectionName);

    if (!project || !connection) {
      return;
    }

    setIsEditorFocusVisible(true);
    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(connection.name);
    setSelectedCatalogPath(null);
    setSelectedExplorerSection("connection");
    ensureFolderExpanded(projectCode, "connections");
    setCatalogForm(defaultCatalogForm);
    setConnectionForm({
      name: connection.name,
      url: connection.url,
      username: connection.username,
      password: connection.password,
      environmentType: connection.environmentType
    });
    setConnectionBanner({
      tone: "info",
      message: `Selected ${connection.name} in ${project.name}.`,
      detail: `Last updated ${formatTimestamp(connection.updatedAt)}`
    });
  }

  function selectCatalog(projectCode: string, catalogPath: string) {
    const project = projectState.projects.find((item) => item.code === projectCode);
    const catalog = project?.catalogs.find((item) => item.path === catalogPath);

    if (!project || !catalog) {
      return;
    }

    setIsEditorFocusVisible(true);
    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(null);
    setSelectedCatalogPath(catalog.path);
    setSelectedExplorerSection("catalog");
    ensureFolderExpanded(projectCode, "catalogs");
    setCatalogForm(defaultCatalogForm);
    setStatusMessage(`Selected ${getCatalogDisplayName(catalog.path)} in ${project.name}.`);
  }

  function beginEditConnection(projectCode: string, connectionName: string) {
    const project = projectState.projects.find((item) => item.code === projectCode);
    const connection = project?.connections.find((item) => item.name === connectionName);

    if (!project || !connection) {
      return;
    }

    selectConnection(projectCode, connectionName);
    setConnectionBanner({
      tone: "info",
      message: `Update ${connection.name} in ${project.name}.`,
      detail: `Last updated ${formatTimestamp(connection.updatedAt)}`
    });
    setConnectionDialogMode("edit");
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setDialogErrorMessage("");

    try {
      const nextProjectState = await window.electronAPI.createProject(projectForm);
      const nextProjectCode = projectForm.code.trim();

      setProjectState(nextProjectState);
      setSelectedProjectCode(nextProjectCode);
      setSelectedConnectionName(null);
      setSelectedCatalogPath(null);
      setSelectedExplorerSection("project");
      setCatalogForm(defaultCatalogForm);
      setConnectionForm(defaultConnectionForm);
      setConnectionBanner({
        tone: "info",
        message: `Project ${nextProjectCode} is ready. Add the first connection when you are ready.`
      });
      setProjectForm(defaultProjectForm);
      setDialogMode(null);
      setStatusMessage(`Project ${nextProjectCode} was created and opened.`);
    } catch (error) {
      setDialogErrorMessage(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUpdateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const projectCode = projectForm.code.trim();

    if (!projectCode) {
      setDialogErrorMessage("Choose a project before editing it.");
      return;
    }

    setIsBusy(true);
    setDialogErrorMessage("");

    try {
      const nextProjectState = await window.electronAPI.updateProject(projectCode, projectForm);
      const nextProject = nextProjectState.projects.find((project) => project.code === projectCode) ?? null;

      setProjectState(nextProjectState);
      setSelectedProjectCode(projectCode);
      setDialogMode(null);
      setStatusMessage(
        nextProject
          ? `Project ${nextProject.code} was updated.`
          : `Project ${projectCode} was updated.`
      );

      if (selectedProjectCode === projectCode && selectedExplorerSection === "project") {
        setConnectionBanner({
          tone: "info",
          message: nextProject
            ? `${nextProject.name} is updated. Browse connections or save catalog paths from the Catalogs folder.`
            : `Project ${projectCode} is updated.`
        });
      }
    } catch (error) {
      setDialogErrorMessage(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleOpenProject(projectCode?: string) {
    const code = projectCode ?? dialogSelectedProjectCode;

    if (!code) {
      setDialogErrorMessage("Choose a project to open.");
      return;
    }

    setIsBusy(true);
    setDialogErrorMessage("");

    try {
      const nextProjectState = await window.electronAPI.openProject(code);
      const openedProject = nextProjectState.projects.find((project) => project.code === code) ?? null;

      setProjectState(nextProjectState);
      setSelectedProjectCode(code);
      setSelectedConnectionName(null);
      setSelectedCatalogPath(null);
      setSelectedExplorerSection("project");
      setCatalogForm(defaultCatalogForm);
      setConnectionForm(defaultConnectionForm);
      setConnectionBanner({
        tone: "info",
        message: openedProject
          ? `${openedProject.name} is now current. Add a new connection or choose one from the tree.`
          : `Project ${code} is now current.`
      });
      setDialogMode(null);
      setPendingDeleteCode(null);
      setStatusMessage(`Project ${code} is now current.`);
    } catch (error) {
      setDialogErrorMessage(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmDeleteProject() {
    if (!pendingDeleteProject) {
      return;
    }

    setIsBusy(true);
    setDialogErrorMessage("");

    try {
      const deletedProjectCode = pendingDeleteProject.code;
      const nextProjectState = await window.electronAPI.deleteProject(deletedProjectCode);
      const nextSelectedProjectCode =
        selectedProjectCode === deletedProjectCode
          ? nextProjectState.activeProjectCode ?? nextProjectState.projects[0]?.code ?? ""
          : selectedProjectCode;

      setProjectState(nextProjectState);
      setSelectedProjectCode(nextSelectedProjectCode);
      setPendingDeleteCode(null);

      if (selectedProjectCode === deletedProjectCode) {
        setSelectedConnectionName(null);
        setSelectedCatalogPath(null);
        setSelectedExplorerSection("project");
        setCatalogForm(defaultCatalogForm);
        setConnectionForm(defaultConnectionForm);
        setConnectionBanner({
          tone: "info",
          message: nextSelectedProjectCode
            ? `Project ${deletedProjectCode} was removed. Select a connection or create a new one in the remaining project list.`
            : "Project list is empty now. Add a project to continue."
        });
      }

      if (dialogMode === "open-project") {
        setDialogSelectedProjectCode(nextProjectState.activeProjectCode ?? nextProjectState.projects[0]?.code ?? "");
      }

      setStatusMessage(`Project ${deletedProjectCode} was deleted.`);
    } catch (error) {
      setDialogErrorMessage(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRefresh() {
    setDialogErrorMessage("");

    try {
      await syncProjectState("Project list refreshed.");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function handleSaveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProject) {
      setConnectionBanner({
        tone: "error",
        message: "Choose a project before saving a connection."
      });
      return;
    }

    if (connectionForm.url.trim() && !matchesConnectionUrlPattern(connectionForm.url)) {
      setConnectionBanner({
        tone: "error",
        message: `URL must match the pattern ${connectionUrlPattern}.`
      });
      return;
    }

    setIsConnectionSaving(true);

    try {
      const nextProjectState = await window.electronAPI.saveConnection(
        selectedProject.code,
        connectionForm,
        selectedConnectionName
      );
      const savedName = connectionForm.name.trim();
      const savedProject = nextProjectState.projects.find((project) => project.code === selectedProject.code) ?? null;
      const savedConnection = savedProject?.connections.find((connection) => connection.name === savedName) ?? null;

      setProjectState(nextProjectState);
      setSelectedProjectCode(selectedProject.code);
      setSelectedConnectionName(savedName);
      setSelectedCatalogPath(null);
      setSelectedExplorerSection("connection");
      ensureFolderExpanded(selectedProject.code, "connections");
      setCatalogForm(defaultCatalogForm);
      setConnectionForm({
        name: savedName,
        url: savedConnection?.url ?? connectionForm.url.trim(),
        username: savedConnection?.username ?? connectionForm.username.trim(),
        password: savedConnection?.password ?? connectionForm.password,
        environmentType: savedConnection?.environmentType ?? connectionForm.environmentType
      });
      setConnectionBanner({
        tone: "success",
        message: `Connection ${savedName} was saved in ${selectedProject.name}.`,
        detail: savedConnection ? `Updated ${formatTimestamp(savedConnection.updatedAt)}` : undefined
      });
      setStatusMessage(`Connection ${savedName} was saved in project ${selectedProject.code}.`);
      setConnectionDialogMode(null);
    } catch (error) {
      setConnectionBanner({
        tone: "error",
        message: getErrorMessage(error)
      });
    } finally {
      setIsConnectionSaving(false);
    }
  }

  function requestDeleteConnection(projectCode: string, connectionName: string) {
    setPendingDeleteConnection({ projectCode, connectionName });
  }

  function closeDeleteConnectionDialog() {
    setPendingDeleteConnection(null);
  }

  async function confirmDeleteConnection() {
    if (!pendingDeleteConnection) {
      return;
    }

    setIsConnectionDeleting(true);

    try {
      const { projectCode, connectionName } = pendingDeleteConnection;
      const nextProjectState = await window.electronAPI.deleteConnection(projectCode, connectionName);
      const project = nextProjectState.projects.find((item) => item.code === projectCode) ?? null;

      setProjectState(nextProjectState);
      setPendingDeleteConnection(null);

      if (selectedProjectCode === projectCode && selectedConnectionName === connectionName) {
        setSelectedConnectionName(null);
        setSelectedCatalogPath(null);
        setSelectedExplorerSection("connections");
        ensureFolderExpanded(projectCode, "connections");
        setCatalogForm(defaultCatalogForm);
        setConnectionForm(defaultConnectionForm);
        setConnectionBanner({
          tone: "info",
            message: project
            ? `${connectionName} was removed from ${project.name}. Add another connection or choose one from the tree.`
            : "The selected connection was removed."
        });
      }

      setStatusMessage(`Connection ${connectionName} was deleted from project ${projectCode}.`);
    } catch (error) {
      setConnectionBanner({
        tone: "error",
        message: getErrorMessage(error)
      });
    } finally {
      setIsConnectionDeleting(false);
    }
  }

  function requestDeleteCatalog(projectCode: string, catalogPath: string) {
    setPendingDeleteCatalog({ projectCode, catalogPath });
  }

  function closeDeleteCatalogDialog() {
    setPendingDeleteCatalog(null);
  }

  async function confirmDeleteCatalog() {
    if (!pendingDeleteCatalog) {
      return;
    }

    setIsCatalogDeleting(true);

    try {
      const { projectCode, catalogPath } = pendingDeleteCatalog;
      const nextProjectState = await window.electronAPI.deleteCatalog(projectCode, catalogPath);
      const project = nextProjectState.projects.find((item) => item.code === projectCode) ?? null;

      setProjectState(nextProjectState);
      setPendingDeleteCatalog(null);

      if (selectedProjectCode === projectCode && selectedCatalogPath === catalogPath) {
        setSelectedCatalogPath(null);
        setSelectedExplorerSection("catalogs");
        ensureFolderExpanded(projectCode, "catalogs");
        setCatalogForm(defaultCatalogForm);
        setCatalogDownloadForm(defaultCatalogDownloadForm);
        setCatalogDownloadErrorMessage("");
        setCatalogDownloadStatusMessage(
          "Choose a connection and download metadata for the selected catalog path."
        );
        setIsCatalogDownloadDialogOpen(false);
      }

      setStatusMessage(
        project
          ? `Catalog path ${catalogPath} was deleted from ${project.name}.`
          : `Catalog path ${catalogPath} was deleted from project ${projectCode}.`
      );
    } catch (error) {
      setCatalogDialogErrorMessage(getErrorMessage(error));
      setStatusMessage(getErrorMessage(error));
    } finally {
      setIsCatalogDeleting(false);
    }
  }

  async function handleSaveCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProject) {
      setCatalogDialogErrorMessage("Choose a project before saving a catalog path.");
      return;
    }

    if (!catalogForm.connectionName) {
      setCatalogDialogErrorMessage("Choose a saved connection before saving a catalog path.");
      return;
    }

    setIsCatalogSaving(true);
    setCatalogDialogErrorMessage("");

    try {
      await window.electronAPI.validateCatalogPath(
        selectedProject.code,
        catalogForm.connectionName,
        catalogForm.path.trim()
      );
      const nextProjectState = await window.electronAPI.saveCatalog(selectedProject.code, catalogForm);
      const savedPath = catalogForm.path.trim();
      const savedProject =
        nextProjectState.projects.find((project) => project.code === selectedProject.code) ?? null;
      const savedCatalog = savedProject?.catalogs.find((catalog) => catalog.path === savedPath) ?? null;

      setProjectState(nextProjectState);
      setSelectedProjectCode(selectedProject.code);
      setSelectedConnectionName(null);
      setSelectedCatalogPath(savedPath);
      setSelectedExplorerSection("catalog");
      ensureFolderExpanded(selectedProject.code, "catalogs");
      setCatalogForm(defaultCatalogForm);
      setCatalogDialogMode(null);
      setStatusMessage(`Catalog path ${savedPath} was saved in project ${selectedProject.code}.`);

      if (savedCatalog) {
        setCatalogDownloadStatusMessage(
          `Download metadata for ${getCatalogDisplayName(savedCatalog.path)} when you are ready.`
        );
      }
    } catch (error) {
      setCatalogDialogErrorMessage(getErrorMessage(error));
    } finally {
      setIsCatalogSaving(false);
    }
  }

  async function handleDownloadCatalogMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isCatalogFileDownload = catalogDownloadMode === "catalog";
    const actionLabel = isCatalogFileDownload ? "catalog" : "metadata";

    if (!selectedProject) {
      setCatalogDownloadErrorMessage(`Choose a project before downloading ${actionLabel}.`);
      return;
    }

    if (!catalogDownloadForm.connectionName) {
      setCatalogDownloadErrorMessage("Choose a saved connection first.");
      return;
    }

    if (!catalogDownloadForm.catalogPath.trim()) {
      setCatalogDownloadErrorMessage("Enter the absolute catalog path.");
      return;
    }

    setIsCatalogDownloading(true);
    setCatalogDownloadErrorMessage("");
    setCatalogDownloadStatusMessage("Validating the catalog path...");

    try {
      await window.electronAPI.validateCatalogPath(
        selectedProject.code,
        catalogDownloadForm.connectionName,
        catalogDownloadForm.catalogPath.trim()
      );
      if (isCatalogFileDownload) {
        const result = await window.electronAPI.downloadCatalogToFile(
          selectedProject.code,
          catalogDownloadForm.connectionName,
          catalogDownloadForm.catalogPath.trim()
        );

        if (result.canceled) {
          setStatusMessage(`Catalog download for ${catalogDownloadForm.catalogPath.trim()} was canceled.`);
        } else {
          setStatusMessage(`Catalog downloaded to ${result.filePath}.`);
          setIsCatalogDownloadDialogOpen(false);
          setCatalogDownloadForm(defaultCatalogDownloadForm);
          setCatalogDownloadMode("metadata");
        }
      } else {
        setCatalogDownloadStatusMessage("Downloading the catalog and generating metadata JSON...");
        const result = await window.electronAPI.downloadBipObject(
          selectedProject.code,
          catalogDownloadForm.connectionName,
          catalogDownloadForm.catalogPath.trim()
        );
        openMetadataPreview(
          createMetadataPreviewState({
            fileName: result.metadataFileName,
            catalogPath: result.catalogPath,
            connectionName: catalogDownloadForm.connectionName,
            projectCode: selectedProject.code,
            metadata: result.metadata,
            downloadedAt: result.metadata.generatedAt
          })
        );
        await refreshProjectState();
        setStatusMessage(`Metadata JSON for ${result.catalogPath} is ready.`);
        setCatalogDownloadStatusMessage(
          "Catalog downloaded and metadata JSON is ready in the preview panel."
        );
        setIsCatalogDownloadDialogOpen(false);
        setCatalogDownloadForm(defaultCatalogDownloadForm);
      }
    } catch (error) {
      try {
        await refreshProjectState();
      } catch (_refreshError) {
        // Preserve the original error state if the refresh fails after a download attempt.
      }
      setCatalogDownloadErrorMessage(getErrorMessage(error));
      setCatalogDownloadStatusMessage("Metadata download failed.");
    } finally {
      setIsCatalogDownloading(false);
    }
  }

  function openComparePage() {
    window.location.href = "/compare";
  }

  function openDownloadCatalogTool() {
    if (!selectedProject || !selectedCatalog) {
      setStatusMessage("Select a catalog item before downloading a catalog.");
      return;
    }

    openCatalogDownloadDialog(selectedCatalog.path, "catalog");
  }

  const explorerMenuActions: ActionButtonConfig[] = [
    {
      label: "Add Project",
      tone: "primary",
      icon: "add",
      onClick: () => openDialog("add-project")
    },
    {
      label: "Open Projects",
      tone: "secondary",
      icon: "open",
      onClick: () => openDialog("open-project")
    },
    {
      label: "Manage Projects",
      tone: "ghost",
      icon: "manage",
      onClick: () => openDialog("manage-projects")
    },
    {
      label: "Refresh",
      tone: "ghost",
      icon: "refresh",
      onClick: handleRefresh
    }
  ];

  function handleExplorerMenuAction(action: () => void | Promise<void>) {
    setIsExplorerActionMenuOpen(false);
    void action();
  }

  function closeEditorFocus() {
    setIsEditorFocusVisible(false);
  }

  const editorFocusActions: ActionButtonConfig[] = (() => {
    if (!selectedProject) {
      return [
        {
          label: "Add Project",
          tone: "primary",
          icon: "add",
          onClick: () => openDialog("add-project")
        },
        {
          label: "Open Projects",
          tone: "secondary",
          icon: "open",
          onClick: () => openDialog("open-project"),
          disabled: projectState.projects.length === 0
        }
      ];
    }

    if (selectedCatalog) {
      return [
        {
          label: isCatalogDownloading ? "Downloading..." : "Download Metadata",
          tone: "primary",
          icon: "catalog",
          onClick: () => openCatalogDownloadDialog(selectedCatalog.path),
          disabled: selectedProject.connections.length === 0 || isCatalogDownloading
        },
        {
          label: isCatalogDeleting ? "Deleting..." : "Delete Catalog",
          tone: "danger",
          icon: "catalog",
          onClick: () => requestDeleteCatalog(selectedProject.code, selectedCatalog.path),
          disabled: isCatalogDownloading || isCatalogDeleting
        }
      ];
    }

    if (selectedConnection) {
      return [
        {
          label: "Edit Connection",
          tone: "primary",
          icon: "connection",
          onClick: () => beginEditConnection(selectedProject.code, selectedConnection.name),
          disabled: isConnectionDeleting
        },
        {
          label: isConnectionDeleting ? "Deleting..." : "Delete Connection",
          tone: "danger",
          icon: "connection",
          onClick: () => requestDeleteConnection(selectedProject.code, selectedConnection.name),
          disabled: isConnectionDeleting
        }
      ];
    }

    if (isCatalogsView) {
      return [
        {
          label: "Add Catalog Path",
          tone: "primary",
          icon: "catalog",
          onClick: () => beginNewCatalog(selectedProject.code)
        }
      ];
    }

    if (selectedExplorerSection === "connections") {
      return [
        {
          label: "Add Connection",
          tone: "primary",
          icon: "connection",
          onClick: () => beginNewConnection(selectedProject.code)
        }
      ];
    }

    return [
      {
        label: "Edit Project",
        tone: "primary",
        icon: "projects",
        onClick: () => openProjectEditDialog(selectedProject.code),
        disabled: isBusy
      },
      {
        label: isBusy ? "Deleting..." : "Delete Project",
        tone: "danger",
        icon: "projects",
        onClick: () => requestDeleteProject(selectedProject.code),
        disabled: isBusy
      }
    ];
  })();

  const editorFocusMetrics: MetricItem[] = (() => {
    if (!selectedProject) {
      return [
        { label: "Project", value: "Not selected" },
        { label: "Saved connections", value: 0 },
        { label: "Catalogs", value: 0 }
      ];
    }

    const metrics: MetricItem[] = [{ label: "Project", value: selectedProject.code }];
    const shouldShowSavedCounts =
      selectedExplorerSection !== "connection" && selectedExplorerSection !== "catalog";

    if (shouldShowSavedCounts) {
      metrics.push({ label: "Saved connections", value: selectedProject.connections.length });
      metrics.push({ label: "Catalogs", value: selectedProjectCatalogCount });
    }

    if (selectedCatalog) {
      metrics.push({
        label: "Catalog",
        value: getCatalogDisplayName(selectedCatalog.path)
      });
      metrics.push({
        label: "Catalog path",
        value: selectedCatalog.path
      });
      metrics.push({
        label: "Last updated",
        value: formatTimestamp(selectedCatalog.updatedAt)
      });
    }

    if (selectedConnection && !isCatalogsWorkspace) {
      metrics.push({
        label: "Connection",
        value: selectedConnection.name
      });
      metrics.push({
        label: "Environment",
        value: selectedConnection.environmentType
      });
      metrics.push({
        label: "Username",
        value: selectedConnection.username
      });
      metrics.push({
        label: "Last updated",
        value: formatTimestamp(selectedConnection.updatedAt)
      });
    }

    return metrics;
  })();
  const catalogDownloadDialogTitle =
    catalogDownloadMode === "catalog" ? "Download Catalog" : "Download Metadata";
  const catalogDownloadButtonLabel =
    catalogDownloadMode === "catalog" ? "Download Catalog" : "Download Metadata";

  return (
    <main className="workspace-shell">
      <aside className="surface nav-panel">
        <div className="nav-stack">
          <div className="explorer-header">
            <div className="explorer-title-row">
              <h2 className="panel-heading">Explorer</h2>
            </div>

            <div className={`action-menu${isExplorerActionMenuOpen ? " is-open" : ""}`}>
              <button
                aria-expanded={isExplorerActionMenuOpen}
                aria-haspopup="menu"
                className="ghost-button compact-button action-menu-trigger"
                onClick={() => setIsExplorerActionMenuOpen((current) => !current)}
                type="button"
              >
                Actions
              </button>

              {isExplorerActionMenuOpen ? (
                <div className="action-menu-panel" role="menu">
                  {explorerMenuActions.map((action) => (
                    <button
                      className={`${getActionButtonClassName(action.tone)} compact-button action-menu-item`}
                      disabled={action.disabled}
                      key={action.label}
                      onClick={() => handleExplorerMenuAction(action.onClick)}
                      role="menuitem"
                      type="button"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel-body-shell explorer-panel-shell">
            <section className="tree-panel">
              {projectState.projects.length === 0 ? (
                <div className="empty-state tree-empty-state">
                  <div className="empty-copy">
                    <span className="icon-badge subtle-icon-badge">
                      <AppIcon kind="empty" />
                    </span>
                    <div>
                      <h4>No projects have been added yet</h4>
                      <p>Start with a project so the folder tree has something to show.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="tree-list" role="tree" aria-label="Project explorer">
                  {projectState.projects.map((project) => {
                    const isSelectedProject =
                      selectedProject?.code === project.code && selectedExplorerSection === "project";
                    const isConnectionsFolderSelected =
                      selectedProject?.code === project.code && selectedExplorerSection === "connections";
                    const isCatalogsFolderSelected =
                      selectedProject?.code === project.code && selectedExplorerSection === "catalogs";
                    const isCurrentProject = activeProject?.code === project.code;
                    const isProjectExpanded = expandedProjectCodes.includes(project.code);
                    const folderState = expandedProjectFolders[project.code] ?? getDefaultExpandedFolders();
                    const isConnectionsExpanded = folderState.connections;
                    const isCatalogsExpanded = folderState.catalogs;

                    return (
                      <div className="tree-group" key={project.code}>
                        <div className="explorer-row explorer-project-row">
                          <button
                            aria-label={`${isProjectExpanded ? "Collapse" : "Expand"} ${project.name}`}
                            className={`tree-toggle-button${isProjectExpanded ? " is-expanded" : ""}`}
                            onClick={() => toggleProjectExpanded(project.code)}
                            type="button"
                          >
                            <span className="tree-toggle-chevron" />
                          </button>

                          <button
                            className={`tree-node project-node${isSelectedProject ? " is-selected" : ""}${
                              isCurrentProject ? " is-current" : ""
                            }`}
                            onClick={() => focusProject(project.code)}
                            type="button"
                          >
                            <span className="tree-node-leading">
                              <AppIcon className="tree-node-icon" kind="projects" />
                            </span>

                            <span className="tree-node-copy">
                              <span className="tree-node-title">{project.name}</span>
                            </span>
                          </button>
                        </div>

                        {isProjectExpanded ? (
                          <div className="tree-children explorer-children">
                            <div className="explorer-row explorer-folder-row">
                              <button
                                aria-label={`${
                                  isConnectionsExpanded ? "Collapse" : "Expand"
                                } Connections in ${project.name}`}
                                className={`tree-toggle-button${isConnectionsExpanded ? " is-expanded" : ""}`}
                                onClick={() => toggleFolderExpanded(project.code, "connections")}
                                type="button"
                              >
                                <span className="tree-toggle-chevron" />
                              </button>

                              <button
                                className={`tree-node folder-node${
                                  isConnectionsFolderSelected ? " is-selected" : ""
                                }`}
                                onClick={() => selectExplorerFolder(project.code, "connections")}
                                type="button"
                              >
                                <span className="tree-node-leading">
                                  <AppIcon className="tree-node-icon" kind="connections" />
                                </span>

                                <span className="tree-node-copy">
                                  <span className="tree-node-title">Connections</span>
                                </span>
                              </button>
                            </div>

                            {isConnectionsExpanded ? (
                              <div className="tree-children folder-children">
                                {project.connections.length === 0 ? (
                                  <p className="tree-empty-copy">No connections saved yet.</p>
                                ) : (
                                  project.connections.map((connection) => {
                                    const isSelectedConnection =
                                      selectedProject?.code === project.code &&
                                      selectedExplorerSection === "connection" &&
                                      selectedConnection?.name === connection.name;

                                    return (
                                      <div className="explorer-row explorer-item-row" key={`${project.code}:${connection.name}`}>
                                        <span aria-hidden="true" className="tree-toggle-spacer" />
                                        <button
                                          className={`tree-node item-node${
                                            isSelectedConnection ? " is-selected" : ""
                                          }`}
                                          onClick={() => selectConnection(project.code, connection.name)}
                                          type="button"
                                        >
                                          <span className="tree-node-leading">
                                            <AppIcon className="tree-node-icon" kind="connection" />
                                          </span>

                                          <span className="tree-node-copy">
                                            <span className="tree-node-title">{connection.name}</span>
                                          </span>
                                        </button>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            ) : null}

                            <div className="explorer-row explorer-folder-row">
                              <button
                                aria-label={`${
                                  isCatalogsExpanded ? "Collapse" : "Expand"
                                } Catalogs in ${project.name}`}
                                className={`tree-toggle-button${isCatalogsExpanded ? " is-expanded" : ""}`}
                                onClick={() => toggleFolderExpanded(project.code, "catalogs")}
                                type="button"
                              >
                                <span className="tree-toggle-chevron" />
                              </button>

                              <button
                                className={`tree-node folder-node${
                                  isCatalogsFolderSelected ? " is-selected" : ""
                                }`}
                                onClick={() => selectExplorerFolder(project.code, "catalogs")}
                                type="button"
                              >
                                <span className="tree-node-leading">
                                  <AppIcon className="tree-node-icon" kind="catalogs" />
                                </span>

                                <span className="tree-node-copy">
                                  <span className="tree-node-title">Catalogs</span>
                                </span>
                              </button>
                            </div>

                            {isCatalogsExpanded ? (
                              <div className="tree-children folder-children">
                                {project.catalogs.length === 0 ? (
                                  <p className="tree-empty-copy">No catalogs saved yet.</p>
                                ) : (
                                  project.catalogs.map((catalog) => {
                                    const isSelectedCatalog =
                                      selectedProject?.code === project.code &&
                                      selectedExplorerSection === "catalog" &&
                                      selectedCatalog?.path === catalog.path;

                                    return (
                                      <div className="explorer-row explorer-item-row" key={`${project.code}:${catalog.path}`}>
                                        <span aria-hidden="true" className="tree-toggle-spacer" />
                                        <button
                                          className={`tree-node item-node${
                                            isSelectedCatalog ? " is-selected" : ""
                                          }`}
                                          onClick={() => selectCatalog(project.code, catalog.path)}
                                          type="button"
                                        >
                                          <span className="tree-node-leading">
                                            <AppIcon className="tree-node-icon" kind="catalog" />
                                          </span>

                                          <span className="tree-node-copy">
                                            <span className="tree-node-title">{getCatalogDisplayName(catalog.path)}</span>
                                          </span>
                                        </button>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <section aria-label="Explorer tools" className="explorer-tools-panel">
              <p className="section-label">Tools</p>
              <button className="explorer-tool-card" onClick={openComparePage} type="button">
                <span className="explorer-tool-heading">
                  <span className="explorer-tool-title">Compare Catalogs</span>
                </span>
                <span className="explorer-tool-description">Upload and compare two Catalogs.</span>
              </button>
              <button
                className="explorer-tool-card"
                disabled={!selectedCatalog}
                onClick={openDownloadCatalogTool}
                type="button"
              >
                <span className="explorer-tool-heading">
                  <span className="explorer-tool-title">Download catalog</span>
                </span>
                <span className="explorer-tool-description">
                  Save the selected catalog payload to a local file.
                </span>
              </button>
            </section>
          </div>
        </div>
      </aside>

      <section className="workspace-main">
        <section
          className={`hero-grid workspace-hero-grid${isMetadataSectionVisible ? "" : " metadata-preview-hidden"}${
            isEditorFocusVisible ? "" : " editor-focus-hidden"
          }`}
        >
          {isMetadataSectionVisible && metadataPreview ? (
            <article className="surface masthead-card workspace-summary-card metadata-preview-card">
              <div className="metadata-preview-actions">
                <button
                  className="primary-button compact-button"
                  disabled={isMetadataJsonDownloading}
                  onClick={downloadMetadataPreviewJson}
                  type="button"
                >
                  {isMetadataJsonDownloading ? "Downloading..." : "Download"}
                </button>
                <IconOnlyButton
                  kind="close-square"
                  label="Close metadata preview"
                  onClick={closeMetadataPreview}
                />
              </div>

              <h2 className="panel-heading">{getCatalogDisplayName(metadataPreview.catalogPath)} Metadata</h2>

              <div className="metadata-preview-tabs" role="tablist" aria-label="Metadata preview tabs">
                <button
                  aria-selected={activeMetadataTab === "metadata"}
                  className={`metadata-preview-tab${activeMetadataTab === "metadata" ? " is-active" : ""}`}
                  onClick={() => setActiveMetadataTab("metadata")}
                  role="tab"
                  type="button"
                >
                  Metadata
                </button>
                <button
                  aria-selected={activeMetadataTab === "overview"}
                  className={`metadata-preview-tab${activeMetadataTab === "overview" ? " is-active" : ""}`}
                  onClick={() => setActiveMetadataTab("overview")}
                  role="tab"
                  type="button"
                >
                  Overview
                </button>
              </div>

              {activeMetadataTab === "metadata" ? (
                <div aria-label="Metadata JSON preview" className="metadata-preview-shell" role="region">
                  <div className="metadata-preview-code">
                    {metadataPreviewLines.map((line, index) => (
                      <div className="metadata-preview-line" key={`metadata-preview-line-${index + 1}`}>
                        <span className="metadata-preview-line-number">{index + 1}</span>
                        <code className="metadata-preview-line-content">
                          {renderHighlightedJsonLine(line)}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeMetadataTab === "overview" ? (
                <div className="metadata-overview-panel">
                  {metadataOverviewSections.map((section) => (
                    <section className="metadata-overview-section" key={section.id}>
                      <div className="metadata-overview-section-header">
                        <p className="section-label">{section.title}</p>
                      </div>
                      {renderMetadataOverviewValue(section.title, section.value, section.id)}
                    </section>
                  ))}
                </div>
              ) : null}
            </article>
          ) : null}

          {isEditorFocusVisible ? (
            <aside className="surface active-card connection-overview-card">
              <div className="editor-focus-header">
                <h2 className="panel-heading">Editor Focus</h2>
                <IconOnlyButton kind="close-square" label="Close editor focus" onClick={closeEditorFocus} />
              </div>

              <div className="panel-body-shell editor-focus-panel-shell">
                <div className="editor-focus-body">
                  {selectedCatalog && editorFocusActions.length > 0 ? (
                    <div className="editor-focus-actions" role="toolbar" aria-label="Editor focus actions">
                      {editorFocusActions.map((action) => (
                        <button
                          className={`${getActionButtonClassName(action.tone)} compact-button`}
                          disabled={action.disabled}
                          key={`${action.tone}-${action.label}`}
                          onClick={action.onClick}
                          type="button"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="meta-list editor-focus-metrics">
                    {editorFocusMetrics.map((metric) => (
                      <div className="meta-item" key={metric.label}>
                        <span className="meta-label">{metric.label}</span>
                        <span className="meta-value">
                          {metric.label === "Environment" && isEnvironmentType(metric.value) ? (
                            <EnvironmentBadge environmentType={metric.value} />
                          ) : (
                            metric.value
                          )}
                        </span>
                      </div>
                    ))}
                  </div>

                  {selectedCatalog ? (
                    <>
                      <div className="editor-focus-divider" />
                      <section className="editor-focus-history" aria-label="Metadata history">
                        <h3 className="section-label">History</h3>

                        {selectedCatalogHistory.length > 0 ? (
                          <div className="editor-focus-history-list">
                            {selectedCatalogHistory.map((entry) => (
                              <article className="editor-focus-history-item" key={entry.id}>
                                <div className="editor-focus-history-item-top">
                                  <span className={`history-status-pill is-${entry.status}`}>
                                    {entry.status === "success" ? "Success" : "Failed"}
                                  </span>
                                  <div className="history-action-group">
                                    <button
                                      className="secondary-button compact-button history-open-button"
                                      disabled={
                                        !selectedProject ||
                                        !entry.tempFilePath ||
                                        deletingMetadataEntryId !== null ||
                                        (openingMetadataEntryId !== null &&
                                          openingMetadataEntryId !== entry.id)
                                      }
                                      onClick={() => {
                                        if (selectedProject) {
                                          void openCachedCatalogMetadata(
                                            selectedProject.code,
                                            selectedCatalog.path,
                                            entry.id
                                          );
                                        }
                                      }}
                                      type="button"
                                    >
                                      {openingMetadataEntryId === entry.id ? "Opening..." : "Open"}
                                    </button>
                                    <IconOnlyButton
                                      className="history-delete-button"
                                      disabled={
                                        !selectedProject ||
                                        openingMetadataEntryId !== null ||
                                        deletingMetadataEntryId !== null
                                      }
                                      kind="trash"
                                      label="Delete history entry"
                                      onClick={() => {
                                        if (selectedProject) {
                                          void handleDeleteCatalogMetadataHistoryEntry(
                                            selectedProject.code,
                                            selectedCatalog.path,
                                            entry.id
                                          );
                                        }
                                      }}
                                      tone="danger"
                                    />
                                  </div>
                                </div>
                                <div className="editor-focus-history-meta">
                                  <span>{formatTimestamp(entry.completedAt)}</span>
                                  <EnvironmentBadge environmentType={entry.environmentType} />
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="editor-focus-history-empty">
                            No metadata download attempts recorded for this catalog.
                          </p>
                        )}
                        <p className="editor-focus-history-note">Showing the latest 10 entries.</p>
                      </section>
                    </>
                  ) : null}

                  {!selectedCatalog && editorFocusActions.length > 0 ? (
                    <div className="editor-focus-actions" role="toolbar" aria-label="Editor focus actions">
                      {editorFocusActions.map((action) => (
                        <button
                          className={`${getActionButtonClassName(action.tone)} compact-button`}
                          disabled={action.disabled}
                          key={`${action.tone}-${action.label}`}
                          onClick={action.onClick}
                          type="button"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </aside>
          ) : null}
        </section>
      </section>

      <p aria-live="polite" className="sr-only">
        {statusMessage}
      </p>

      {isConnectionDialogOpen && selectedProject ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeConnectionDialog}>
          <div
            className="surface dialog-shell connection-dialog-shell"
            role="dialog"
            aria-modal="true"
            aria-label={connectionDialogMode === "edit" ? "Edit connection" : "Add connection"}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <div className="dialog-title">
                <span className="icon-badge">
                  <AppIcon kind={connectionDialogMode === "edit" ? "connection" : "add"} />
                </span>
                <h4>{connectionDialogMode === "edit" ? "Edit connection" : "Add connection"}</h4>
              </div>

              <IconOnlyButton
                disabled={isConnectionSaving || isConnectionDeleting}
                kind="close-square"
                label="Close connection dialog"
                onClick={closeConnectionDialog}
              />
            </div>

            <form className="form-grid connection-form connection-modal-form" onSubmit={handleSaveConnection}>
              {connectionBanner.tone === "error" ? (
                <p className="error-banner">{connectionBanner.message}</p>
              ) : null}

              <div className="field-row">
                <label className="field">
                  <span>Connection name</span>
                  <input
                    value={connectionForm.name}
                    onChange={(event) =>
                      setConnectionForm((current) => ({
                        ...current,
                        name: event.target.value
                      }))
                    }
                    placeholder="Finance Warehouse"
                  />
                </label>

                <label className="field">
                  <span>Environment type</span>
                  <select
                    value={connectionForm.environmentType}
                    onChange={(event) =>
                      setConnectionForm((current) => ({
                        ...current,
                        environmentType: event.target.value as EnvironmentType
                      }))
                    }
                  >
                    {environmentTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="field">
                <span>URL</span>
                <input
                  type="url"
                  value={connectionForm.url}
                  onChange={(event) =>
                    setConnectionForm((current) => ({
                      ...current,
                      url: event.target.value
                    }))
                  }
                  placeholder={connectionUrlPattern}
                  title={`URL must match the pattern ${connectionUrlPattern}.`}
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Username</span>
                  <input
                    value={connectionForm.username}
                    onChange={(event) =>
                    setConnectionForm((current) => ({
                      ...current,
                      username: event.target.value
                    }))
                  }
                    placeholder="catalog_admin"
                  />
                </label>

                <label className="field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={connectionForm.password}
                    onChange={(event) =>
                      setConnectionForm((current) => ({
                        ...current,
                        password: event.target.value
                      }))
                    }
                    placeholder="Enter the connection password"
                  />
                </label>
              </div>

              <div className="dialog-actions modal-form-actions">
                <button
                  className="primary-button compact-button"
                  disabled={isConnectionSaving || isConnectionDeleting}
                  type="submit"
                >
                  {isConnectionSaving ? "Saving..." : "Save connection"}
                </button>
                {connectionDialogMode === "edit" && selectedConnection ? (
                  <button
                    className="danger-button compact-button"
                    disabled={isConnectionSaving || isConnectionDeleting}
                    onClick={() => {
                      closeConnectionDialog();
                      requestDeleteConnection(selectedProject.code, selectedConnection.name);
                    }}
                    type="button"
                  >
                    Delete connection
                  </button>
                ) : null}
                <button
                  className="neutral-button compact-button"
                  disabled={isConnectionSaving || isConnectionDeleting}
                  onClick={closeConnectionDialog}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isCatalogDialogOpen && selectedProject ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeCatalogDialog}>
          <div
            className="surface dialog-shell connection-dialog-shell"
            role="dialog"
            aria-modal="true"
            aria-label="Add catalog path"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <div className="dialog-title">
                <span className="icon-badge">
                  <AppIcon kind="catalog" />
                </span>
                <h4>Add catalog path</h4>
              </div>

              <IconOnlyButton
                disabled={isCatalogSaving}
                kind="close-square"
                label="Close add catalog dialog"
                onClick={closeCatalogDialog}
              />
            </div>

            {catalogDialogErrorMessage ? <p className="error-banner">{catalogDialogErrorMessage}</p> : null}

            <form className="form-grid connection-form connection-modal-form" onSubmit={handleSaveCatalog}>
              <label className="field">
                <span>Connection</span>
                <select
                  value={catalogForm.connectionName}
                  onChange={(event) =>
                    setCatalogForm((current) => ({
                      ...current,
                      connectionName: event.target.value
                    }))
                  }
                  disabled={selectedProject.connections.length === 0 || isCatalogSaving}
                >
                  {selectedProject.connections.length === 0 ? (
                    <option value="">No saved connections</option>
                  ) : null}
                  {selectedProject.connections.map((connection) => (
                    <option key={connection.name} value={connection.name}>
                      {connection.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Catalog folder absolute path</span>
                <input
                  value={catalogForm.path}
                  onChange={(event) =>
                    setCatalogForm((current) => ({
                      ...current,
                      path: event.target.value
                    }))
                  }
                  placeholder="/Custom/Financials/TrialBalance"
                />
              </label>

              <div className="dialog-actions modal-form-actions">
                <button
                  className="primary-button compact-button"
                  disabled={isCatalogSaving || selectedProject.connections.length === 0}
                  type="submit"
                >
                  {isCatalogSaving ? "Saving..." : "Save catalog path"}
                </button>
                <button
                  className="neutral-button compact-button"
                  disabled={isCatalogSaving}
                  onClick={closeCatalogDialog}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isCatalogDownloadDialogOpen && selectedProject ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeCatalogDownloadDialog}>
          <div
            className="surface dialog-shell connection-dialog-shell"
            role="dialog"
            aria-modal="true"
            aria-label={catalogDownloadDialogTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <div className="dialog-title">
                {catalogDownloadMode === "catalog" ? null : (
                  <span className="icon-badge">
                    <AppIcon kind="open" />
                  </span>
                )}
                <h4>{catalogDownloadDialogTitle}</h4>
              </div>

              <IconOnlyButton
                disabled={isCatalogDownloading}
                kind="close-square"
                label="Close catalog download dialog"
                onClick={closeCatalogDownloadDialog}
              />
            </div>

            <form className="form-grid connection-form connection-modal-form" onSubmit={handleDownloadCatalogMetadata}>
              {catalogDownloadErrorMessage ? <p className="error-banner">{catalogDownloadErrorMessage}</p> : null}

              <label className="field">
                <span>Connection</span>
                <select
                  value={catalogDownloadForm.connectionName}
                  onChange={(event) =>
                    setCatalogDownloadForm((current) => ({
                      ...current,
                      connectionName: event.target.value
                    }))
                  }
                  disabled={selectedProject.connections.length === 0 || isCatalogDownloading}
                >
                  {selectedProject.connections.length === 0 ? (
                    <option value="">No saved connections</option>
                  ) : null}
                  {selectedProject.connections.map((connection) => (
                    <option key={connection.name} value={connection.name}>
                      {connection.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Catalog folder absolute path</span>
                <input
                  value={catalogDownloadForm.catalogPath}
                  readOnly
                />
              </label>

              <div className="dialog-actions modal-form-actions">
                <button
                  className="primary-button compact-button"
                  disabled={selectedProject.connections.length === 0 || isCatalogDownloading}
                  type="submit"
                >
                  {isCatalogDownloading ? "Downloading..." : catalogDownloadButtonLabel}
                </button>
                <button
                  className="neutral-button compact-button"
                  disabled={isCatalogDownloading}
                  onClick={closeCatalogDownloadDialog}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {dialogMode ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeDialog}>
          <div
            className="surface dialog-shell"
            role="dialog"
            aria-modal="true"
            aria-label={
              dialogMode === "add-project"
                ? "Add project"
                : dialogMode === "edit-project"
                  ? "Edit project"
                : dialogMode === "open-project"
                  ? "Open project"
                  : "Manage projects"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <div className="dialog-title">
                <span className="icon-badge">
                  <AppIcon
                    kind={
                      dialogMode === "add-project"
                        ? "add"
                        : dialogMode === "open-project"
                          ? "open"
                          : "manage"
                    }
                  />
                </span>
                <h4>
                  {dialogMode === "add-project"
                    ? "Add project"
                    : dialogMode === "edit-project"
                      ? "Edit project"
                    : dialogMode === "open-project"
                      ? "Open project"
                      : "Manage projects"}
                </h4>
              </div>

              <IconOnlyButton kind="close-square" label="Close project dialog" onClick={closeDialog} />
            </div>

            {dialogErrorMessage ? <p className="error-banner">{dialogErrorMessage}</p> : null}

            {dialogMode === "add-project" || dialogMode === "edit-project" ? (
              <form
                className="form-grid"
                onSubmit={dialogMode === "edit-project" ? handleUpdateProject : handleCreateProject}
              >
                <label className="field">
                  <span>Project code</span>
                  <input
                    value={projectForm.code}
                    disabled={dialogMode === "edit-project"}
                    onChange={(event) =>
                      setProjectForm((current) => ({
                        ...current,
                        code: event.target.value
                      }))
                    }
                    placeholder="PRJ-001"
                  />
                </label>

                <label className="field">
                  <span>Project name</span>
                  <input
                    value={projectForm.name}
                    onChange={(event) =>
                      setProjectForm((current) => ({
                        ...current,
                        name: event.target.value
                      }))
                    }
                    placeholder="Quarterly catalog refresh"
                  />
                </label>

                <label className="field">
                  <span>Project description</span>
                  <textarea
                    rows={5}
                    value={projectForm.description}
                    onChange={(event) =>
                      setProjectForm((current) => ({
                        ...current,
                        description: event.target.value
                      }))
                    }
                    placeholder="Describe what this catalog project covers."
                  />
                </label>

                <div className="dialog-actions">
                  <button className="primary-button" type="submit" disabled={isBusy}>
                    {isBusy
                      ? dialogMode === "edit-project"
                        ? "Saving..."
                        : "Saving..."
                      : dialogMode === "edit-project"
                        ? "Save changes"
                      : "Save project"}
                  </button>
                  {dialogMode === "edit-project" ? (
                    <button
                      className="danger-button"
                      disabled={isBusy}
                      onClick={() => {
                        closeDialog();
                        requestDeleteProject(projectForm.code);
                      }}
                      type="button"
                    >
                      Delete project
                    </button>
                  ) : null}
                  <button className="neutral-button" type="button" onClick={closeDialog}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            {dialogMode === "open-project" ? (
              projectState.projects.length > 0 ? (
                <div className="selection-list">
                  {projectState.projects.map((project) => (
                    <label
                      className={`selectable-card${
                        dialogSelectedProjectCode === project.code ? " is-selected" : ""
                      }`}
                      key={project.code}
                    >
                      <input
                        type="radio"
                        name="project"
                        checked={dialogSelectedProjectCode === project.code}
                        onChange={() => setDialogSelectedProjectCode(project.code)}
                      />
                      <div className="selectable-content">
                        <div className="code-row">
                          <span className="code-pill">{project.code}</span>
                          {project.code === activeProject?.code ? (
                            <span className="active-badge">Current</span>
                          ) : null}
                        </div>
                        <strong>{project.name}</strong>
                        <p className="project-description">{project.description}</p>
                      </div>
                    </label>
                  ))}

                  <div className="dialog-actions">
                    <button className="primary-button" onClick={() => handleOpenProject()} disabled={isBusy}>
                      {isBusy ? "Opening..." : "Open project"}
                    </button>
                    <button className="neutral-button" onClick={closeDialog} type="button">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty-state compact-empty-state">
                  <div className="empty-copy">
                    <span className="icon-badge subtle-icon-badge">
                      <AppIcon kind="empty" />
                    </span>
                    <div>
                      <h4>No saved projects exist yet</h4>
                      <p>Add a project first so there is something to open.</p>
                    </div>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => {
                      setDialogMode("add-project");
                      setProjectForm(defaultProjectForm);
                    }}
                    type="button"
                  >
                    Add project
                  </button>
                </div>
              )
            ) : null}

            {dialogMode === "manage-projects" ? (
              projectState.projects.length > 0 ? (
                <div className="manage-list">
                  {projectState.projects.map((project) => (
                    <article className="manage-card" key={project.code}>
                      <div className="manage-copy">
                        <div className="code-row">
                          <span className="code-pill">{project.code}</span>
                          {project.code === activeProject?.code ? (
                            <span className="active-badge">Current</span>
                          ) : null}
                        </div>
                        <h5>{project.name}</h5>
                        <p className="project-description">{project.description}</p>
                        <p className="project-description">
                          {formatConnectionCount(project.connections.length)}
                        </p>
                      </div>
                      <div className="project-actions">
                        <button
                          className="secondary-button compact-button"
                          onClick={() => handleOpenProject(project.code)}
                          type="button"
                        >
                          Open
                        </button>
                        <button
                          className="danger-button compact-button"
                          onClick={() => requestDeleteProject(project.code)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state compact-empty-state">
                  <div className="empty-copy">
                    <span className="icon-badge subtle-icon-badge">
                      <AppIcon kind="empty" />
                    </span>
                    <div>
                      <h4>There are no projects to manage yet</h4>
                      <p>Add a project first, then return here to review the list.</p>
                    </div>
                  </div>
                </div>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {pendingDeleteProject ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeDeleteDialog}>
          <div
            className="surface confirm-shell"
            role="dialog"
            aria-modal="true"
            aria-label="Delete project"
            onClick={(event) => event.stopPropagation()}
          >
            <h4>Remove {pendingDeleteProject.name} from the saved list?</h4>

            <div className="dialog-actions">
              <button className="danger-button" onClick={confirmDeleteProject} disabled={isBusy}>
                {isBusy ? "Deleting..." : "Delete project"}
              </button>
              <button className="neutral-button" onClick={closeDeleteDialog} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDeleteConnection && pendingDeleteConnectionDetails ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeDeleteConnectionDialog}>
          <div
            className="surface confirm-shell"
            role="dialog"
            aria-modal="true"
            aria-label="Delete connection"
            onClick={(event) => event.stopPropagation()}
          >
            <h4>Remove {pendingDeleteConnectionDetails.name} from this project?</h4>

            <div className="dialog-actions">
              <button
                className="danger-button"
                onClick={confirmDeleteConnection}
                disabled={isConnectionDeleting}
              >
                {isConnectionDeleting ? "Deleting..." : "Delete connection"}
              </button>
              <button className="neutral-button" onClick={closeDeleteConnectionDialog} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDeleteCatalog && pendingDeleteCatalogDetails ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeDeleteCatalogDialog}>
          <div
            className="surface confirm-shell"
            role="dialog"
            aria-modal="true"
            aria-label="Delete catalog"
            onClick={(event) => event.stopPropagation()}
          >
            <h4>Remove {getCatalogDisplayName(pendingDeleteCatalogDetails.path)} from this project?</h4>

            <div className="dialog-actions">
              <button
                className="danger-button"
                onClick={confirmDeleteCatalog}
                disabled={isCatalogDeleting}
              >
                {isCatalogDeleting ? "Deleting..." : "Delete catalog"}
              </button>
              <button className="neutral-button" onClick={closeDeleteCatalogDialog} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
