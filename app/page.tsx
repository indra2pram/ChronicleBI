"use client";

import { FormEvent, useEffect, useState } from "react";

const defaultProjectForm: ProjectDraft = {
  code: "",
  name: "",
  description: ""
};

const defaultConnectionForm: ConnectionDraft = {
  name: "",
  url: "",
  username: "",
  password: ""
};

const iconGlyphs = {
  add: "\uE0AB",
  open: "\uE04F",
  manage: "\uE07C",
  refresh: "\uE033",
  current: "\uE080",
  projects: "\uE06C",
  workspace: "\uE047",
  application: "\uE06D",
  platform: "\uE09D",
  empty: "\uE045"
} as const;

type ExplorerSection = "project" | "connections" | "reports" | "connection";
type ExplorerFolderName = "connections" | "reports";
type ConnectionDialogMode = "create" | "edit";
type BannerTone = "info" | "success" | "error";

interface BannerState {
  tone: BannerTone;
  message: string;
  detail?: string;
}

interface ExpandedFolderState {
  connections: boolean;
  reports: boolean;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
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

function formatConnectionCount(count: number) {
  return `${count} connection${count === 1 ? "" : "s"}`;
}

function formatReportCount(count: number) {
  return `${count} report${count === 1 ? "" : "s"}`;
}

function getDefaultExpandedFolders(): ExpandedFolderState {
  return {
    connections: false,
    reports: false
  };
}

function getProjectReportCount(_project: StoredProject) {
  return 0;
}

function RedwoodIcon({
  glyph,
  className = ""
}: Readonly<{
  glyph: string;
  className?: string;
}>) {
  return <span aria-hidden="true" className={`redwood-icon ${className}`.trim()}>{glyph}</span>;
}

export default function HomePage() {
  const [appInfo, setAppInfo] = useState<ElectronAppInfo | null>(null);
  const [projectState, setProjectState] = useState<ProjectState>({
    activeProjectCode: null,
    projects: []
  });
  const [projectForm, setProjectForm] = useState<ProjectDraft>(defaultProjectForm);
  const [connectionForm, setConnectionForm] = useState<ConnectionDraft>(defaultConnectionForm);
  const [dialogMode, setDialogMode] = useState<ProjectMenuAction | null>(null);
  const [connectionDialogMode, setConnectionDialogMode] = useState<ConnectionDialogMode | null>(null);
  const [dialogSelectedProjectCode, setDialogSelectedProjectCode] = useState("");
  const [selectedProjectCode, setSelectedProjectCode] = useState("");
  const [selectedConnectionName, setSelectedConnectionName] = useState<string | null>(null);
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
  const [statusMessage, setStatusMessage] = useState(
    "Use the File menu to add a project, open a saved one, or manage the list."
  );
  const [dialogErrorMessage, setDialogErrorMessage] = useState("");
  const [connectionBanner, setConnectionBanner] = useState<BannerState>({
    tone: "info",
    message: "Create a project first, then define connections inside it."
  });
  const [isBusy, setIsBusy] = useState(false);
  const [isConnectionSaving, setIsConnectionSaving] = useState(false);
  const [isConnectionTesting, setIsConnectionTesting] = useState(false);
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
  const selectedProjectReportCount = selectedProject ? getProjectReportCount(selectedProject) : 0;
  const isReportsView = selectedExplorerSection === "reports";
  const isConnectionDialogOpen = connectionDialogMode !== null;
  const pendingDeleteProject =
    projectState.projects.find((project) => project.code === pendingDeleteCode) ?? null;
  const pendingDeleteConnectionDetails =
    pendingDeleteConnection &&
    projectState.projects
      .find((project) => project.code === pendingDeleteConnection.projectCode)
      ?.connections.find((connection) => connection.name === pendingDeleteConnection.connectionName);

  useEffect(() => {
    let isCancelled = false;

    async function hydrateApp() {
      try {
        const [info, nextProjectState] = await Promise.all([
          window.electronAPI.getAppInfo(),
          window.electronAPI.getProjectState()
        ]);

        if (isCancelled) {
          return;
        }

        setAppInfo(info);
        setProjectState(nextProjectState);
        setSelectedProjectCode(nextProjectState.activeProjectCode ?? nextProjectState.projects[0]?.code ?? "");
        setExpandedProjectCodes(
          nextProjectState.activeProjectCode ? [nextProjectState.activeProjectCode] : []
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

      setSelectedExplorerSection("project");
      setExpandedProjectCodes([]);
      setExpandedProjectFolders({});
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
  }, [projectState, selectedConnectionName, selectedProjectCode]);

  useEffect(() => {
    if (!selectedProjectCode) {
      return;
    }

    setExpandedProjectCodes((current) =>
      current.includes(selectedProjectCode) ? current : [...current, selectedProjectCode]
    );
  }, [selectedProjectCode]);

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
        password: selectedConnection.password
      });
      return;
    }

    setConnectionForm(defaultConnectionForm);
  }

  function closeDialog() {
    setDialogMode(null);
    setDialogErrorMessage("");
    setIsBusy(false);
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

    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(null);
    setSelectedExplorerSection("project");
    ensureProjectExpanded(projectCode);
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

    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(null);
    setSelectedExplorerSection(folderName);
    ensureFolderExpanded(projectCode, folderName);
    setConnectionForm(defaultConnectionForm);
    setConnectionBanner({
      tone: "info",
      message:
        folderName === "connections"
          ? project
            ? `Browse or create connections inside ${project.name}.`
            : "Browse connections for the selected project."
          : project
            ? `Reports for ${project.name} will appear here when report management is added.`
            : "Browse reports for the selected project."
    });
  }

  function beginNewConnection(projectCode: string) {
    const project = projectState.projects.find((item) => item.code === projectCode);

    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(null);
    setSelectedExplorerSection("connections");
    ensureFolderExpanded(projectCode, "connections");
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

    setSelectedProjectCode(projectCode);
    setSelectedConnectionName(connection.name);
    setSelectedExplorerSection("connection");
    ensureFolderExpanded(projectCode, "connections");
    setConnectionForm({
      name: connection.name,
      url: connection.url,
      username: connection.username,
      password: connection.password
    });
    setConnectionBanner({
      tone: "info",
      message: `Selected ${connection.name} in ${project.name}.`,
      detail: `Last updated ${formatTimestamp(connection.updatedAt)}`
    });
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
      setSelectedExplorerSection("project");
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
      setSelectedExplorerSection("project");
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
        setSelectedExplorerSection("project");
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

  async function handleTestConnection() {
    if (!selectedProject) {
      setConnectionBanner({
        tone: "error",
        message: "Choose a project before testing a connection."
      });
      return;
    }

    setIsConnectionTesting(true);

    try {
      const result = await window.electronAPI.testConnection(
        selectedProject.code,
        connectionForm,
        selectedConnectionName
      );

      setConnectionBanner({
        tone: "success",
        message: result.message,
        detail: `Validated ${formatTimestamp(result.testedAt)}`
      });
      setStatusMessage(
        `Local validation passed for ${connectionForm.name.trim() || "the current connection"} in ${selectedProject.code}.`
      );
    } catch (error) {
      setConnectionBanner({
        tone: "error",
        message: getErrorMessage(error)
      });
    } finally {
      setIsConnectionTesting(false);
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
      setSelectedExplorerSection("connection");
      ensureFolderExpanded(selectedProject.code, "connections");
      setConnectionForm({
        name: savedName,
        url: connectionForm.url.trim(),
        username: connectionForm.username.trim(),
        password: connectionForm.password
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
        setSelectedExplorerSection("connections");
        ensureFolderExpanded(projectCode, "connections");
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

  return (
    <main className="workspace-shell">
      <aside className="surface nav-panel">
        <div className="nav-stack">
          <div className="eyebrow-row">
            <span className="app-chip">Reporting Comparison Tool</span>
            <span className="helper-chip">Oracle Redwood workspace</span>
          </div>

          <div className="nav-copy">
            <p className="section-label">Project explorer</p>
            <h1>Browse projects like a folder tree</h1>
            <p className="lede nav-lede">
              Projects stay at the root, with Connections and Reports nested underneath in a
              tighter desktop-style explorer.
            </p>
          </div>

          <div className="nav-actions">
            <button className="primary-button" onClick={() => openDialog("add-project")}>
              <RedwoodIcon className="button-icon" glyph={iconGlyphs.add} />
              Add project
            </button>
            <button className="secondary-button" onClick={() => openDialog("open-project")}>
              <RedwoodIcon className="button-icon" glyph={iconGlyphs.open} />
              Open project
            </button>
            <button className="ghost-button" onClick={() => openDialog("manage-projects")}>
              <RedwoodIcon className="button-icon" glyph={iconGlyphs.manage} />
              Manage projects
            </button>
          </div>

          <div className="status-panel nav-status-panel">
            <p className="section-label">Status</p>
            <p className="status-copy">{statusMessage}</p>
          </div>

          <section className="tree-panel">
            <div className="tree-panel-head">
              <div>
                <p className="section-label">Projects, connections, and reports</p>
                <p className="section-note">
                  Expand a project to reveal its Connections and Reports folders, then drill into
                  the item you want to work with.
                </p>
              </div>

              <button className="ghost-button compact-button" onClick={handleRefresh}>
                <RedwoodIcon className="button-icon" glyph={iconGlyphs.refresh} />
                Refresh
              </button>
            </div>

            {projectState.projects.length === 0 ? (
              <div className="empty-state tree-empty-state">
                <div className="empty-copy">
                  <span className="icon-badge subtle-icon-badge">
                    <RedwoodIcon glyph={iconGlyphs.empty} />
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
                  const isReportsFolderSelected =
                    selectedProject?.code === project.code && selectedExplorerSection === "reports";
                  const isCurrentProject = activeProject?.code === project.code;
                  const isProjectExpanded = expandedProjectCodes.includes(project.code);
                  const folderState = expandedProjectFolders[project.code] ?? getDefaultExpandedFolders();
                  const isConnectionsExpanded = folderState.connections;
                  const isReportsExpanded = folderState.reports;
                  const reportCount = getProjectReportCount(project);

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
                            <RedwoodIcon className="tree-node-icon" glyph={iconGlyphs.projects} />
                          </span>

                          <span className="tree-node-copy">
                            <span className="tree-node-title">{project.name}</span>
                            <span className="tree-node-meta">
                              {project.code} . {formatConnectionCount(project.connections.length)} .{" "}
                              {formatReportCount(reportCount)}
                              {isCurrentProject ? " . current" : ""}
                            </span>
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
                                <span
                                  aria-hidden="true"
                                  className={`tree-folder-icon${isConnectionsExpanded ? " is-open" : ""}`}
                                />
                              </span>

                              <span className="tree-node-copy">
                                <span className="tree-node-title">Connections</span>
                                <span className="tree-node-meta">
                                  {formatConnectionCount(project.connections.length)}
                                </span>
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
                                          <span aria-hidden="true" className="tree-item-icon" />
                                        </span>

                                        <span className="tree-node-copy">
                                          <span className="tree-node-title">{connection.name}</span>
                                          <span className="tree-node-meta">{connection.username}</span>
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
                                isReportsExpanded ? "Collapse" : "Expand"
                              } Reports in ${project.name}`}
                              className={`tree-toggle-button${isReportsExpanded ? " is-expanded" : ""}`}
                              onClick={() => toggleFolderExpanded(project.code, "reports")}
                              type="button"
                            >
                              <span className="tree-toggle-chevron" />
                            </button>

                            <button
                              className={`tree-node folder-node${
                                isReportsFolderSelected ? " is-selected" : ""
                              }`}
                              onClick={() => selectExplorerFolder(project.code, "reports")}
                              type="button"
                            >
                              <span className="tree-node-leading">
                                <span
                                  aria-hidden="true"
                                  className={`tree-folder-icon reports-folder-icon${
                                    isReportsExpanded ? " is-open" : ""
                                  }`}
                                />
                              </span>

                              <span className="tree-node-copy">
                                <span className="tree-node-title">Reports</span>
                                <span className="tree-node-meta">{formatReportCount(reportCount)}</span>
                              </span>
                            </button>
                          </div>

                          {isReportsExpanded ? (
                            <div className="tree-children folder-children">
                              <p className="tree-empty-copy">No reports saved yet.</p>
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
        </div>
      </aside>

      <section className="workspace-main">
        <section className="hero-grid workspace-hero-grid">
          <article className="surface masthead-card workspace-summary-card">
            <div className="eyebrow-row">
              <span className="helper-chip">{appInfo?.name ?? "Desktop workspace"}</span>
              <span className="helper-chip">{appInfo?.platform ?? "Loading platform"}</span>
            </div>

            <h2>
              {selectedProject
                ? selectedProject.name
                : "Choose a project to start defining connections"}
            </h2>
            <p className="lede workspace-lede">
              The explorer keeps every project at the root and reveals Connections and Reports as
              consistent subfolders underneath each one.
            </p>

            <div className="hero-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  window.location.href = "/compare";
                }}
                type="button"
              >
                Compare bundles
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  window.location.href = "/bip-download";
                }}
                type="button"
              >
                BIP downloadObject
              </button>
            </div>

            {selectedProject ? (
              <>
                <div className="hero-summary-row">
                  <div className="code-row">
                    <span className="code-pill">{selectedProject.code}</span>
                    {selectedProject.code === activeProject?.code ? (
                      <span className="active-badge">Current</span>
                    ) : null}
                    <span className="helper-chip">
                      {formatConnectionCount(selectedProject.connections.length)}
                    </span>
                    <span className="helper-chip">{formatReportCount(selectedProjectReportCount)}</span>
                  </div>
                </div>

                <p className="active-description">{selectedProject.description}</p>

                <div className="hero-actions">
                  {selectedProject.code !== activeProject?.code ? (
                    <button
                      className="secondary-button"
                      onClick={() => handleOpenProject(selectedProject.code)}
                    >
                      <RedwoodIcon className="button-icon" glyph={iconGlyphs.open} />
                      Make current
                    </button>
                  ) : null}
                  {isReportsView ? (
                    <button
                      className="primary-button"
                      onClick={() => selectExplorerFolder(selectedProject.code, "connections")}
                    >
                      <RedwoodIcon className="button-icon" glyph={iconGlyphs.open} />
                      Open connections
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      onClick={() => beginNewConnection(selectedProject.code)}
                    >
                      <RedwoodIcon className="button-icon" glyph={iconGlyphs.add} />
                      New connection
                    </button>
                  )}
                  <button className="ghost-button" onClick={() => openDialog("manage-projects")}>
                    <RedwoodIcon className="button-icon" glyph={iconGlyphs.manage} />
                    Manage projects
                  </button>
                </div>

                <div className="meta-list compact-meta-list">
                  <div className="meta-item">
                    <span className="meta-label">Created</span>
                    <span className="meta-value">{formatTimestamp(selectedProject.createdAt)}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Updated</span>
                    <span className="meta-value">{formatTimestamp(selectedProject.updatedAt)}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-copy">
                <span className="icon-badge subtle-icon-badge">
                  <RedwoodIcon glyph={iconGlyphs.empty} />
                </span>
                <div>
                  <p className="active-description">
                    Add a project first, or open one from the menu, to start building a browsable
                    project tree.
                  </p>
                </div>
              </div>
            )}
          </article>

          <aside className="surface active-card connection-overview-card">
            <div className="card-heading">
              <span className="icon-badge">
                <RedwoodIcon glyph={iconGlyphs.current} />
              </span>
              <div>
                <p className="section-label">Editor focus</p>
                <h2>
                  {isReportsView
                    ? "Reports folder"
                    : selectedConnection
                    ? selectedConnection.name
                    : selectedExplorerSection === "connections"
                      ? "Connections folder"
                    : selectedProject
                      ? "Project overview"
                      : "No project selected"}
                </h2>
              </div>
            </div>

            {selectedProject ? (
              <>
                <p className="active-description">
                  {isReportsView
                    ? `Browse report placeholders inside ${selectedProject.name}. This explorer branch is ready for report management next.`
                    : selectedConnection
                    ? `Review the selected connection, then open the modal when you want to update it.`
                    : selectedExplorerSection === "connections"
                      ? `Browse saved connections or open the add connection modal inside ${selectedProject.name}.`
                      : `Choose an explorer branch, then open the modal when you want to add a connection.`}
                </p>

                <div className="meta-list">
                  <div className="meta-item">
                    <span className="meta-label">Project</span>
                    <span className="meta-value">{selectedProject.code}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Saved connections</span>
                    <span className="meta-value">{selectedProject.connections.length}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Reports</span>
                    <span className="meta-value">{selectedProjectReportCount}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Explorer node</span>
                    <span className="meta-value">
                      {isReportsView
                        ? "Reports folder"
                        : selectedExplorerSection === "connection"
                          ? "Connection item"
                          : selectedExplorerSection === "connections"
                            ? "Connections folder"
                            : "Project root"}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Mode</span>
                    <span className="meta-value">
                      {isReportsView
                        ? "Report placeholder"
                        : selectedConnection
                          ? "Inspect saved connection"
                          : selectedExplorerSection === "project"
                            ? "Project overview"
                            : "Browse connections"}
                    </span>
                  </div>
                  {selectedConnection && !isReportsView ? (
                    <div className="meta-item">
                      <span className="meta-label">Last updated</span>
                      <span className="meta-value">{formatTimestamp(selectedConnection.updatedAt)}</span>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="empty-copy">
                <span className="icon-badge subtle-icon-badge">
                  <RedwoodIcon glyph={iconGlyphs.empty} />
                </span>
                <div>
                  <p className="active-description">
                    Pick a project from the tree so the connection workspace can target it.
                  </p>
                </div>
              </div>
            )}
          </aside>
        </section>

        <section className="detail-grid">
          <article className="surface detail-card">
            <div className="section-head">
              <div>
                <div className="section-title-row">
                  <span className="icon-badge subtle-icon-badge">
                    <RedwoodIcon glyph={iconGlyphs.projects} />
                  </span>
                  <div>
                    <p className="section-label">
                      {isReportsView ? "Reports folder" : "Connections folder"}
                    </p>
                    <h3>
                      {selectedProject
                        ? isReportsView
                          ? `Reports inside ${selectedProject.name}`
                          : `Connections inside ${selectedProject.name}`
                        : "Choose a project to browse its explorer folders"}
                    </h3>
                  </div>
                </div>
                <p className="section-note">
                  {isReportsView
                    ? "The explorer already reserves a Reports branch for every project, even before report creation is wired in."
                    : "The explorer keeps the Connections branch visible here as a quick companion to the tree on the left."}
                </p>
              </div>

              {selectedProject && !isReportsView ? (
                <button
                  className="ghost-button compact-button"
                  onClick={() => beginNewConnection(selectedProject.code)}
                >
                  <RedwoodIcon className="button-icon" glyph={iconGlyphs.add} />
                  Add connection
                </button>
              ) : null}
            </div>

            {selectedProject ? (
              isReportsView ? (
                <div className="empty-state compact-empty-state">
                  <div className="empty-copy">
                    <span className="icon-badge subtle-icon-badge">
                      <RedwoodIcon glyph={iconGlyphs.empty} />
                    </span>
                    <div>
                      <h4>No reports have been added yet</h4>
                      <p>
                        The Reports folder is now part of every project in the explorer. We can wire
                        report creation, browsing, and storage into this branch next.
                      </p>
                    </div>
                  </div>
                </div>
              ) : selectedProject.connections.length > 0 ? (
                <div className="connection-list">
                  {selectedProject.connections.map((connection) => {
                    const isSelected = selectedConnection?.name === connection.name;

                    return (
                      <button
                        className={`connection-card${isSelected ? " is-selected" : ""}`}
                        key={connection.name}
                        onClick={() => selectConnection(selectedProject.code, connection.name)}
                        type="button"
                      >
                        <div className="connection-card-top">
                          <div className="connection-card-copy">
                            <strong>{connection.name}</strong>
                            <span>{connection.username}</span>
                          </div>
                          <span className="code-pill connection-url-pill">Saved</span>
                        </div>
                        <p className="connection-url">{connection.url}</p>
                        <div className="connection-card-meta">
                          <span>Updated {formatTimestamp(connection.updatedAt)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state compact-empty-state">
                  <div className="empty-copy">
                    <span className="icon-badge subtle-icon-badge">
                      <RedwoodIcon glyph={iconGlyphs.empty} />
                    </span>
                    <div>
                      <h4>No connections have been saved yet</h4>
                      <p>
                        Add the first connection for this project from the explorer or the
                        connection modal.
                      </p>
                    </div>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => beginNewConnection(selectedProject.code)}
                  >
                    <RedwoodIcon className="button-icon" glyph={iconGlyphs.add} />
                    Add connection
                  </button>
                </div>
              )
            ) : (
              <div className="empty-state compact-empty-state">
                <div className="empty-copy">
                  <span className="icon-badge subtle-icon-badge">
                    <RedwoodIcon glyph={iconGlyphs.empty} />
                  </span>
                  <div>
                    <h4>No project is selected</h4>
                    <p>Pick a project from the left navigation to browse its explorer folders.</p>
                  </div>
                </div>
              </div>
            )}
          </article>

          <article className="surface detail-card inspector-card">
            <div className="section-head">
              <div>
                <div className="section-title-row">
                  <span className="icon-badge subtle-icon-badge">
                    <RedwoodIcon glyph={iconGlyphs.workspace} />
                  </span>
                  <div>
                    <p className="section-label">
                      {isReportsView ? "Reports workspace" : "Connection details"}
                    </p>
                    <h3>
                      {isReportsView
                        ? selectedProject
                          ? `Reports for ${selectedProject.name}`
                          : "Select a project first"
                        : selectedConnection
                          ? selectedConnection.name
                          : selectedProject
                            ? `Connections in ${selectedProject.name}`
                            : "Select a project first"}
                    </h3>
                  </div>
                </div>
                <p className="section-note">
                  {isReportsView
                    ? "This pane is reserved for report management. The explorer branch is live now, and the create or browse flow can plug in here next."
                    : "Create and update flows now open in compact modals. Use this pane to inspect the selected connection or launch the editor."}
                </p>
              </div>
            </div>

            {selectedProject ? (
              isReportsView ? (
                <div className="empty-state compact-empty-state report-workspace-empty-state">
                  <div className="empty-copy">
                    <span className="icon-badge subtle-icon-badge">
                      <RedwoodIcon glyph={iconGlyphs.empty} />
                    </span>
                    <div>
                      <h4>Report management will land here next</h4>
                      <p>
                        You can already navigate to the Reports folder from the explorer. Once you
                        share the report requirements, we can use this pane for report definitions,
                        grouping, and execution.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="inspector-stack">
                  <div className={`inline-banner tone-${connectionBanner.tone}`}>
                    <p>{connectionBanner.message}</p>
                    {connectionBanner.detail ? <small>{connectionBanner.detail}</small> : null}
                  </div>

                  {selectedConnection ? (
                    <>
                      <div className="inspector-grid">
                        <div className="inspector-row">
                          <span>Connection name</span>
                          <strong>{selectedConnection.name}</strong>
                        </div>
                        <div className="inspector-row">
                          <span>URL</span>
                          <strong>{selectedConnection.url}</strong>
                        </div>
                        <div className="inspector-row">
                          <span>Username</span>
                          <strong>{selectedConnection.username}</strong>
                        </div>
                        <div className="inspector-row">
                          <span>Password</span>
                          <strong>Stored in the local app profile</strong>
                        </div>
                        <div className="inspector-row">
                          <span>Updated</span>
                          <strong>{formatTimestamp(selectedConnection.updatedAt)}</strong>
                        </div>
                      </div>

                      <div className="dialog-actions inspector-actions">
                        <button
                          className="primary-button compact-button"
                          disabled={isConnectionDeleting}
                          onClick={() =>
                            beginEditConnection(selectedProject.code, selectedConnection.name)
                          }
                          type="button"
                        >
                          <RedwoodIcon className="button-icon" glyph={iconGlyphs.open} />
                          Edit connection
                        </button>
                        <button
                          className="secondary-button compact-button"
                          disabled={isConnectionDeleting}
                          onClick={() => beginNewConnection(selectedProject.code)}
                          type="button"
                        >
                          <RedwoodIcon className="button-icon" glyph={iconGlyphs.add} />
                          New connection
                        </button>
                        <button
                          className="danger-button compact-button"
                          disabled={isConnectionDeleting}
                          onClick={() =>
                            requestDeleteConnection(selectedProject.code, selectedConnection.name)
                          }
                          type="button"
                        >
                          Delete connection
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state compact-empty-state inspector-empty-state">
                      <div className="empty-copy">
                        <span className="icon-badge subtle-icon-badge">
                          <RedwoodIcon glyph={iconGlyphs.empty} />
                        </span>
                        <div>
                          <h4>No connection is selected</h4>
                          <p>
                            Select a saved connection from the explorer, or open the add connection
                            modal for {selectedProject.name}.
                          </p>
                        </div>
                      </div>
                      <button
                        className="primary-button compact-button"
                        onClick={() => beginNewConnection(selectedProject.code)}
                        type="button"
                      >
                        <RedwoodIcon className="button-icon" glyph={iconGlyphs.add} />
                        Add connection
                      </button>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="empty-state compact-empty-state">
                <div className="empty-copy">
                  <span className="icon-badge subtle-icon-badge">
                    <RedwoodIcon glyph={iconGlyphs.empty} />
                  </span>
                  <div>
                    <h4>The workspace needs a project context</h4>
                    <p>Select a project from the left navigation before editing explorer contents.</p>
                  </div>
                </div>
              </div>
            )}
          </article>
        </section>
      </section>

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
                  <RedwoodIcon
                    glyph={connectionDialogMode === "edit" ? iconGlyphs.open : iconGlyphs.add}
                  />
                </span>
                <div>
                  <p className="section-label">
                    {connectionDialogMode === "edit" ? "Edit connection" : "Add connection"}
                  </p>
                  <h4>
                    {connectionDialogMode === "edit"
                      ? `Update ${selectedConnection?.name ?? "selected connection"}`
                      : `Create a connection in ${selectedProject.name}`}
                  </h4>
                  <p className="dialog-copy">
                    {connectionDialogMode === "edit"
                      ? `Update the saved connection inside ${selectedProject.name}.`
                      : `Add a new saved endpoint inside ${selectedProject.name}.`}
                  </p>
                </div>
              </div>

              <button
                className="ghost-button compact-button"
                disabled={isConnectionSaving || isConnectionTesting}
                onClick={closeConnectionDialog}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="form-grid connection-form connection-modal-form" onSubmit={handleSaveConnection}>
              <div className={`inline-banner tone-${connectionBanner.tone}`}>
                <p>{connectionBanner.message}</p>
                {connectionBanner.detail ? <small>{connectionBanner.detail}</small> : null}
              </div>

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
                <small>Keep the name unique inside {selectedProject.name}.</small>
              </label>

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
                  placeholder="https://example.oraclecloud.com/reporting"
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
                    placeholder="report_admin"
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
                  className="secondary-button compact-button"
                  disabled={isConnectionSaving || isConnectionTesting || isConnectionDeleting}
                  onClick={handleTestConnection}
                  type="button"
                >
                  <RedwoodIcon className="button-icon" glyph={iconGlyphs.refresh} />
                  {isConnectionTesting ? "Testing..." : "Test connection"}
                </button>
                <button
                  className="primary-button compact-button"
                  disabled={isConnectionSaving || isConnectionTesting || isConnectionDeleting}
                  type="submit"
                >
                  {isConnectionSaving ? "Saving..." : "Save connection"}
                </button>
                <button
                  className="ghost-button compact-button"
                  disabled={isConnectionSaving || isConnectionTesting || isConnectionDeleting}
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

      {dialogMode ? (
        <div className="dialog-backdrop" role="presentation" onClick={closeDialog}>
          <div
            className="surface dialog-shell"
            role="dialog"
            aria-modal="true"
            aria-label={
              dialogMode === "add-project"
                ? "Add project"
                : dialogMode === "open-project"
                  ? "Open project"
                  : "Manage projects"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <div className="dialog-title">
                <span className="icon-badge">
                  <RedwoodIcon
                    glyph={
                      dialogMode === "add-project"
                        ? iconGlyphs.add
                        : dialogMode === "open-project"
                          ? iconGlyphs.open
                          : iconGlyphs.manage
                    }
                  />
                </span>
                <div>
                  <p className="section-label">
                    {dialogMode === "add-project"
                      ? "Add project"
                      : dialogMode === "open-project"
                        ? "Open project"
                        : "Manage projects"}
                  </p>
                  <h4>
                    {dialogMode === "add-project"
                      ? "Create a new project entry"
                      : dialogMode === "open-project"
                        ? "Choose a project to make current"
                        : "Review and delete saved projects"}
                  </h4>
                  <p className="dialog-copy">
                    {dialogMode === "add-project"
                      ? "Keep the entry concise and use a unique project code."
                      : dialogMode === "open-project"
                        ? "Select a project from the saved list and make it the current workspace."
                        : "Delete only the projects you no longer need to keep in the local list."}
                  </p>
                </div>
              </div>

              <button className="ghost-button compact-button" onClick={closeDialog}>
                Close
              </button>
            </div>

            {dialogErrorMessage ? <p className="error-banner">{dialogErrorMessage}</p> : null}

            {dialogMode === "add-project" ? (
              <form className="form-grid" onSubmit={handleCreateProject}>
                <label className="field">
                  <span>Project code</span>
                  <input
                    value={projectForm.code}
                    onChange={(event) =>
                      setProjectForm((current) => ({
                        ...current,
                        code: event.target.value
                      }))
                    }
                    placeholder="PRJ-001"
                  />
                  <small>Use a short code that stays unique across saved projects.</small>
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
                    placeholder="Quarterly reporting refresh"
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
                    placeholder="Describe what this reporting project covers."
                  />
                </label>

                <div className="dialog-actions">
                  <button className="primary-button" type="submit" disabled={isBusy}>
                    <RedwoodIcon className="button-icon" glyph={iconGlyphs.add} />
                    {isBusy ? "Saving..." : "Save project"}
                  </button>
                  <button className="ghost-button" type="button" onClick={closeDialog}>
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
                      <RedwoodIcon className="button-icon" glyph={iconGlyphs.open} />
                      {isBusy ? "Opening..." : "Open project"}
                    </button>
                    <button className="ghost-button" onClick={closeDialog}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty-state compact-empty-state">
                  <div className="empty-copy">
                    <span className="icon-badge subtle-icon-badge">
                      <RedwoodIcon glyph={iconGlyphs.empty} />
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
                  >
                    <RedwoodIcon className="button-icon" glyph={iconGlyphs.add} />
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
                        >
                          <RedwoodIcon className="button-icon" glyph={iconGlyphs.open} />
                          Open
                        </button>
                        <button
                          className="danger-button compact-button"
                          onClick={() => requestDeleteProject(project.code)}
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
                      <RedwoodIcon glyph={iconGlyphs.empty} />
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
            <p className="section-label">Delete project</p>
            <h4>Remove {pendingDeleteProject.name} from the saved list?</h4>
            <p className="dialog-copy">
              This deletes the local project entry for <strong>{pendingDeleteProject.code}</strong>.
              If it is current, the next saved project becomes current automatically.
            </p>

            <div className="dialog-actions">
              <button className="danger-button" onClick={confirmDeleteProject} disabled={isBusy}>
                {isBusy ? "Deleting..." : "Delete project"}
              </button>
              <button className="ghost-button" onClick={closeDeleteDialog}>
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
            <p className="section-label">Delete connection</p>
            <h4>Remove {pendingDeleteConnectionDetails.name} from this project?</h4>
            <p className="dialog-copy">
              This removes the saved connection from{" "}
              <strong>{pendingDeleteConnection.projectCode}</strong>. You can add it back later if
              needed.
            </p>

            <div className="dialog-actions">
              <button
                className="danger-button"
                onClick={confirmDeleteConnection}
                disabled={isConnectionDeleting}
              >
                {isConnectionDeleting ? "Deleting..." : "Delete connection"}
              </button>
              <button className="ghost-button" onClick={closeDeleteConnectionDialog}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
