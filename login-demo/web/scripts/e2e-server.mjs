import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
if (process.env.E2E_SKIP_BUILD !== "1") {
  const result = spawnSync(process.execPath, [resolve("node_modules/next/dist/bin/next"), "build"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_ENABLE_GALLERY: "1", NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const python =
  process.env.PYTHON ||
  resolve("..", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const child = spawn(
  python,
  ["-X", "utf8", "../tests/e2e_server.py", "--port", "8019", "--web", resolve("out")],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
