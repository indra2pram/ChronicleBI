"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  compareBundles,
  formatBytes,
  parseUploadedBundle,
  type CategoryComparison,
  type ComparisonResult,
  type ComparisonStatus,
  type TokenComparison,
  type TokenComparisonEntry
} from "./comparison";
import styles from "./page.module.css";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Comparison failed. Try selecting the files again.";
}

function toStatusLabel(status: ComparisonStatus) {
  if (status === "added") {
    return "Added";
  }

  if (status === "removed") {
    return "Removed";
  }

  if (status === "changed") {
    return "Changed";
  }

  return "Unchanged";
}

function statusClassName(status: ComparisonStatus) {
  if (status === "added") {
    return styles.statusAdded;
  }

  if (status === "removed") {
    return styles.statusRemoved;
  }

  if (status === "changed") {
    return styles.statusChanged;
  }

  return styles.statusUnchanged;
}

function summaryValue(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

type ComparisonViewMode = "changed" | "all";

interface XmlInspectorState {
  heading: string;
  path: string;
  beforeValue: string;
  afterValue: string;
}

type XmlInspectorPayload = XmlInspectorState;

function isValidCatalogBundle(file: File) {
  return file.name.toLowerCase().endsWith(".xdrz");
}

function unwrapCdataValue(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith("<![CDATA[") && trimmed.endsWith("]]>")) {
    return trimmed.slice(9, -3).trim();
  }

  return trimmed;
}

function getXmlLikeValue(value: string) {
  const normalizedValue = unwrapCdataValue(value);

  if (!normalizedValue) {
    return "";
  }

  return /^<\?xml\b|^<[A-Za-z_][\w:.-]*(\s|\/?>)|^<!--/.test(normalizedValue) ? normalizedValue : "";
}

function tokenizeXml(value: string) {
  const tokens: string[] = [];
  let index = 0;

  while (index < value.length) {
    if (value.startsWith("<!--", index)) {
      const endIndex = value.indexOf("-->", index + 4);

      if (endIndex === -1) {
        tokens.push(value.slice(index));
        break;
      }

      tokens.push(value.slice(index, endIndex + 3));
      index = endIndex + 3;
      continue;
    }

    if (value.startsWith("<![CDATA[", index)) {
      const endIndex = value.indexOf("]]>", index + 9);

      if (endIndex === -1) {
        tokens.push(value.slice(index));
        break;
      }

      tokens.push(value.slice(index, endIndex + 3));
      index = endIndex + 3;
      continue;
    }

    if (value.startsWith("<?", index)) {
      const endIndex = value.indexOf("?>", index + 2);

      if (endIndex === -1) {
        tokens.push(value.slice(index));
        break;
      }

      tokens.push(value.slice(index, endIndex + 2));
      index = endIndex + 2;
      continue;
    }

    if (value[index] === "<") {
      let cursor = index + 1;
      let activeQuote: '"' | "'" | null = null;

      while (cursor < value.length) {
        const currentCharacter = value[cursor];

        if (activeQuote) {
          if (currentCharacter === activeQuote) {
            activeQuote = null;
          }
        } else if (currentCharacter === '"' || currentCharacter === "'") {
          activeQuote = currentCharacter;
        } else if (currentCharacter === ">") {
          cursor += 1;
          break;
        }

        cursor += 1;
      }

      tokens.push(value.slice(index, cursor));
      index = cursor;
      continue;
    }

    const nextTagIndex = value.indexOf("<", index);

    if (nextTagIndex === -1) {
      tokens.push(value.slice(index));
      break;
    }

    tokens.push(value.slice(index, nextTagIndex));
    index = nextTagIndex;
  }

  return tokens;
}

function formatXmlForDisplay(value: string) {
  const xmlValue = getXmlLikeValue(value);

  if (!xmlValue) {
    return "";
  }

  try {
    const normalizedValue = xmlValue.replace(/\r\n?/g, "\n").trim();
    const tokens = tokenizeXml(normalizedValue);
    const lines: string[] = [];
    let indentLevel = 0;

    tokens.forEach((token) => {
      const trimmedToken = token.trim();

      if (!trimmedToken) {
        return;
      }

      if (trimmedToken.startsWith("</")) {
        indentLevel = Math.max(indentLevel - 1, 0);
        lines.push(`${"  ".repeat(indentLevel)}${trimmedToken}`);
        return;
      }

      if (trimmedToken.startsWith("<")) {
        lines.push(`${"  ".repeat(indentLevel)}${trimmedToken}`);

        if (
          !trimmedToken.startsWith("<?") &&
          !trimmedToken.startsWith("<!") &&
          !trimmedToken.endsWith("/>")
        ) {
          indentLevel += 1;
        }

        return;
      }

      trimmedToken
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          lines.push(`${"  ".repeat(indentLevel)}${line}`);
        });
    });

    return lines.length > 0 ? lines.join("\n") : normalizedValue;
  } catch (_error) {
    return xmlValue;
  }
}

function splitCodeLines(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n");
}

function CodePane({
  heading,
  value
}: Readonly<{
  heading: string;
  value: string;
}>) {
  const codeValue = formatXmlForDisplay(value);

  return (
    <section className={styles.xmlPane}>
      <div className={styles.xmlPaneHeader}>
        <span>{heading}</span>
      </div>

      <div className={styles.xmlCodeShell}>
        {codeValue ? (
          <div className={styles.xmlCode}>
            {splitCodeLines(codeValue).map((line, index) => (
              <div className={styles.xmlCodeLine} key={`${heading}-${index + 1}`}>
                <span className={styles.xmlCodeLineNumber}>{index + 1}</span>
                <code className={styles.xmlCodeLineContent}>{line || "\u00A0"}</code>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.xmlEmptyCopy}>No XML content.</p>
        )}
      </div>
    </section>
  );
}

function CategorySection({
  heading,
  note,
  category,
  viewMode,
  onOpenXmlInspector
}: Readonly<{
  heading: string;
  note: string;
  category: CategoryComparison;
  viewMode: ComparisonViewMode;
  onOpenXmlInspector: (payload: XmlInspectorPayload) => void;
}>) {
  const visibleEntries =
    viewMode === "changed"
      ? category.entries.filter((entry) => entry.status !== "unchanged")
      : category.entries;

  return (
    <section className={`surface ${styles.sectionCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <p className="section-label">{heading}</p>
          <h3>{summaryValue(visibleEntries.length, "file")}</h3>
          <p className={styles.sectionNote}>{note}</p>
        </div>
        <div className={styles.pillRow}>
          <span className={`${styles.metricPill} ${styles.metricAdded}`}>
            {summaryValue(category.added, "added file")}
          </span>
          <span className={`${styles.metricPill} ${styles.metricRemoved}`}>
            {summaryValue(category.removed, "removed file")}
          </span>
          <span className={`${styles.metricPill} ${styles.metricChanged}`}>
            {summaryValue(category.changed, "changed file")}
          </span>
        </div>
      </div>

      {visibleEntries.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.resultTable}>
            <colgroup>
              <col className={styles.categoryFileColumn} />
              <col className={styles.statusColumn} />
              <col className={styles.sizeColumn} />
              <col className={styles.sizeColumn} />
              <col className={styles.deltaColumn} />
              <col className={styles.inspectColumn} />
            </colgroup>
            <thead>
              <tr>
                <th>File</th>
                <th className={styles.statusCell}>Status</th>
                <th className={styles.compactCell}>Before</th>
                <th className={styles.compactCell}>After</th>
                <th className={styles.deltaCell}>Line delta</th>
                <th className={styles.inspectColumn}>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => {
                const canInspectXml =
                  entry.status !== "unchanged" &&
                  entry.status !== "removed" &&
                  Boolean(getXmlLikeValue(entry.beforeContent) || getXmlLikeValue(entry.afterContent));

                return (
                  <tr key={entry.path}>
                    <td className={styles.pathCell}>{entry.path}</td>
                    <td className={styles.statusCell}>
                      <span className={`${styles.statusChip} ${statusClassName(entry.status)}`}>
                        {toStatusLabel(entry.status)}
                      </span>
                    </td>
                    <td className={styles.compactCell}>{entry.beforeSize ? formatBytes(entry.beforeSize) : "-"}</td>
                    <td className={styles.compactCell}>{entry.afterSize ? formatBytes(entry.afterSize) : "-"}</td>
                    <td className={styles.deltaCell}>
                      +{entry.lineDelta.added} / -{entry.lineDelta.removed} / ~{entry.lineDelta.changed}
                    </td>
                    <td className={styles.inspectColumn}>
                      {canInspectXml ? (
                        <button
                          className={`secondary-button compact-button ${styles.inspectAction}`}
                          onClick={() =>
                            onOpenXmlInspector({
                              heading: entry.path,
                              path: entry.path,
                              beforeValue: entry.beforeContent,
                              afterValue: entry.afterContent
                            })
                          }
                          type="button"
                        >
                          View XML
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.emptyCopy}>
          {viewMode === "changed"
            ? "No changed files were found in this category."
            : "No files were classified in this category."}
        </p>
      )}
    </section>
  );
}

function TokenSection({
  heading,
  note,
  tokenComparison,
  viewMode,
  onOpenXmlInspector
}: Readonly<{
  heading: string;
  note: string;
  tokenComparison: TokenComparison;
  viewMode: ComparisonViewMode;
  onOpenXmlInspector: (entry: TokenComparisonEntry) => void;
}>) {
  const visibleEntries =
    viewMode === "changed"
      ? tokenComparison.entries.filter((entry) => entry.status !== "unchanged")
      : tokenComparison.entries;

  return (
    <section className={`surface ${styles.sectionCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <p className="section-label">{heading}</p>
          <h3>{summaryValue(visibleEntries.length, "item")}</h3>
          <p className={styles.sectionNote}>{note}</p>
        </div>
        <div className={styles.pillRow}>
          <span className={`${styles.metricPill} ${styles.metricAdded}`}>
            {summaryValue(tokenComparison.added, "added")}
          </span>
          <span className={`${styles.metricPill} ${styles.metricRemoved}`}>
            {summaryValue(tokenComparison.removed, "removed")}
          </span>
          <span className={`${styles.metricPill} ${styles.metricChanged}`}>
            {summaryValue(tokenComparison.changed, "changed")}
          </span>
        </div>
      </div>

      {visibleEntries.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.resultTable}>
            <colgroup>
              <col className={styles.nameColumn} />
              <col className={styles.statusColumn} />
              <col className={styles.pathColumn} />
              <col className={styles.previewColumn} />
              <col className={styles.previewColumn} />
              <col className={styles.inspectColumn} />
            </colgroup>
            <thead>
              <tr>
                <th>Name</th>
                <th className={styles.statusCell}>Status</th>
                <th>Path</th>
                <th>Before</th>
                <th>After</th>
                <th className={styles.inspectColumn}>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => {
                const canInspectXml =
                  entry.status !== "unchanged" &&
                  entry.status !== "removed" &&
                  Boolean(getXmlLikeValue(entry.beforeValue) || getXmlLikeValue(entry.afterValue));

                return (
                  <tr key={entry.id}>
                    <td className={styles.nameCell}>{entry.name}</td>
                    <td className={styles.statusCell}>
                      <span className={`${styles.statusChip} ${statusClassName(entry.status)}`}>
                        {toStatusLabel(entry.status)}
                      </span>
                    </td>
                    <td className={styles.pathCell}>{entry.path}</td>
                    <td className={styles.previewCell}>{entry.beforePreview || "-"}</td>
                    <td className={styles.previewCell}>{entry.afterPreview || "-"}</td>
                    <td className={styles.inspectColumn}>
                      {canInspectXml ? (
                        <button
                          className={`secondary-button compact-button ${styles.inspectAction}`}
                          onClick={() => onOpenXmlInspector(entry)}
                          type="button"
                        >
                          View XML
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.emptyCopy}>
          {viewMode === "changed"
            ? "No changed entries were found for this section."
            : "No extracted entries were found for this section."}
        </p>
      )}
    </section>
  );
}

export default function ComparePage() {
  const [leftFile, setLeftFile] = useState<File | null>(null);
  const [rightFile, setRightFile] = useState<File | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [viewMode, setViewMode] = useState<ComparisonViewMode>("changed");
  const [xmlInspector, setXmlInspector] = useState<XmlInspectorState | null>(null);

  const canCompare = Boolean(leftFile && rightFile && !isComparing);
  const compareLabel = isComparing ? "Comparing catalogs..." : "Compare Catalogs";

  const generatedAtLabel = useMemo(() => {
    if (!result) {
      return "";
    }

    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(result.generatedAt));
  }, [result]);

  function clearResult() {
    setResult(null);
    setErrorMessage("");
    setXmlInspector(null);
  }

  function onLeftFileChange(event: ChangeEvent<HTMLInputElement>) {
    clearResult();
    const nextFile = event.target.files?.[0] ?? null;

    if (nextFile && !isValidCatalogBundle(nextFile)) {
      event.target.value = "";
      setLeftFile(null);
      setErrorMessage("Select a valid .xdrz catalog file.");
      return;
    }

    setLeftFile(nextFile);
  }

  function onRightFileChange(event: ChangeEvent<HTMLInputElement>) {
    clearResult();
    const nextFile = event.target.files?.[0] ?? null;

    if (nextFile && !isValidCatalogBundle(nextFile)) {
      event.target.value = "";
      setRightFile(null);
      setErrorMessage("Select a valid .xdrz catalog file.");
      return;
    }

    setRightFile(nextFile);
  }

  async function runComparison() {
    if (!leftFile || !rightFile) {
      setErrorMessage("Select both files before starting the comparison.");
      return;
    }

    if (!isValidCatalogBundle(leftFile) || !isValidCatalogBundle(rightFile)) {
      setErrorMessage("Select a valid .xdrz catalog file.");
      return;
    }

    setIsComparing(true);
    setErrorMessage("");

    try {
      const [leftBundle, rightBundle] = await Promise.all([
        parseUploadedBundle(leftFile),
        parseUploadedBundle(rightFile)
      ]);

      setResult(compareBundles(leftBundle, rightBundle));
      setXmlInspector(null);
    } catch (error) {
      setResult(null);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsComparing(false);
    }
  }

  function openXmlInspector(entry: TokenComparisonEntry) {
    setXmlInspector({
      heading: entry.name,
      path: entry.path,
      beforeValue: entry.beforeValue,
      afterValue: entry.afterValue
    });
  }

  function openXmlInspectorWithPayload(payload: XmlInspectorPayload) {
    setXmlInspector(payload);
  }

  function closeXmlInspector() {
    setXmlInspector(null);
  }

  return (
    <main className={`page-shell ${styles.compareShell}`}>
      <section className={`surface ${styles.heroCard}`}>
        <div className={styles.heroTop}>
          <div>
            <h1>Compare Catalogs</h1>
            <p className={styles.heroSubtitle}>Upload and compare two Catalogs</p>
          </div>
          <button className="ghost-button compact-button" type="button" onClick={() => (window.location.href = "/")}>
            Back to workspace
          </button>
        </div>

        <div className={styles.uploadGrid}>
          <label className={styles.uploadCard}>
            <span className={styles.uploadTitle}>Baseline file</span>
            <input accept=".xdrz" type="file" onChange={onLeftFileChange} />
            {leftFile ? (
              <p className={styles.fileMeta}>
                <strong>{leftFile.name}</strong>
                <span>{formatBytes(leftFile.size)}</span>
              </p>
            ) : (
              <p className={styles.fileMeta}>select .xdrz catalog file</p>
            )}
          </label>

          <label className={styles.uploadCard}>
            <span className={styles.uploadTitle}>Target file</span>
            <input accept=".xdrz" type="file" onChange={onRightFileChange} />
            {rightFile ? (
              <p className={styles.fileMeta}>
                <strong>{rightFile.name}</strong>
                <span>{formatBytes(rightFile.size)}</span>
              </p>
            ) : (
              <p className={styles.fileMeta}>select .xdrz catalog file</p>
            )}
          </label>
        </div>

        <div className={styles.actionRow}>
          <button className="primary-button" disabled={!canCompare} onClick={runComparison} type="button">
            {compareLabel}
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              setLeftFile(null);
              setRightFile(null);
              clearResult();
            }}
            type="button"
          >
            Reset
          </button>
        </div>

        {errorMessage ? <p className={styles.errorBanner}>{errorMessage}</p> : null}
      </section>

      {result ? (
        <section className={styles.resultsStack}>
          <section className={`surface ${styles.resultMetaCard}`}>
            <div className={styles.resultMetaTop}>
              <div>
                <p className="section-label">Generated</p>
                <h2>{generatedAtLabel}</h2>
              </div>
              <div className={styles.resultFilterGroup} role="toolbar" aria-label="Comparison filter">
                <button
                  aria-pressed={viewMode === "changed"}
                  className={`${styles.resultFilterButton}${viewMode === "changed" ? ` ${styles.resultFilterButtonActive}` : ""}`}
                  onClick={() => setViewMode("changed")}
                  type="button"
                >
                  Changed
                </button>
                <button
                  aria-pressed={viewMode === "all"}
                  className={`${styles.resultFilterButton}${viewMode === "all" ? ` ${styles.resultFilterButtonActive}` : ""}`}
                  onClick={() => setViewMode("all")}
                  type="button"
                >
                  All
                </button>
              </div>
            </div>
            <div className={styles.bundleMetaGrid}>
              <div className={styles.bundleMetaCard}>
                <p className="meta-label">Baseline</p>
                <strong>{result.left.sourceName}</strong>
                <small>
                  {summaryValue(result.left.extractedCount, "extracted text file")}
                  {" | "}
                  {summaryValue(result.left.skippedCount, "skipped")}
                </small>
              </div>
              <div className={styles.bundleMetaCard}>
                <p className="meta-label">Target</p>
                <strong>{result.right.sourceName}</strong>
                <small>
                  {summaryValue(result.right.extractedCount, "extracted text file")}
                  {" | "}
                  {summaryValue(result.right.skippedCount, "skipped")}
                </small>
              </div>
            </div>
          </section>

          {result.warnings.length > 0 ? (
            <section className={`surface ${styles.warningCard}`}>
              <p className="section-label">Extraction warnings</p>
              <ul className={styles.warningList}>
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <CategorySection
            heading="Data model changes"
            note="Files matched by model-oriented names, paths, or content markers."
            category={result.categories.dataModel}
            viewMode={viewMode}
            onOpenXmlInspector={openXmlInspectorWithPayload}
          />
          <CategorySection
            heading="Catalog changes"
            note="Files matched by catalog-oriented names, paths, or content markers."
            category={result.categories.catalogs}
            viewMode={viewMode}
            onOpenXmlInspector={openXmlInspectorWithPayload}
          />
          <TokenSection
            heading="Query changes"
            note="Extracted from SQL files, XML query tags, and SQL-like statements."
            tokenComparison={result.queries}
            viewMode={viewMode}
            onOpenXmlInspector={openXmlInspector}
          />
          <TokenSection
            heading="Property changes"
            note="Extracted from properties files, config-style key/value lines, XML entries, and JSON keys."
            tokenComparison={result.properties}
            viewMode={viewMode}
            onOpenXmlInspector={openXmlInspector}
          />
        </section>
      ) : null}

      {xmlInspector ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={closeXmlInspector}>
          <div
            className={`surface ${styles.xmlModal}`}
            role="dialog"
            aria-label={`${xmlInspector.heading} XML inspector`}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.xmlModalHeader}>
              <div className={styles.xmlModalTitleBlock}>
                <h2>{xmlInspector.heading}</h2>
                <p className={styles.xmlModalPath}>{xmlInspector.path}</p>
              </div>
              <button className="ghost-button compact-button" onClick={closeXmlInspector} type="button">
                Close
              </button>
            </div>

            <div className={styles.xmlModalColumns}>
              <CodePane heading="Before" value={xmlInspector.beforeValue} />
              <CodePane heading="After" value={xmlInspector.afterValue} />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

