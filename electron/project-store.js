const fs = require("node:fs/promises");
const path = require("node:path");

const { app } = require("electron");

const defaultProjectState = {
  activeProjectCode: null,
  projects: []
};

function getStoragePath() {
  return path.join(app.getPath("userData"), "projects.json");
}

function normalizeProjectDraft(input) {
  return {
    code: String(input?.code ?? "").trim(),
    name: String(input?.name ?? "").trim(),
    description: String(input?.description ?? "").trim()
  };
}

function normalizeConnectionDraft(input) {
  return {
    name: String(input?.name ?? "").trim(),
    url: String(input?.url ?? "").trim(),
    username: String(input?.username ?? "").trim(),
    password: String(input?.password ?? "")
  };
}

function normalizeStoredConnection(input) {
  const connection = normalizeConnectionDraft(input);

  return {
    ...connection,
    createdAt: String(input?.createdAt ?? new Date().toISOString()),
    updatedAt: String(input?.updatedAt ?? new Date().toISOString())
  };
}

function sanitizeConnections(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenNames = new Set();

  return input.map(normalizeStoredConnection).filter((connection) => {
    if (!connection.name || !connection.url || !connection.username || !connection.password) {
      return false;
    }

    const normalizedName = connection.name.toLowerCase();

    if (seenNames.has(normalizedName)) {
      return false;
    }

    seenNames.add(normalizedName);
    return true;
  });
}

function normalizeStoredProject(input) {
  const project = normalizeProjectDraft(input);

  return {
    ...project,
    createdAt: String(input?.createdAt ?? new Date().toISOString()),
    updatedAt: String(input?.updatedAt ?? new Date().toISOString()),
    connections: sanitizeConnections(input?.connections)
  };
}

function sanitizeProjectState(input) {
  if (!input || typeof input !== "object") {
    return { ...defaultProjectState };
  }

  const seenCodes = new Set();
  const projects = Array.isArray(input.projects)
    ? input.projects
        .map(normalizeStoredProject)
        .filter((project) => {
          if (!project.code || !project.name || !project.description) {
            return false;
          }

          const normalizedCode = project.code.toLowerCase();

          if (seenCodes.has(normalizedCode)) {
            return false;
          }

          seenCodes.add(normalizedCode);
          return true;
        })
    : [];

  const activeProjectCode =
    typeof input.activeProjectCode === "string" &&
    projects.some((project) => project.code === input.activeProjectCode)
      ? input.activeProjectCode
      : null;

  return {
    activeProjectCode,
    projects
  };
}

async function readProjectState() {
  try {
    const raw = await fs.readFile(getStoragePath(), "utf8");
    return sanitizeProjectState(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { ...defaultProjectState };
    }

    throw error;
  }
}

async function writeProjectState(projectState) {
  const nextState = sanitizeProjectState(projectState);

  await fs.writeFile(getStoragePath(), JSON.stringify(nextState, null, 2), "utf8");

  return nextState;
}

function validateProjectDraft(projectDraft) {
  if (!projectDraft.code) {
    throw new Error("Project code is required.");
  }

  if (!projectDraft.name) {
    throw new Error("Project name is required.");
  }

  if (!projectDraft.description) {
    throw new Error("Project description is required.");
  }
}

function validateConnectionDraft(connectionDraft) {
  if (!connectionDraft.name) {
    throw new Error("Connection name is required.");
  }

  if (!connectionDraft.url) {
    throw new Error("Connection URL is required.");
  }

  if (!connectionDraft.username) {
    throw new Error("Connection username is required.");
  }

  if (!connectionDraft.password) {
    throw new Error("Connection password is required.");
  }

  let parsedUrl = null;

  try {
    parsedUrl = new URL(connectionDraft.url);
  } catch (_error) {
    throw new Error("Connection URL must be a valid http or https address.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Connection URL must be a valid http or https address.");
  }
}

function getProjectIndex(projectState, projectCode) {
  return projectState.projects.findIndex((project) => project.code === projectCode);
}

function getConnectionIndex(connections, connectionName) {
  const normalizedName = String(connectionName ?? "").trim().toLowerCase();

  if (!normalizedName) {
    return -1;
  }

  return connections.findIndex((connection) => connection.name.toLowerCase() === normalizedName);
}

function ensureProjectExists(projectState, projectCode, missingMessage) {
  const code = String(projectCode ?? "").trim();
  const projectIndex = getProjectIndex(projectState, code);

  if (projectIndex < 0) {
    throw new Error(missingMessage);
  }

  return {
    code,
    projectIndex,
    project: projectState.projects[projectIndex]
  };
}

function resolveConnectionIndex(connections, existingConnectionName) {
  const name = String(existingConnectionName ?? "").trim();

  if (!name) {
    return -1;
  }

  const connectionIndex = getConnectionIndex(connections, name);

  if (connectionIndex < 0) {
    throw new Error("The selected connection was not found.");
  }

  return connectionIndex;
}

function ensureUniqueConnectionName(connections, connectionName, currentIndex) {
  const normalizedName = connectionName.toLowerCase();
  const duplicateIndex = connections.findIndex(
    (connection, index) => index !== currentIndex && connection.name.toLowerCase() === normalizedName
  );

  if (duplicateIndex >= 0) {
    throw new Error("Connection name must be unique within the selected project.");
  }
}

async function createProject(projectInput) {
  const draft = normalizeProjectDraft(projectInput);
  validateProjectDraft(draft);

  const projectState = await readProjectState();
  const normalizedCode = draft.code.toLowerCase();

  if (projectState.projects.some((project) => project.code.toLowerCase() === normalizedCode)) {
    throw new Error("Project code must be unique.");
  }

  const now = new Date().toISOString();
  const nextProject = {
    ...draft,
    connections: [],
    createdAt: now,
    updatedAt: now
  };

  return writeProjectState({
    activeProjectCode: nextProject.code,
    projects: [nextProject, ...projectState.projects]
  });
}

async function openProject(projectCode) {
  const code = String(projectCode ?? "").trim();

  if (!code) {
    throw new Error("Choose a project to open.");
  }

  const projectState = await readProjectState();
  const project = projectState.projects.find((item) => item.code === code);

  if (!project) {
    throw new Error("The selected project was not found.");
  }

  return writeProjectState({
    ...projectState,
    activeProjectCode: project.code
  });
}

async function deleteProject(projectCode) {
  const code = String(projectCode ?? "").trim();

  if (!code) {
    throw new Error("Choose a project to delete.");
  }

  const projectState = await readProjectState();
  const nextProjects = projectState.projects.filter((project) => project.code !== code);

  if (nextProjects.length === projectState.projects.length) {
    throw new Error("The selected project was not found.");
  }

  return writeProjectState({
    activeProjectCode:
      projectState.activeProjectCode === code ? nextProjects[0]?.code ?? null : projectState.activeProjectCode,
    projects: nextProjects
  });
}

async function saveConnection(projectCode, connectionInput, existingConnectionName) {
  const code = String(projectCode ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before saving a connection.");
  }

  const draft = normalizeConnectionDraft(connectionInput);
  validateConnectionDraft(draft);

  const projectState = await readProjectState();
  const { project, projectIndex } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before saving a connection."
  );
  const nextConnections = [...project.connections];
  const connectionIndex = resolveConnectionIndex(nextConnections, existingConnectionName);

  ensureUniqueConnectionName(nextConnections, draft.name, connectionIndex);

  const now = new Date().toISOString();
  const nextConnection =
    connectionIndex >= 0
      ? {
          ...nextConnections[connectionIndex],
          ...draft,
          updatedAt: now
        }
      : {
          ...draft,
          createdAt: now,
          updatedAt: now
        };

  if (connectionIndex >= 0) {
    nextConnections[connectionIndex] = nextConnection;
  } else {
    nextConnections.unshift(nextConnection);
  }

  const nextProjects = [...projectState.projects];
  nextProjects[projectIndex] = {
    ...project,
    connections: nextConnections,
    updatedAt: now
  };

  return writeProjectState({
    ...projectState,
    projects: nextProjects
  });
}

async function deleteConnection(projectCode, connectionName) {
  const code = String(projectCode ?? "").trim();
  const name = String(connectionName ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before deleting a connection.");
  }

  if (!name) {
    throw new Error("Choose a connection to delete.");
  }

  const projectState = await readProjectState();
  const { project, projectIndex } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before deleting a connection."
  );
  const nextConnections = project.connections.filter((connection) => connection.name !== name);

  if (nextConnections.length === project.connections.length) {
    throw new Error("The selected connection was not found.");
  }

  const now = new Date().toISOString();
  const nextProjects = [...projectState.projects];
  nextProjects[projectIndex] = {
    ...project,
    connections: nextConnections,
    updatedAt: now
  };

  return writeProjectState({
    ...projectState,
    projects: nextProjects
  });
}

async function testConnection(projectCode, connectionInput, existingConnectionName) {
  const code = String(projectCode ?? "").trim();

  if (!code) {
    throw new Error("Choose a project before testing a connection.");
  }

  const draft = normalizeConnectionDraft(connectionInput);
  validateConnectionDraft(draft);

  const projectState = await readProjectState();
  const { project } = ensureProjectExists(
    projectState,
    code,
    "Choose a project before testing a connection."
  );
  const connectionIndex = resolveConnectionIndex(project.connections, existingConnectionName);

  ensureUniqueConnectionName(project.connections, draft.name, connectionIndex);

  return {
    status: "passed",
    message: "Connection test API is not configured yet. Local validation passed.",
    testedAt: new Date().toISOString()
  };
}

module.exports = {
  createProject,
  deleteConnection,
  deleteProject,
  openProject,
  readProjectState,
  saveConnection,
  testConnection
};
