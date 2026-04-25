const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { readProjectState } = require("./project-store");
const JSZip = require("jszip");

const DEFAULT_CATALOG_PATH = "/xmlpserver/services/v2/CatalogService";
const MAX_NESTED_ARCHIVE_DEPTH = 12;
const MAX_EXTRACTED_FILE_COUNT = 15000;
const MAX_ANALYZED_TEXT_BYTES = 12 * 1024 * 1024;
const MAX_SQL_PREVIEW_CHARS = 800;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeServiceEndpoint(rawUrl) {
  const trimmedUrl = String(rawUrl ?? "").trim();

  if (!trimmedUrl) {
    throw new Error("Connection URL is missing.");
  }

  let parsedUrl = null;

  try {
    parsedUrl = new URL(trimmedUrl);
  } catch (_error) {
    throw new Error("Connection URL is invalid. Expected a valid http or https URL.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Connection URL is invalid. Expected a valid http or https URL.");
  }

  parsedUrl.search = "";
  parsedUrl.hash = "";

  const normalizedPath = parsedUrl.pathname.replace(/\/+$/g, "");
  const lowerPath = normalizedPath.toLowerCase();

  if (lowerPath.endsWith("/catalogservice")) {
    return `${parsedUrl.origin}${normalizedPath}`;
  }

  if (lowerPath.endsWith("/xmlpserver/services/v2")) {
    return `${parsedUrl.origin}${normalizedPath}/CatalogService`;
  }

  if (lowerPath.endsWith("/xmlpserver")) {
    return `${parsedUrl.origin}${normalizedPath}/services/v2/CatalogService`;
  }

  if (lowerPath.includes("/xmlpserver/services/") && lowerPath.includes("catalogservice")) {
    return `${parsedUrl.origin}${normalizedPath}`;
  }

  return `${parsedUrl.origin}${DEFAULT_CATALOG_PATH}`;
}

function buildSoapEnvelope(reportPath, username, password, fieldNames) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:downloadObject>
      <v2:${fieldNames.pathField}>${escapeXml(reportPath)}</v2:${fieldNames.pathField}>
      <v2:${fieldNames.userField}>${escapeXml(username)}</v2:${fieldNames.userField}>
      <v2:${fieldNames.passwordField}>${escapeXml(password)}</v2:${fieldNames.passwordField}>
    </v2:downloadObject>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function extractSoapFault(responseText) {
  const faultMatch = responseText.match(
    /<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i
  );

  if (faultMatch?.[1]) {
    return decodeXmlEntities(faultMatch[1].trim());
  }

  if (/<(?:\w+:)?Fault\b/i.test(responseText)) {
    return "SOAP fault was returned by the server.";
  }

  return null;
}

function extractDownloadObjectReturn(responseText) {
  const match = responseText.match(
    /<(?:\w+:)?downloadObjectReturn[^>]*>([\s\S]*?)<\/(?:\w+:)?downloadObjectReturn>/i
  );

  if (match && typeof match[1] === "string") {
    return decodeXmlEntities(match[1].trim());
  }

  return null;
}

function summarizeResponse(responseText) {
  return responseText.replace(/\s+/g, " ").trim().slice(0, 2000);
}

function getDecodedSize(base64Payload) {
  const normalized = base64Payload.replace(/\s+/g, "");

  if (!normalized) {
    return 0;
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    return null;
  }

  try {
    return Buffer.from(normalized, "base64").length;
  } catch (_error) {
    return null;
  }
}

function isZipBuffer(buffer) {
  if (!buffer || buffer.length < 4) {
    return false;
  }

  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  );
}

function isLikelyUtf8Text(buffer, textContent) {
  if (!buffer || buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let nullByteCount = 0;

  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) {
      nullByteCount += 1;
    }
  }

  if (nullByteCount > 0) {
    return false;
  }

  const replacementCount = (textContent.match(/\uFFFD/g) ?? []).length;
  const replacementRatio = replacementCount / Math.max(textContent.length, 1);

  return replacementRatio < 0.02;
}

function detectPayloadFormat(buffer, textContent, likelyText) {
  if (isZipBuffer(buffer)) {
    return "zip";
  }

  if (!likelyText) {
    return "binary";
  }

  const trimmed = textContent.trimStart();

  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
    return "xml";
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch (_error) {
      return "text";
    }
  }

  return "text";
}

function countSqlSignals(textContent) {
  const queryTagCount = (textContent.match(/<\s*(query|sql)\b/gi) ?? []).length;
  const keywordCount = (
    textContent.match(/\b(select|with|insert|update|delete|merge)\b/gi) ?? []
  ).length;

  return queryTagCount + keywordCount;
}

function countPropertySignals(textContent) {
  const lineMatches = textContent.match(/^[ \t]*[A-Za-z0-9_.\-[\]]+[ \t]*[:=][ \t]*.+$/gm) ?? [];
  return lineMatches.length;
}

function extractXmlRootTag(textContent) {
  const match = textContent.match(/<\s*([A-Za-z_][A-Za-z0-9_.:-]*)\b[^>]*>/);
  return match?.[1] ?? null;
}

function getFileExtension(filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  const lastName = normalized.split("/").pop() ?? normalized;
  const dotIndex = lastName.lastIndexOf(".");

  if (dotIndex < 0) {
    return "";
  }

  return lastName.slice(dotIndex).toLowerCase();
}

function extensionLooksText(extension) {
  return new Set([
    ".txt",
    ".xml",
    ".xdo",
    ".xsd",
    ".xsl",
    ".xquery",
    ".sql",
    ".csv",
    ".json",
    ".yaml",
    ".yml",
    ".properties",
    ".cfg",
    ".ini",
    ".html",
    ".htm",
    ".js",
    ".ts",
    ".md"
  ]).has(extension);
}

function addCount(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function sortCountMap(map) {
  return Object.fromEntries(
    Object.entries(map).sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
  );
}

function normalizeVirtualPath(input) {
  return String(input ?? "")
    .replace(/\\/g, "/")
    .replace(/\/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n?/g, "\n");
}

function stripUtf8Bom(text) {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function getBaseName(inputPath) {
  const normalized = normalizeVirtualPath(inputPath);

  if (!normalized) {
    return "";
  }

  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

function decodeTextFromBuffer(buffer, extension) {
  if (buffer.length > MAX_ANALYZED_TEXT_BYTES) {
    return {
      text: null,
      reason: `Text file exceeded ${MAX_ANALYZED_TEXT_BYTES} bytes and was skipped for deep analysis.`
    };
  }

  const decoded = buffer.toString("utf8");
  const likelyText = isLikelyUtf8Text(buffer, decoded) || extensionLooksText(extension);

  if (!likelyText) {
    return {
      text: null,
      reason: null
    };
  }

  return {
    text: normalizeLineEndings(stripUtf8Bom(decoded)),
    reason: null
  };
}

function containsSqlKeyword(text) {
  return /\b(select|with|insert|update|delete|merge)\b/i.test(text);
}

function stripCdata(value) {
  return String(value ?? "")
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "");
}

function normalizeSql(value) {
  return String(value ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSqlStatements(value) {
  return String(value ?? "")
    .split(/;\s*(?:\n|$)/g)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function cleanQuotedIdentifier(value) {
  return value.replace(/^["'`\[]+/, "").replace(/["'`\]]+$/, "");
}

function extractTablesFromSql(sqlText) {
  const normalized = normalizeSql(sqlText);
  const tables = new Set();
  const tablePattern =
    /\b(?:from|join|into|update|merge\s+into)\s+([A-Za-z0-9_.$"[\]]+)(?:\s+[A-Za-z0-9_"[\]]+)?/gi;

  let match = tablePattern.exec(normalized);

  while (match) {
    const tableName = cleanQuotedIdentifier(match[1] ?? "").trim();

    if (
      tableName &&
      !["select", "with", "values", "set"].includes(tableName.toLowerCase())
    ) {
      tables.add(tableName);
    }

    match = tablePattern.exec(normalized);
  }

  return [...tables].sort((left, right) => left.localeCompare(right));
}

function extractTagNameFromAttributes(attributes) {
  const nameMatch = String(attributes ?? "").match(/\b(?:name|id|key)\s*=\s*"([^"]+)"/i);
  return nameMatch?.[1]?.trim() || null;
}

function collectJsonPaths(input, prefix = "", output = []) {
  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      collectJsonPaths(item, `${prefix}[${index}]`, output);
    });
    return output;
  }

  if (input && typeof input === "object") {
    Object.entries(input).forEach(([key, value]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      collectJsonPaths(value, nextPrefix, output);
    });
    return output;
  }

  output.push({
    key: prefix || "value",
    value: String(input ?? "")
  });

  return output;
}

function extractSqlFromJson(input, pathPrefix = "", output = []) {
  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      extractSqlFromJson(item, `${pathPrefix}[${index}]`, output);
    });
    return output;
  }

  if (!input || typeof input !== "object") {
    return output;
  }

  Object.entries(input).forEach(([key, value]) => {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;

    if (typeof value === "string" && /sql|query|statement/i.test(key) && containsSqlKeyword(value)) {
      output.push({
        name: nextPath,
        source: "json-field",
        sql: value
      });
      return;
    }

    extractSqlFromJson(value, nextPath, output);
  });

  return output;
}

function extractSqlQueriesFromTextFile(fileEntry) {
  const extension = fileEntry.extension;
  const textContent = fileEntry.textContent;
  const candidates = [];

  if (!textContent) {
    return [];
  }

  if ([".sql", ".qry", ".xquery"].includes(extension)) {
    splitSqlStatements(textContent).forEach((statement, index) => {
      if (containsSqlKeyword(statement)) {
        candidates.push({
          name: `${getBaseName(fileEntry.path)}-statement-${index + 1}`,
          source: "sql-file",
          sql: statement
        });
      }
    });
  }

  const xmlQueryPattern = /<(?:\w+:)?(sql|query|statement|dataQuery|expression)\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?\1>/gi;
  let xmlMatch = xmlQueryPattern.exec(textContent);
  let xmlQueryIndex = 0;

  while (xmlMatch) {
    xmlQueryIndex += 1;
    const tagName = xmlMatch[1]?.toLowerCase() ?? "query";
    const attributes = xmlMatch[2] ?? "";
    const tagNameFromAttrs = extractTagNameFromAttributes(attributes);
    const queryName = tagNameFromAttrs || `${tagName}-${xmlQueryIndex}`;
    const queryText = normalizeLineEndings(decodeXmlEntities(stripCdata(xmlMatch[3] ?? "")));

    if (containsSqlKeyword(queryText)) {
      candidates.push({
        name: queryName,
        source: `xml-tag:${tagName}`,
        sql: queryText
      });
    }

    xmlMatch = xmlQueryPattern.exec(textContent);
  }

  if (extension === ".json") {
    try {
      const parsed = JSON.parse(textContent);
      candidates.push(...extractSqlFromJson(parsed));
    } catch (_error) {
      // Ignore invalid JSON and continue with regex-based extraction only.
    }
  }

  if (candidates.length === 0 && containsSqlKeyword(textContent)) {
    splitSqlStatements(textContent).forEach((statement, index) => {
      if (containsSqlKeyword(statement)) {
        candidates.push({
          name: `${getBaseName(fileEntry.path)}-fallback-${index + 1}`,
          source: "fallback-text-scan",
          sql: statement
        });
      }
    });
  }

  const deduped = new Map();

  candidates.forEach((candidate) => {
    const normalized = normalizeSql(candidate.sql);

    if (!normalized || !containsSqlKeyword(normalized)) {
      return;
    }

    const dedupeKey = `${candidate.name}::${normalized}`;

    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, {
        ...candidate,
        sql: normalizeLineEndings(candidate.sql.trim())
      });
    }
  });

  return [...deduped.values()];
}

function extractPropertiesFromTextFile(fileEntry) {
  const textContent = fileEntry.textContent;
  const extension = fileEntry.extension;
  const properties = [];

  if (!textContent) {
    return properties;
  }

  const linePattern = /^[ \t]*([A-Za-z0-9_.\-[\]]+)[ \t]*[:=][ \t]*(.+?)\s*$/gm;
  let lineMatch = linePattern.exec(textContent);

  while (lineMatch) {
    const key = lineMatch[1]?.trim();
    const value = lineMatch[2]?.trim() ?? "";

    if (key && !key.startsWith("#") && !key.startsWith(";")) {
      properties.push({
        key,
        value
      });
    }

    lineMatch = linePattern.exec(textContent);
  }

  const xmlPropertyPattern =
    /<(?:\w+:)?(?:property|entry)\b[^>]*(?:name|key)\s*=\s*"([^"]+)"[^>]*(?:value\s*=\s*"([^"]*)")?[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:property|entry)>/gi;
  let xmlPropertyMatch = xmlPropertyPattern.exec(textContent);

  while (xmlPropertyMatch) {
    const key = xmlPropertyMatch[1]?.trim();
    const directValue = xmlPropertyMatch[2] ?? "";
    const bodyValue = decodeXmlEntities(stripCdata(xmlPropertyMatch[3] ?? "")).trim();
    const value = (directValue || bodyValue).trim();

    if (key) {
      properties.push({
        key,
        value
      });
    }

    xmlPropertyMatch = xmlPropertyPattern.exec(textContent);
  }

  if (extension === ".json") {
    try {
      const parsed = JSON.parse(textContent);
      collectJsonPaths(parsed).forEach((entry) => {
        properties.push({
          key: entry.key,
          value: entry.value
        });
      });
    } catch (_error) {
      // Ignore invalid JSON and keep the rest of extracted properties.
    }
  }

  const deduped = new Map();

  properties.forEach((property) => {
    if (!property.key) {
      return;
    }

    const dedupeKey = `${property.key}::${property.value}`;

    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, property);
    }
  });

  return [...deduped.values()];
}

function buildDirectoryTree(fileEntries) {
  const createFolderNode = (name, pathValue) => ({
    type: "folder",
    name,
    path: pathValue,
    children: [],
    _index: new Map()
  });
  const root = createFolderNode("/", "");

  fileEntries.forEach((fileEntry) => {
    const normalizedPath = normalizeVirtualPath(fileEntry.path);

    if (!normalizedPath) {
      return;
    }

    const parts = normalizedPath.split("/").filter(Boolean);
    let currentNode = root;

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isLeaf = index === parts.length - 1;
      const childPath = currentNode.path ? `${currentNode.path}/${part}` : part;

      if (isLeaf) {
        currentNode.children.push({
          type: "file",
          name: part,
          path: normalizedPath,
          extension: fileEntry.extension,
          fileType: fileEntry.fileType,
          bytes: fileEntry.bytes,
          sha256: fileEntry.sha256,
          archiveDepth: fileEntry.archiveDepth,
          parentArchivePath: fileEntry.parentArchivePath
        });
        continue;
      }

      if (!currentNode._index.has(part)) {
        const folderNode = createFolderNode(part, childPath);
        currentNode._index.set(part, folderNode);
        currentNode.children.push(folderNode);
      }

      currentNode = currentNode._index.get(part);
    }
  });

  const finalizeTree = (node) => {
    if (!node || node.type !== "folder") {
      return node;
    }

    node.children = node.children
      .map((child) => finalizeTree(child))
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "folder" ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
    delete node._index;
    return node;
  };

  return finalizeTree(root);
}

function collectSqlMetadata(textFiles) {
  const tableFrequency = {};
  const queries = [];
  const normalizedHashes = new Set();
  const dedupeByPathAndHash = new Set();
  let totalSqlCharacters = 0;

  textFiles.forEach((textFile) => {
    const extractedQueries = extractSqlQueriesFromTextFile(textFile);

    extractedQueries.forEach((query) => {
      const normalizedSql = normalizeSql(query.sql);
      const hash = crypto.createHash("sha256").update(normalizedSql).digest("hex");
      const dedupeKey = `${textFile.path}::${hash}`;

      if (dedupeByPathAndHash.has(dedupeKey)) {
        return;
      }

      dedupeByPathAndHash.add(dedupeKey);
      normalizedHashes.add(hash);
      totalSqlCharacters += query.sql.length;

      const tables = extractTablesFromSql(query.sql);
      tables.forEach((tableName) => addCount(tableFrequency, tableName));

      queries.push({
        id: `Q${queries.length + 1}`,
        path: textFile.path,
        source: query.source,
        name: query.name,
        sql: query.sql,
        normalizedSql,
        hash,
        tables,
        characters: query.sql.length,
        lines: query.sql.length > 0 ? query.sql.split("\n").length : 0,
        preview: query.sql.slice(0, MAX_SQL_PREVIEW_CHARS)
      });
    });
  });

  queries.sort((left, right) => {
    if (left.path !== right.path) {
      return left.path.localeCompare(right.path);
    }

    return left.name.localeCompare(right.name);
  });

  return {
    totalQueries: queries.length,
    uniqueQueryShapes: normalizedHashes.size,
    totalSqlCharacters,
    tableFrequency: sortCountMap(tableFrequency),
    queries
  };
}

function collectMetadataProperties(textFiles) {
  const entries = [];
  const keyFrequency = {};

  textFiles.forEach((textFile) => {
    const properties = extractPropertiesFromTextFile(textFile);

    properties.forEach((property) => {
      addCount(keyFrequency, property.key);
      entries.push({
        path: textFile.path,
        key: property.key,
        value: property.value
      });
    });
  });

  entries.sort((left, right) => {
    if (left.path !== right.path) {
      return left.path.localeCompare(right.path);
    }

    if (left.key !== right.key) {
      return left.key.localeCompare(right.key);
    }

    return left.value.localeCompare(right.value);
  });

  return {
    totalProperties: entries.length,
    uniquePropertyKeys: Object.keys(keyFrequency).length,
    keyFrequency: sortCountMap(keyFrequency),
    entries
  };
}

function collectDataModelInsights(textFiles, sqlMetadata) {
  const sourceFiles = new Set();
  const modelNames = new Set();
  const dataSets = new Set();
  const parameters = new Set();
  const definedTables = new Set();
  const definedColumns = new Set();
  const detectedRootTags = {};

  textFiles.forEach((textFile) => {
    const extension = textFile.extension;
    const pathLower = textFile.path.toLowerCase();
    const textContent = textFile.textContent;

    if (!textContent) {
      return;
    }

    const xmlRootTag = extractXmlRootTag(textContent.trim());

    if (xmlRootTag) {
      addCount(detectedRootTags, xmlRootTag);
    }

    const dataModelCandidate =
      pathLower.includes("data-model") ||
      pathLower.includes("data_model") ||
      pathLower.includes("datamodel") ||
      extension === ".xdm" ||
      extension === ".xdmz" ||
      /<(?:\w+:)?dataModel\b/i.test(textContent);

    if (dataModelCandidate) {
      sourceFiles.add(textFile.path);
    }

    const modelNamePattern = /<(?:\w+:)?dataModel\b[^>]*\bname\s*=\s*"([^"]+)"/gi;
    let modelMatch = modelNamePattern.exec(textContent);

    while (modelMatch) {
      if (modelMatch[1]) {
        modelNames.add(modelMatch[1].trim());
      }
      modelMatch = modelNamePattern.exec(textContent);
    }

    const dataSetPattern = /<(?:\w+:)?dataSet\b[^>]*\bname\s*=\s*"([^"]+)"/gi;
    let dataSetMatch = dataSetPattern.exec(textContent);

    while (dataSetMatch) {
      if (dataSetMatch[1]) {
        dataSets.add(dataSetMatch[1].trim());
      }
      dataSetMatch = dataSetPattern.exec(textContent);
    }

    const parameterPattern = /<(?:\w+:)?parameter\b[^>]*\bname\s*=\s*"([^"]+)"/gi;
    let parameterMatch = parameterPattern.exec(textContent);

    while (parameterMatch) {
      if (parameterMatch[1]) {
        parameters.add(parameterMatch[1].trim());
      }
      parameterMatch = parameterPattern.exec(textContent);
    }

    const tablePattern = /<(?:\w+:)?(?:table|view)\b[^>]*\bname\s*=\s*"([^"]+)"/gi;
    let tableMatch = tablePattern.exec(textContent);

    while (tableMatch) {
      if (tableMatch[1]) {
        definedTables.add(tableMatch[1].trim());
      }
      tableMatch = tablePattern.exec(textContent);
    }

    const columnPattern = /<(?:\w+:)?(?:column|element)\b[^>]*\bname\s*=\s*"([^"]+)"/gi;
    let columnMatch = columnPattern.exec(textContent);

    while (columnMatch) {
      if (columnMatch[1]) {
        definedColumns.add(columnMatch[1].trim());
      }
      columnMatch = columnPattern.exec(textContent);
    }
  });

  const tablesFromSql = Object.keys(sqlMetadata.tableFrequency);
  tablesFromSql.forEach((tableName) => definedTables.add(tableName));

  return {
    detected: sourceFiles.size > 0 || modelNames.size > 0 || dataSets.size > 0,
    sourceFiles: [...sourceFiles].sort((left, right) => left.localeCompare(right)),
    modelNames: [...modelNames].sort((left, right) => left.localeCompare(right)),
    dataSets: [...dataSets].sort((left, right) => left.localeCompare(right)),
    parameters: [...parameters].sort((left, right) => left.localeCompare(right)),
    tables: [...definedTables].sort((left, right) => left.localeCompare(right)),
    columns: [...definedColumns].sort((left, right) => left.localeCompare(right)),
    rootTagFrequency: sortCountMap(detectedRootTags),
    sqlQueryCount: sqlMetadata.totalQueries
  };
}

function summarizeFileStructure(fileEntries) {
  const extensionCounts = {};
  const topLevelFolders = new Set();
  const folderSet = new Set();
  const typeCounts = {
    text: 0,
    binary: 0,
    archive: 0
  };

  fileEntries.forEach((fileEntry) => {
    addCount(extensionCounts, fileEntry.extension || "(none)");
    addCount(typeCounts, fileEntry.fileType);

    const normalizedPath = normalizeVirtualPath(fileEntry.path);
    const parts = normalizedPath.split("/").filter(Boolean);

    if (parts.length > 1) {
      topLevelFolders.add(parts[0]);

      for (let index = 1; index < parts.length; index += 1) {
        folderSet.add(parts.slice(0, index).join("/"));
      }
    }
  });

  const largestFiles = [...fileEntries]
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 50)
    .map((fileEntry) => ({
      path: fileEntry.path,
      bytes: fileEntry.bytes,
      fileType: fileEntry.fileType
    }));

  return {
    totalFiles: fileEntries.length,
    totalFolders: folderSet.size,
    totalTextFiles: typeCounts.text || 0,
    totalBinaryFiles: typeCounts.binary || 0,
    totalArchiveFiles: typeCounts.archive || 0,
    topLevelFolders: [...topLevelFolders].sort((left, right) => left.localeCompare(right)),
    extensionCounts: sortCountMap(extensionCounts),
    largestFiles,
    files: fileEntries,
    tree: buildDirectoryTree(fileEntries)
  };
}

function createFileRecord(pathValue, buffer, fileType, archiveDepth, parentArchivePath) {
  const normalizedPath = normalizeVirtualPath(pathValue);
  const extension = getFileExtension(normalizedPath);

  return {
    path: normalizedPath,
    extension,
    fileType,
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    archiveDepth,
    parentArchivePath
  };
}

async function extractPayloadFilesRecursive(
  context,
  buffer,
  pathValue,
  archiveDepth,
  parentArchivePath
) {
  if (context.files.length >= MAX_EXTRACTED_FILE_COUNT) {
    context.warnings.push(
      `Extraction stopped after ${MAX_EXTRACTED_FILE_COUNT} files to keep analysis stable.`
    );
    return;
  }

  const normalizedPath = normalizeVirtualPath(pathValue);

  if (!normalizedPath) {
    context.warnings.push("Skipped a file with an empty path during archive extraction.");
    return;
  }

  if (isZipBuffer(buffer)) {
    const archiveRecord = createFileRecord(
      normalizedPath,
      buffer,
      "archive",
      archiveDepth,
      parentArchivePath
    );
    context.files.push(archiveRecord);

    if (archiveDepth >= MAX_NESTED_ARCHIVE_DEPTH) {
      context.warnings.push(
        `Nested archive depth exceeded at ${normalizedPath}. Further nested extraction was skipped.`
      );
      return;
    }

    let zip = null;

    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (error) {
      context.warnings.push(
        `Failed to read archive ${normalizedPath}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      return;
    }

    const zipEntries = Object.values(zip.files).filter((entry) => !entry.dir);

    for (const zipEntry of zipEntries) {
      if (context.files.length >= MAX_EXTRACTED_FILE_COUNT) {
        context.warnings.push(
          `Extraction stopped after ${MAX_EXTRACTED_FILE_COUNT} files to keep analysis stable.`
        );
        break;
      }

      const childBuffer = await zipEntry.async("nodebuffer");
      const childPath = normalizeVirtualPath(`${normalizedPath}/${zipEntry.name}`);
      await extractPayloadFilesRecursive(context, childBuffer, childPath, archiveDepth + 1, normalizedPath);
    }

    return;
  }

  const extension = getFileExtension(normalizedPath);
  const textDecode = decodeTextFromBuffer(buffer, extension);
  const isText = Boolean(textDecode.text);
  const fileRecord = createFileRecord(
    normalizedPath,
    buffer,
    isText ? "text" : "binary",
    archiveDepth,
    parentArchivePath
  );

  if (isText) {
    const textContent = textDecode.text;
    fileRecord.textPreview = textContent.slice(0, 500);
    fileRecord.lines = textContent.length > 0 ? textContent.split("\n").length : 0;
    fileRecord.characters = textContent.length;
    context.textFiles.push({
      path: fileRecord.path,
      extension: fileRecord.extension,
      bytes: fileRecord.bytes,
      sha256: fileRecord.sha256,
      archiveDepth: fileRecord.archiveDepth,
      parentArchivePath: fileRecord.parentArchivePath,
      textContent
    });
  } else if (textDecode.reason) {
    context.warnings.push(`${normalizedPath}: ${textDecode.reason}`);
  }

  context.files.push(fileRecord);
}

function normalizeReportPathForFileName(reportPath) {
  const base = String(reportPath ?? "").split("/").filter(Boolean).pop() || "catalog-object";
  const noExtension = base.replace(/\.[^.]+$/, "");

  return noExtension.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "catalog-object";
}

function sanitizeFolderSegment(segment) {
  const sanitized = String(segment ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\.+$/g, "");

  return sanitized || "_";
}

function getReportPathFolderSegments(reportPath) {
  const rawSegments = String(reportPath ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (rawSegments.length === 0) {
    return ["root"];
  }

  return rawSegments.map((segment) => sanitizeFolderSegment(segment));
}

function resolveProjectRootDirectory() {
  const cwd = process.cwd();

  if (cwd && cwd.trim()) {
    return cwd;
  }

  return __dirname;
}

async function persistMetadataJsonInProjectFolder(reportPath, fileName, metadata) {
  const projectRoot = resolveProjectRootDirectory();
  const bipJsonRoot = path.join(projectRoot, "BIPJSON");
  const reportFolderSegments = getReportPathFolderSegments(reportPath);
  const reportFolderPath = path.join(bipJsonRoot, ...reportFolderSegments);
  const metadataJsonPath = path.join(reportFolderPath, sanitizeFolderSegment(fileName));
  const metadataJson = JSON.stringify(metadata, null, 2);

  await fs.mkdir(reportFolderPath, {
    recursive: true
  });
  await fs.writeFile(metadataJsonPath, metadataJson, "utf8");

  return {
    projectRoot,
    bipJsonRoot,
    reportFolderPath,
    metadataJsonPath
  };
}

function buildRootPayloadName(reportPath, payloadFormat) {
  const candidateName = getBaseName(reportPath);

  if (candidateName) {
    return normalizeVirtualPath(candidateName);
  }

  if (payloadFormat === "zip") {
    return "downloadObjectReturn.zip";
  }

  if (payloadFormat === "xml") {
    return "downloadObjectReturn.xml";
  }

  if (payloadFormat === "json") {
    return "downloadObjectReturn.json";
  }

  if (payloadFormat === "text") {
    return "downloadObjectReturn.txt";
  }

  return "downloadObjectReturn.bin";
}

async function buildDownloadObjectMetadata(downloadObjectReturn, reportPath) {
  const originalLength = downloadObjectReturn.length;
  const normalizedPayload = downloadObjectReturn.replace(/\s+/g, "");
  const decodedBytes = getDecodedSize(downloadObjectReturn);
  const isBase64 = decodedBytes !== null;
  const payloadBuffer = isBase64
    ? Buffer.from(normalizedPayload, "base64")
    : Buffer.from(downloadObjectReturn, "utf8");
  const decodedAsText = payloadBuffer.toString("utf8");
  const likelyText = isLikelyUtf8Text(payloadBuffer, decodedAsText);
  const format = detectPayloadFormat(payloadBuffer, decodedAsText, likelyText);
  const rootPayloadName = buildRootPayloadName(reportPath, format);
  const extractionContext = {
    files: [],
    textFiles: [],
    warnings: []
  };

  await extractPayloadFilesRecursive(extractionContext, payloadBuffer, rootPayloadName, 0, null);

  const sortedFiles = [...extractionContext.files].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  const sortedTextFiles = [...extractionContext.textFiles].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  const sqlMetadata = collectSqlMetadata(sortedTextFiles);
  const metadataProperties = collectMetadataProperties(sortedTextFiles);
  const dataModel = collectDataModelInsights(sortedTextFiles, sqlMetadata);
  const structure = summarizeFileStructure(sortedFiles);
  const payload = {
    transportEncoding: isBase64 ? "base64" : "plain-text",
    originalLength,
    normalizedLength: normalizedPayload.length,
    decodedBytes: payloadBuffer.length,
    sha256: crypto.createHash("sha256").update(payloadBuffer).digest("hex"),
    format,
    isLikelyText: likelyText,
    rootPayloadName
  };

  if (likelyText && format !== "zip") {
    const normalized = normalizeLineEndings(stripUtf8Bom(decodedAsText));
    payload.text = {
      characters: normalized.length,
      lines: normalized.length > 0 ? normalized.split("\n").length : 0,
      words: normalized.match(/\S+/g)?.length ?? 0,
      querySignalCount: countSqlSignals(normalized),
      propertySignalCount: countPropertySignals(normalized),
      xmlRootTag: extractXmlRootTag(normalized.trim()),
      preview: normalized.slice(0, 500)
    };
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const reportName = normalizeReportPathForFileName(reportPath);
  const fileName = `${reportName}-metadata-${timestamp}.json`;

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      reportPath,
      payload,
      extraction: {
        warnings: extractionContext.warnings,
        extractedFiles: structure.totalFiles,
        extractedTextFiles: structure.totalTextFiles,
        extractedBinaryFiles: structure.totalBinaryFiles,
        extractedArchives: structure.totalArchiveFiles
      },
      structure,
      dataModel,
      sqlQueries: sqlMetadata,
      metadataProperties
    },
    fileName
  };
}

async function invokeDownloadObject(endpoint, reportPath, username, password) {
  const authHeader = Buffer.from(`${username}:${password}`).toString("base64");
  const variants = [
    {
      name: "reportAbsolutePath/userID/password",
      fields: {
        pathField: "reportAbsolutePath",
        userField: "userID",
        passwordField: "password"
      }
    },
    {
      name: "absolutePath/userID/password",
      fields: {
        pathField: "absolutePath",
        userField: "userID",
        passwordField: "password"
      }
    },
    {
      name: "in0/in1/in2",
      fields: {
        pathField: "in0",
        userField: "in1",
        passwordField: "in2"
      }
    }
  ];
  const failedAttempts = [];

  for (const variant of variants) {
    const body = buildSoapEnvelope(reportPath, username, password, variant.fields);

    let response = null;
    let responseText = "";

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "downloadObject"
        },
        body
      });
      responseText = await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to call SOAP service.";
      failedAttempts.push(`${variant.name}: network error (${message})`);
      continue;
    }

    const fault = extractSoapFault(responseText);
    const downloadObjectReturn = extractDownloadObjectReturn(responseText);

    if (response.ok && !fault && downloadObjectReturn !== null) {
      const payloadLength = downloadObjectReturn
        ? downloadObjectReturn.replace(/\s+/g, "").length
        : 0;
      const decodedSize = downloadObjectReturn ? getDecodedSize(downloadObjectReturn) : null;

      return {
        endpoint,
        variantUsed: variant.name,
        httpStatus: response.status,
        downloadObjectReturn,
        payloadBase64Length: payloadLength,
        payloadDecodedBytes: decodedSize,
        responseSnippet: summarizeResponse(responseText),
        payloadPreview: downloadObjectReturn ? downloadObjectReturn.slice(0, 140) : ""
      };
    }

    const reason = fault || `HTTP ${response.status}`;
    failedAttempts.push(`${variant.name}: ${reason}`);
  }

  throw new Error(
    `downloadObject() failed for all request variants. ${failedAttempts.join(" | ")}`
  );
}

function findProjectConnection(projectState, projectCode, connectionName) {
  const normalizedProjectCode = String(projectCode ?? "").trim();

  if (!normalizedProjectCode) {
    throw new Error("Project selection is required.");
  }

  const project = projectState.projects.find((item) => item.code === normalizedProjectCode);

  if (!project) {
    throw new Error("Selected project was not found.");
  }

  const normalizedConnectionName = String(connectionName ?? "").trim().toLowerCase();

  if (!normalizedConnectionName) {
    throw new Error("Connection selection is required.");
  }

  const connection = project.connections.find(
    (item) => item.name.trim().toLowerCase() === normalizedConnectionName
  );

  if (!connection) {
    throw new Error("Selected connection was not found in this project.");
  }

  return {
    project,
    connection
  };
}

async function downloadBipObject(projectCode, connectionName, reportPath) {
  const normalizedReportPath = String(reportPath ?? "").trim();

  if (!normalizedReportPath) {
    throw new Error("BIP report path is required.");
  }

  const projectState = await readProjectState();
  const { project, connection } = findProjectConnection(projectState, projectCode, connectionName);
  const endpoint = normalizeServiceEndpoint(connection.url);
  const response = await invokeDownloadObject(
    endpoint,
    normalizedReportPath,
    connection.username,
    connection.password
  );
  const metadataResult = await buildDownloadObjectMetadata(
    response.downloadObjectReturn,
    normalizedReportPath
  );
  const savedLocation = await persistMetadataJsonInProjectFolder(
    normalizedReportPath,
    metadataResult.fileName,
    metadataResult.metadata
  );
  const result = {
    requestedAt: new Date().toISOString(),
    projectCode: project.code,
    projectName: project.name,
    connectionName: connection.name,
    endpoint: response.endpoint,
    variantUsed: response.variantUsed,
    httpStatus: response.httpStatus,
    reportPath: normalizedReportPath,
    downloadObjectReturn: response.downloadObjectReturn,
    payloadBase64Length: response.payloadBase64Length,
    payloadDecodedBytes: response.payloadDecodedBytes,
    payloadPreview: response.payloadPreview,
    responseSnippet: response.responseSnippet,
    metadataFileName: metadataResult.fileName,
    metadata: metadataResult.metadata,
    metadataSavedPath: savedLocation.metadataJsonPath,
    metadataSavedFolder: savedLocation.reportFolderPath,
    bipJsonRootFolder: savedLocation.bipJsonRoot
  };

  console.log(result.downloadObjectReturn);

  return result;
}

module.exports = {
  downloadBipObject
};
