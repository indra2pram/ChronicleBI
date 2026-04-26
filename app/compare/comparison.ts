import JSZip from "jszip";

export type ComparisonCategory = "dataModel" | "catalogs" | "other";
export type ComparisonStatus = "added" | "removed" | "changed" | "unchanged";

export interface ParsedBundleFile {
  path: string;
  category: ComparisonCategory;
  content: string;
  size: number;
  hash: string;
}

export interface SkippedBundleFile {
  path: string;
  size: number;
  reason: string;
}

export interface ParsedBundle {
  sourceName: string;
  files: ParsedBundleFile[];
  skippedFiles: SkippedBundleFile[];
  warnings: string[];
}

export interface FileLineDelta {
  added: number;
  removed: number;
  changed: number;
}

export interface FileComparisonEntry {
  path: string;
  category: ComparisonCategory;
  status: ComparisonStatus;
  beforeSize: number;
  afterSize: number;
  lineDelta: FileLineDelta;
}

export interface CategoryComparison {
  total: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  entries: FileComparisonEntry[];
}

export interface TokenComparisonEntry {
  id: string;
  path: string;
  name: string;
  status: ComparisonStatus;
  beforePreview: string;
  afterPreview: string;
}

export interface TokenComparison {
  total: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  entries: TokenComparisonEntry[];
}

export interface BundleMeta {
  sourceName: string;
  extractedCount: number;
  skippedCount: number;
}

export interface ComparisonResult {
  generatedAt: string;
  left: BundleMeta;
  right: BundleMeta;
  categories: Record<ComparisonCategory, CategoryComparison>;
  queries: TokenComparison;
  properties: TokenComparison;
  warnings: string[];
}

interface ExtractionContext {
  files: ParsedBundleFile[];
  skippedFiles: SkippedBundleFile[];
  warnings: string[];
}

interface ExtractedToken {
  id: string;
  path: string;
  name: string;
  value: string;
  preview: string;
}

const MAX_RECURSION_DEPTH = 8;
const MAX_EXTRACTED_FILES = 4000;
const MAX_TEXT_FILE_BYTES = 2_500_000;

const textExtensions = new Set([
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".sql",
  ".qry",
  ".query",
  ".json",
  ".xml",
  ".xsd",
  ".xsl",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".properties",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".html",
  ".htm",
  ".css",
  ".scss"
]);

function normalizePath(input: string) {
  return input.replace(/\\/g, "/").replace(/\/\/+/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function getExtension(filePath: string) {
  const normalized = normalizePath(filePath).toLowerCase();
  const lastSlashIndex = normalized.lastIndexOf("/");
  const fileName = lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized;
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex < 0) {
    return "";
  }

  return fileName.slice(dotIndex);
}

function cleanLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function hashString(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isZip(bytes: Uint8Array, sourceName: string) {
  if (sourceName.toLowerCase().endsWith(".zip")) {
    return true;
  }

  if (bytes.length < 4) {
    return false;
  }

  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

function decodeText(bytes: Uint8Array, filePath: string) {
  const extension = getExtension(filePath);
  const forceText = textExtensions.has(extension);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  if (decoded.includes("\u0000")) {
    return null;
  }

  const replacementMatches = decoded.match(/\uFFFD/g);
  const replacementRatio = (replacementMatches?.length ?? 0) / Math.max(decoded.length, 1);

  if (!forceText && replacementRatio > 0.02) {
    return null;
  }

  let cleaned = decoded;

  if (cleaned.startsWith("\uFEFF")) {
    cleaned = cleaned.slice(1);
  }

  return cleanLineEndings(cleaned);
}

function classifyCategory(filePath: string, content: string): ComparisonCategory {
  const normalizedPath = normalizePath(filePath).toLowerCase();
  const extension = getExtension(normalizedPath);

  if (
    normalizedPath.includes("data-model") ||
    normalizedPath.includes("data_model") ||
    normalizedPath.includes("datamodel") ||
    normalizedPath.includes("/model/") ||
    extension === ".xdm" ||
    extension === ".xdmz" ||
    extension === ".rpd"
  ) {
    return "dataModel";
  }

  if (
    normalizedPath.includes("/report") ||
    normalizedPath.includes("report/") ||
    normalizedPath.includes("reports/") ||
    extension === ".xdo" ||
    extension === ".rdl" ||
    extension === ".jrxml"
  ) {
    return "catalogs";
  }

  if (/<\s*dataModel\b/i.test(content) || /semantic model/i.test(content)) {
    return "dataModel";
  }

  if (/<\s*report\b/i.test(content) || /report definition/i.test(content)) {
    return "catalogs";
  }

  return "other";
}

function createLineDelta(before: string, after: string): FileLineDelta {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const added = afterLines.reduce((count, line) => count + (beforeSet.has(line) ? 0 : 1), 0);
  const removed = beforeLines.reduce((count, line) => count + (afterSet.has(line) ? 0 : 1), 0);

  let changed = 0;
  const maxLength = Math.max(beforeLines.length, afterLines.length);

  for (let index = 0; index < maxLength; index += 1) {
    if ((beforeLines[index] ?? "") !== (afterLines[index] ?? "")) {
      changed += 1;
    }
  }

  return { added, removed, changed };
}

function collectWarnings(context: ExtractionContext, warning: string) {
  if (!context.warnings.includes(warning)) {
    context.warnings.push(warning);
  }
}

function addSkippedFile(context: ExtractionContext, nextFile: SkippedBundleFile) {
  context.skippedFiles.push(nextFile);
}

function addExtractedFile(context: ExtractionContext, nextFile: ParsedBundleFile) {
  context.files.push(nextFile);
}

function shouldStopExtraction(context: ExtractionContext) {
  return context.files.length >= MAX_EXTRACTED_FILES;
}

async function processBytes(
  context: ExtractionContext,
  bytes: Uint8Array,
  virtualPath: string,
  depth: number
): Promise<void> {
  if (shouldStopExtraction(context)) {
    collectWarnings(
      context,
      `Extraction was capped at ${MAX_EXTRACTED_FILES} text files to keep the compare view responsive.`
    );
    return;
  }

  if (depth > MAX_RECURSION_DEPTH) {
    addSkippedFile(context, {
      path: virtualPath,
      size: bytes.length,
      reason: `Nested zip depth exceeded ${MAX_RECURSION_DEPTH}.`
    });
    return;
  }

  const likelyZip = isZip(bytes, virtualPath);

  if (likelyZip) {
    try {
      const archive = await JSZip.loadAsync(bytes);
      const zipEntries = Object.values(archive.files).filter((entry) => !entry.dir);

      if (zipEntries.length === 0) {
        collectWarnings(context, `Archive ${virtualPath} did not contain any files.`);
      }

      for (const entry of zipEntries) {
        if (shouldStopExtraction(context)) {
          break;
        }

        const entryBytes = await entry.async("uint8array");
        const nestedPath = normalizePath(`${virtualPath}/${entry.name}`);
        await processBytes(context, entryBytes, nestedPath, depth + 1);
      }

      return;
    } catch (_error) {
      collectWarnings(
        context,
        `Could not read ${virtualPath} as a zip archive. It was processed as a normal file instead.`
      );
    }
  }

  if (bytes.length > MAX_TEXT_FILE_BYTES) {
    addSkippedFile(context, {
      path: virtualPath,
      size: bytes.length,
      reason: `File is larger than ${Math.round(MAX_TEXT_FILE_BYTES / 1_000_000)} MB.`
    });
    return;
  }

  const decoded = decodeText(bytes, virtualPath);

  if (decoded === null) {
    addSkippedFile(context, {
      path: virtualPath,
      size: bytes.length,
      reason: "Binary or unsupported text encoding."
    });
    return;
  }

  addExtractedFile(context, {
    path: virtualPath,
    category: classifyCategory(virtualPath, decoded),
    content: decoded,
    size: bytes.length,
    hash: hashString(decoded)
  });
}

function sortFiles<T extends { path: string }>(files: T[]) {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

function trimRootPrefix(pathValue: string, rootName: string) {
  const normalizedPath = normalizePath(pathValue);
  const normalizedRoot = normalizePath(rootName);

  if (
    normalizedRoot &&
    normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)
  ) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath;
}

function normalizeQuery(value: string) {
  const withoutBlockComments = value.replace(/\/\*[\s\S]*?\*\//g, " ");
  const withoutLineComments = withoutBlockComments.replace(/--.*$/gm, " ");
  return withoutLineComments.replace(/\s+/g, " ").trim();
}

function preview(value: string) {
  const collapsed = value.replace(/\s+/g, " ").trim();

  if (collapsed.length <= 140) {
    return collapsed;
  }

  return `${collapsed.slice(0, 137)}...`;
}

function extractNameAttribute(rawAttributes: string) {
  const attributeMatch = rawAttributes.match(/\bname\s*=\s*"([^"]+)"/i);

  if (attributeMatch?.[1]) {
    return attributeMatch[1].trim();
  }

  return null;
}

function stripCdata(value: string) {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function extractQueriesFromFile(file: ParsedBundleFile) {
  const queryCandidates: Array<{ name: string; value: string }> = [];
  const extension = getExtension(file.path);
  let index = 0;

  if (extension === ".sql" || extension === ".qry" || extension === ".query") {
    queryCandidates.push({
      name: "statement-1",
      value: normalizeQuery(file.content)
    });
  }

  const xmlQueryRegex = /<(query|sql)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let xmlMatch = xmlQueryRegex.exec(file.content);

  while (xmlMatch) {
    index += 1;
    const rawName = extractNameAttribute(xmlMatch[2]);
    const cleaned = normalizeQuery(stripCdata(xmlMatch[3]));

    if (cleaned) {
      queryCandidates.push({
        name: rawName || `xml-query-${index}`,
        value: cleaned
      });
    }

    xmlMatch = xmlQueryRegex.exec(file.content);
  }

  if (queryCandidates.length === 0 && /\b(select|with|insert|update|delete|merge)\b/i.test(file.content)) {
    const statements = file.content
      .split(/;\s*(?:\n|$)/g)
      .map((statement) => normalizeQuery(statement))
      .filter((statement) => /\b(select|with|insert|update|delete|merge)\b/i.test(statement))
      .slice(0, 20);

    statements.forEach((statement, statementIndex) => {
      queryCandidates.push({
        name: `statement-${statementIndex + 1}`,
        value: statement
      });
    });
  }

  const deduped = new Map<string, string>();

  queryCandidates.forEach((candidate) => {
    if (!candidate.value) {
      return;
    }

    deduped.set(candidate.name, candidate.value);
  });

  return [...deduped.entries()].map(([name, value]) => ({
    name,
    value
  }));
}

function flattenJsonValues(input: unknown, prefix = "", output: Array<{ name: string; value: string }> = []) {
  if (Array.isArray(input)) {
    input.forEach((value, index) => {
      flattenJsonValues(value, `${prefix}[${index}]`, output);
    });
    return output;
  }

  if (input && typeof input === "object") {
    Object.entries(input).forEach(([key, value]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenJsonValues(value, nextPrefix, output);
    });
    return output;
  }

  output.push({
    name: prefix || "value",
    value: String(input ?? "")
  });

  return output;
}

function extractPropertiesFromFile(file: ParsedBundleFile) {
  const entries: Array<{ name: string; value: string }> = [];
  const extension = getExtension(file.path);

  if (extension === ".json") {
    try {
      const parsed = JSON.parse(file.content);
      entries.push(...flattenJsonValues(parsed));
    } catch (_error) {
      // Continue with line-based parsing fallback.
    }
  }

  const lineRegex = /^\s*([A-Za-z0-9_.\-[\]]+)\s*[:=]\s*(.+?)\s*$/gm;
  let lineMatch = lineRegex.exec(file.content);

  while (lineMatch) {
    const key = lineMatch[1].trim();
    const value = lineMatch[2].trim();

    if (!value.startsWith("//") && !key.startsWith("#") && !key.startsWith(";")) {
      entries.push({
        name: key,
        value
      });
    }

    lineMatch = lineRegex.exec(file.content);
  }

  const xmlPropertyRegex =
    /<(property|entry)\b[^>]*(?:name|key)\s*=\s*"([^"]+)"[^>]*(?:value\s*=\s*"([^"]*)")?[^>]*>([^<]*)<\/\1>/gi;
  let xmlMatch = xmlPropertyRegex.exec(file.content);

  while (xmlMatch) {
    const key = xmlMatch[2].trim();
    const value = (xmlMatch[3] || xmlMatch[4] || "").trim();

    entries.push({
      name: key,
      value
    });

    xmlMatch = xmlPropertyRegex.exec(file.content);
  }

  const deduped = new Map<string, string>();

  entries.forEach((entry) => {
    if (!entry.name) {
      return;
    }

    deduped.set(entry.name, entry.value);
  });

  return [...deduped.entries()].map(([name, value]) => ({
    name,
    value
  }));
}

function shouldInspectProperties(file: ParsedBundleFile) {
  const normalized = normalizePath(file.path).toLowerCase();
  const extension = getExtension(normalized);

  if (
    normalized.includes("properties") ||
    normalized.includes("/config") ||
    normalized.includes("/settings")
  ) {
    return true;
  }

  return [
    ".properties",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".xml"
  ].includes(extension);
}

function collectQueryTokens(files: ParsedBundleFile[]) {
  const tokenMap = new Map<string, ExtractedToken>();

  files.forEach((file) => {
    extractQueriesFromFile(file).forEach((query) => {
      const id = `${file.path}::${query.name}`;
      const normalizedValue = normalizeQuery(query.value);

      tokenMap.set(id, {
        id,
        path: file.path,
        name: query.name,
        value: normalizedValue,
        preview: preview(normalizedValue)
      });
    });
  });

  return tokenMap;
}

function collectPropertyTokens(files: ParsedBundleFile[]) {
  const tokenMap = new Map<string, ExtractedToken>();

  files.forEach((file) => {
    if (!shouldInspectProperties(file)) {
      return;
    }

    extractPropertiesFromFile(file).forEach((property) => {
      const id = `${file.path}::${property.name}`;
      const normalizedValue = property.value.trim();

      tokenMap.set(id, {
        id,
        path: file.path,
        name: property.name,
        value: normalizedValue,
        preview: preview(normalizedValue)
      });
    });
  });

  return tokenMap;
}

function compareTokens(beforeMap: Map<string, ExtractedToken>, afterMap: Map<string, ExtractedToken>) {
  const allIds = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort((left, right) =>
    left.localeCompare(right)
  );

  const entries: TokenComparisonEntry[] = allIds.map((id) => {
    const before = beforeMap.get(id);
    const after = afterMap.get(id);

    if (!before && after) {
      return {
        id,
        path: after.path,
        name: after.name,
        status: "added",
        beforePreview: "",
        afterPreview: after.preview
      };
    }

    if (before && !after) {
      return {
        id,
        path: before.path,
        name: before.name,
        status: "removed",
        beforePreview: before.preview,
        afterPreview: ""
      };
    }

    const status = before?.value === after?.value ? "unchanged" : "changed";

    return {
      id,
      path: before?.path || after?.path || "",
      name: before?.name || after?.name || "value",
      status,
      beforePreview: before?.preview || "",
      afterPreview: after?.preview || ""
    };
  });

  return {
    total: entries.length,
    added: entries.filter((entry) => entry.status === "added").length,
    removed: entries.filter((entry) => entry.status === "removed").length,
    changed: entries.filter((entry) => entry.status === "changed").length,
    unchanged: entries.filter((entry) => entry.status === "unchanged").length,
    entries
  };
}

function summarizeCategory(entries: FileComparisonEntry[]) {
  return {
    total: entries.length,
    added: entries.filter((entry) => entry.status === "added").length,
    removed: entries.filter((entry) => entry.status === "removed").length,
    changed: entries.filter((entry) => entry.status === "changed").length,
    unchanged: entries.filter((entry) => entry.status === "unchanged").length,
    entries
  };
}

function compareFiles(left: ParsedBundleFile[], right: ParsedBundleFile[]): FileComparisonEntry[] {
  const leftByPath = new Map(left.map((entry) => [entry.path, entry]));
  const rightByPath = new Map(right.map((entry) => [entry.path, entry]));
  const allPaths = [...new Set([...leftByPath.keys(), ...rightByPath.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );

  return allPaths.map((path) => {
    const before = leftByPath.get(path);
    const after = rightByPath.get(path);

    if (!before && after) {
      return {
        path,
        category: after.category,
        status: "added" as const,
        beforeSize: 0,
        afterSize: after.size,
        lineDelta: {
          added: after.content.split("\n").length,
          removed: 0,
          changed: 0
        }
      };
    }

    if (before && !after) {
      return {
        path,
        category: before.category,
        status: "removed" as const,
        beforeSize: before.size,
        afterSize: 0,
        lineDelta: {
          added: 0,
          removed: before.content.split("\n").length,
          changed: 0
        }
      };
    }

    const status: ComparisonStatus = before?.hash === after?.hash ? "unchanged" : "changed";

    return {
      path,
      category: after?.category ?? before?.category ?? "other",
      status,
      beforeSize: before?.size ?? 0,
      afterSize: after?.size ?? 0,
      lineDelta: createLineDelta(before?.content ?? "", after?.content ?? "")
    };
  });
}

export async function parseUploadedBundle(file: File): Promise<ParsedBundle> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const rootPath = normalizePath(file.name);
  const context: ExtractionContext = {
    files: [],
    skippedFiles: [],
    warnings: []
  };

  await processBytes(context, bytes, rootPath, 0);

  const files = context.files.map((entry) => ({
    ...entry,
    path: trimRootPrefix(entry.path, rootPath)
  }));
  const skippedFiles = context.skippedFiles.map((entry) => ({
    ...entry,
    path: trimRootPrefix(entry.path, rootPath)
  }));

  return {
    sourceName: file.name,
    files: sortFiles(files),
    skippedFiles: sortFiles(skippedFiles),
    warnings: [...context.warnings]
  };
}

export function compareBundles(left: ParsedBundle, right: ParsedBundle): ComparisonResult {
  const fileEntries = compareFiles(left.files, right.files);
  const dataModelEntries = fileEntries.filter((entry) => entry.category === "dataModel");
  const catalogEntries = fileEntries.filter((entry) => entry.category === "catalogs");
  const otherEntries = fileEntries.filter((entry) => entry.category === "other");
  const queries = compareTokens(collectQueryTokens(left.files), collectQueryTokens(right.files));
  const properties = compareTokens(
    collectPropertyTokens(left.files),
    collectPropertyTokens(right.files)
  );

  const warnings = [...left.warnings, ...right.warnings];

  if (left.files.length === 0) {
    warnings.push(`No readable text files were extracted from ${left.sourceName}.`);
  }

  if (right.files.length === 0) {
    warnings.push(`No readable text files were extracted from ${right.sourceName}.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    left: {
      sourceName: left.sourceName,
      extractedCount: left.files.length,
      skippedCount: left.skippedFiles.length
    },
    right: {
      sourceName: right.sourceName,
      extractedCount: right.files.length,
      skippedCount: right.skippedFiles.length
    },
    categories: {
      dataModel: summarizeCategory(dataModelEntries),
      catalogs: summarizeCategory(catalogEntries),
      other: summarizeCategory(otherEntries)
    },
    queries,
    properties,
    warnings
  };
}

export function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}
