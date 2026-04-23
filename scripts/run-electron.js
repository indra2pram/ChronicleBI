const { spawn } = require("node:child_process");

const electronBinary = require("electron");

const mode = process.argv[2] || "development";

const child = spawn(electronBinary, ["."], {
  stdio: "inherit",
  env: {
    ...process.env,
    APP_ENV: mode
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
