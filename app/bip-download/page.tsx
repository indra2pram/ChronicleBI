"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to call BIP downloadObject().";
}

function formatTimestamp(value: string) {
  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  } catch (_error) {
    return value;
  }
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BipDownloadPage() {
  const [projectState, setProjectState] = useState<ProjectState>({
    activeProjectCode: null,
    projects: []
  });
  const [selectedProjectCode, setSelectedProjectCode] = useState("");
  const [selectedConnectionName, setSelectedConnectionName] = useState("");
  const [catalogPath, setCatalogPath] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Select a project and connection, enter the catalog path, then click Download."
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<BipDownloadResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const nextProjectState = await window.electronAPI.getProjectState();

        if (cancelled) {
          return;
        }

        const initialProjectCode =
          nextProjectState.activeProjectCode ?? nextProjectState.projects[0]?.code ?? "";
        const initialProject =
          nextProjectState.projects.find((project) => project.code === initialProjectCode) ??
          nextProjectState.projects[0] ??
          null;
        const initialConnectionName = initialProject?.connections[0]?.name ?? "";

        setProjectState(nextProjectState);
        setSelectedProjectCode(initialProjectCode);
        setSelectedConnectionName(initialConnectionName);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(getErrorMessage(error));
        }
      }
    }

    hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProject = useMemo(
    () => projectState.projects.find((project) => project.code === selectedProjectCode) ?? null,
    [projectState.projects, selectedProjectCode]
  );

  const selectedConnection = useMemo(
    () =>
      selectedProject?.connections.find((connection) => connection.name === selectedConnectionName) ??
      null,
    [selectedConnectionName, selectedProject]
  );

  useEffect(() => {
    if (!selectedProject) {
      if (selectedConnectionName) {
        setSelectedConnectionName("");
      }
      return;
    }

    if (selectedProject.connections.some((connection) => connection.name === selectedConnectionName)) {
      return;
    }

    setSelectedConnectionName(selectedProject.connections[0]?.name ?? "");
  }, [selectedConnectionName, selectedProject]);

  async function handleDownload() {
    if (!selectedProjectCode) {
      setErrorMessage("Choose a project first.");
      return;
    }

    if (!selectedConnectionName) {
      setErrorMessage("Choose a connection first.");
      return;
    }

    if (!catalogPath.trim()) {
      setErrorMessage("Enter a BIP catalog path.");
      return;
    }

    setIsBusy(true);
    setErrorMessage("");
    setStatusMessage("Calling CatalogService downloadObject()...");

    try {
      const nextResult = await window.electronAPI.downloadBipObject(
        selectedProjectCode,
        selectedConnectionName,
        catalogPath.trim()
      );

      setResult(nextResult);
      setStatusMessage("downloadObject() finished. Metadata JSON is ready to download.");
      console.log(nextResult.downloadObjectReturn);
    } catch (error) {
      setResult(null);
      setStatusMessage("downloadObject() failed.");
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function handleDownloadCatalogMetadataJson() {
    if (!result) {
      return;
    }

    const metadataJson = JSON.stringify(result.metadata, null, 2);
    const blob = new Blob([metadataJson], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = result.metadataFileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={`page-shell ${styles.pageShell}`}>
      <section className={`surface ${styles.heroCard}`}>
        <div className={styles.heroHeader}>
          <div>
            <p className="section-label">Oracle Fusion BIP</p>
            <h1>Catalog downloadObject tester</h1>
            <p className={styles.heroCopy}>
              Uses URL, username, and password from your saved project connection to call
              `downloadObject()`, extracts content from `downloadObjectReturn`, analyzes it, and
              prepares metadata JSON for download.
            </p>
          </div>

          <button
            className="ghost-button compact-button"
            onClick={() => {
              window.location.href = "/";
            }}
            type="button"
          >
            Back to workspace
          </button>
        </div>

        <div className={styles.formGrid}>
          <label className="field">
            <span>Project</span>
            <select
              value={selectedProjectCode}
              onChange={(event) => {
                setSelectedProjectCode(event.target.value);
                setResult(null);
                setErrorMessage("");
              }}
            >
              {projectState.projects.length === 0 ? <option value="">No projects found</option> : null}
              {projectState.projects.map((project) => (
                <option key={project.code} value={project.code}>
                  {project.code} - {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Connection name</span>
            <select
              value={selectedConnectionName}
              onChange={(event) => {
                setSelectedConnectionName(event.target.value);
                setResult(null);
                setErrorMessage("");
              }}
              disabled={!selectedProject || selectedProject.connections.length === 0}
            >
              {!selectedProject ? <option value="">Choose a project first</option> : null}
              {selectedProject && selectedProject.connections.length === 0 ? (
                <option value="">No connections in this project</option>
              ) : null}
              {selectedProject?.connections.map((connection) => (
                <option key={connection.name} value={connection.name}>
                  {connection.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>BIP catalog absolute path</span>
            <input
              value={catalogPath}
              onChange={(event) => {
                setCatalogPath(event.target.value);
                setResult(null);
                setErrorMessage("");
              }}
              placeholder="/Custom/MyFolder/MyCatalog.xdo"
            />
            <small>Example: `/Custom/Financials/TrialBalance/TrialBalanceCatalog.xdo`</small>
          </label>
        </div>

        {selectedConnection ? (
          <div className={styles.connectionSummary}>
            <span className="meta-label">Connection URL</span>
            <strong>{selectedConnection.url}</strong>
            <small>User: {selectedConnection.username}</small>
          </div>
        ) : null}

        <div className={styles.actions}>
          <button
            className="primary-button"
            disabled={isBusy || !selectedProject || !selectedConnection}
            onClick={handleDownload}
            type="button"
          >
            {isBusy ? "Downloading..." : "Download"}
          </button>
          <button
            className="secondary-button"
            disabled={!result}
            onClick={handleDownloadCatalogMetadataJson}
            type="button"
          >
            Download metadata JSON
          </button>
        </div>

        <div className={styles.feedbackStack}>
          <p className={styles.statusLine}>{statusMessage}</p>
          {errorMessage ? <p className={styles.errorBanner}>{errorMessage}</p> : null}
        </div>
      </section>

      {result ? (
        <section className={`surface ${styles.resultCard}`}>
          <p className="section-label">Last response</p>
          <h3>{result.connectionName}</h3>
          <div className={styles.metaList}>
            <div className={styles.metaItem}>
              <span className="meta-label">Requested at</span>
              <span>{formatTimestamp(result.requestedAt)}</span>
            </div>
            <div className={styles.metaItem}>
              <span className="meta-label">Endpoint</span>
              <span>{result.endpoint}</span>
            </div>
            <div className={styles.metaItem}>
              <span className="meta-label">Request variant</span>
              <span>{result.variantUsed}</span>
            </div>
            <div className={styles.metaItem}>
              <span className="meta-label">HTTP status</span>
              <span>{result.httpStatus}</span>
            </div>
            <div className={styles.metaItem}>
              <span className="meta-label">Payload base64 length</span>
              <span>{result.payloadBase64Length}</span>
            </div>
            <div className={styles.metaItem}>
              <span className="meta-label">Payload decoded bytes</span>
              <span>{result.payloadDecodedBytes ?? "Not base64 or unknown"}</span>
            </div>
            <div className={styles.metaItem}>
              <span className="meta-label">Analyzed payload format</span>
              <span>{result.metadata.payload.format}</span>
            </div>
            <div className={styles.metaItem}>
              <span className="meta-label">Analyzed payload size</span>
              <span>{formatBytes(result.metadata.payload.decodedBytes)}</span>
            </div>
            <div className={styles.metaItem}>
              <span className="meta-label">SHA-256</span>
              <span>{result.metadata.payload.sha256}</span>
            </div>
            <div className={styles.metaItem}>
              <span className="meta-label">Metadata file</span>
              <span>{result.metadataFileName}</span>
            </div>
          </div>

          <div className={styles.previewGrid}>
            <article className={styles.previewPanel}>
              <h4>Payload preview</h4>
              <pre>{result.payloadPreview || "No payload preview available."}</pre>
            </article>
            <article className={styles.previewPanel}>
              <h4>Response snippet</h4>
              <pre>{result.responseSnippet}</pre>
            </article>
            <article className={styles.previewPanel}>
              <h4>Metadata JSON preview</h4>
              <pre>{JSON.stringify(result.metadata, null, 2)}</pre>
            </article>
          </div>
        </section>
      ) : null}
    </main>
  );
}
