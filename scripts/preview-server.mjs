import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const port = Number(process.env.PORT || 3000);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)));
  });
}

if (!existsSync("dist/client/index.html")) await run("pnpm", ["build"]);
await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "ziheng-db", "--local"]);
const worker = spawn("pnpm", ["exec", "wrangler", "dev", "--ip", "0.0.0.0", "--port", String(port)], {
  stdio: "inherit",
  env: process.env
});
process.on("SIGTERM", () => worker.kill("SIGTERM"));
process.on("SIGINT", () => worker.kill("SIGINT"));
worker.on("exit", code => process.exit(code ?? 0));
