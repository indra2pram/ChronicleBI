const { spawn } = require("node:child_process");

const electronBinary = require("electron");

const mode = process.argv[2] || "development";
const childEnv = {
  ...process.env,
  APP_ENV: mode
};

// Some shells/environments set this flag globally, which makes Electron run as plain Node.js.
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  stdio: "inherit",
  env: childEnv
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
