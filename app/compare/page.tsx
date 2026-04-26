"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  compareBundles,
  formatBytes,
  parseUploadedBundle,
  type CategoryComparison,
  type ComparisonResult,
  type ComparisonStatus,
  type TokenComparison
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

function CategorySection({
  heading,
  note,
  category
}: Readonly<{
  heading: string;
  note: string;
  category: CategoryComparison;
}>) {
  return (
    <section className={`surface ${styles.sectionCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <p className="section-label">{heading}</p>
          <h3>{summaryValue(category.total, "file")}</h3>
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

      {category.entries.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.resultTable}>
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Before</th>
                <th>After</th>
                <th>Line delta</th>
              </tr>
            </thead>
            <tbody>
              {category.entries.map((entry) => (
                <tr key={entry.path}>
                  <td className={styles.pathCell}>{entry.path}</td>
                  <td>
                    <span className={`${styles.statusChip} ${statusClassName(entry.status)}`}>
                      {toStatusLabel(entry.status)}
                    </span>
                  </td>
                  <td>{entry.beforeSize ? formatBytes(entry.beforeSize) : "-"}</td>
                  <td>{entry.afterSize ? formatBytes(entry.afterSize) : "-"}</td>
                  <td>
                    +{entry.lineDelta.added} / -{entry.lineDelta.removed} / ~{entry.lineDelta.changed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.emptyCopy}>No files were classified in this category.</p>
      )}
    </section>
  );
}

function TokenSection({
  heading,
  note,
  tokenComparison
}: Readonly<{
  heading: string;
  note: string;
  tokenComparison: TokenComparison;
}>) {
  return (
    <section className={`surface ${styles.sectionCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <p className="section-label">{heading}</p>
          <h3>{summaryValue(tokenComparison.total, "item")}</h3>
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

      {tokenComparison.entries.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.resultTable}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Path</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {tokenComparison.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.name}</td>
                  <td>
                    <span className={`${styles.statusChip} ${statusClassName(entry.status)}`}>
                      {toStatusLabel(entry.status)}
                    </span>
                  </td>
                  <td className={styles.pathCell}>{entry.path}</td>
                  <td>{entry.beforePreview || "-"}</td>
                  <td>{entry.afterPreview || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.emptyCopy}>No extracted entries were found for this section.</p>
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

  const canCompare = Boolean(leftFile && rightFile && !isComparing);
  const compareLabel = isComparing ? "Comparing files..." : "Compare bundles";

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
  }

  function onLeftFileChange(event: ChangeEvent<HTMLInputElement>) {
    setLeftFile(event.target.files?.[0] ?? null);
    clearResult();
  }

  function onRightFileChange(event: ChangeEvent<HTMLInputElement>) {
    setRightFile(event.target.files?.[0] ?? null);
    clearResult();
  }

  async function runComparison() {
    if (!leftFile || !rightFile) {
      setErrorMessage("Select both files before starting the comparison.");
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
    } catch (error) {
      setResult(null);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsComparing(false);
    }
  }

  return (
    <main className={`page-shell ${styles.compareShell}`}>
      <section className={`surface ${styles.heroCard}`}>
        <div className={styles.heroTop}>
          <div>
            <p className="section-label">Bundle comparison</p>
            <h1>Upload and compare two artifacts</h1>
            <p className={styles.heroCopy}>
              Upload any two files. If a file is a zip, nested zip content is unpacked recursively
              and text files are compared by path. The comparison includes Data Model and Catalogs plus
              Query and Property changes.
            </p>
          </div>
          <button className="ghost-button compact-button" type="button" onClick={() => (window.location.href = "/")}>
            Back to workspace
          </button>
        </div>

        <div className={styles.uploadGrid}>
          <label className={styles.uploadCard}>
            <span className={styles.uploadTitle}>Baseline file</span>
            <input type="file" onChange={onLeftFileChange} />
            {leftFile ? (
              <p className={styles.fileMeta}>
                <strong>{leftFile.name}</strong>
                <span>{formatBytes(leftFile.size)}</span>
              </p>
            ) : (
              <p className={styles.fileMeta}>Select source file or zip.</p>
            )}
          </label>

          <label className={styles.uploadCard}>
            <span className={styles.uploadTitle}>Target file</span>
            <input type="file" onChange={onRightFileChange} />
            {rightFile ? (
              <p className={styles.fileMeta}>
                <strong>{rightFile.name}</strong>
                <span>{formatBytes(rightFile.size)}</span>
              </p>
            ) : (
              <p className={styles.fileMeta}>Select target file or zip.</p>
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
            <div>
              <p className="section-label">Generated</p>
              <h2>{generatedAtLabel}</h2>
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
          />
          <CategorySection
            heading="Catalog changes"
            note="Files matched by catalog-oriented names, paths, or content markers."
            category={result.categories.catalogs}
          />
          <TokenSection
            heading="Query changes"
            note="Extracted from SQL files, XML query tags, and SQL-like statements."
            tokenComparison={result.queries}
          />
          <TokenSection
            heading="Property changes"
            note="Extracted from properties files, config-style key/value lines, XML entries, and JSON keys."
            tokenComparison={result.properties}
          />
        </section>
      ) : null}
    </main>
  );
}

