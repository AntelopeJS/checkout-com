import path from "node:path";
import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REMOTE = "https://github.com/AntelopeJS/payment-subscriptions.git";
const COMMIT = "c4d33b0ca08372e055ee514220f19ed77fb2e913";
const FOLDER = `.antelope/payment-subscriptions-${COMMIT.slice(0, 7)}`;
const BUILT_ENTRY = "dist/index.js";
const OWN_DEPENDENCIES = "node_modules";

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function build(folder: string, root: string): void {
  run("git", ["clone", "--quiet", REMOTE, folder], root);
  run("git", ["checkout", "--quiet", COMMIT], folder);
  run("pnpm", ["install", "--no-frozen-lockfile", "--reporter=silent"], folder);
  run("pnpm", ["run", "build"], folder);
}

/**
 * Prepares `@antelopejs/payment-subscriptions` at the pinned commit (the head
 * of its pull request that adopts `@antelopejs/interface-subscriptions` 0.1.0)
 * for the renewal test, and returns where it is.
 *
 * The built module is then stripped of its own dependencies, so that it
 * resolves every interface from this repository's install. The core does not
 * connect two physical copies of one interface: with payment-subscriptions on
 * its own copy of interface-database and the mongodb module on another, its
 * first database call queued for ever and shutdown waited on it.
 */
export function PrepareFallbackModule(root: string): string {
  const folder = path.join(root, FOLDER);
  if (!existsSync(path.join(folder, BUILT_ENTRY))) build(folder, root);
  rmSync(path.join(folder, OWN_DEPENDENCIES), { recursive: true, force: true });
  return folder;
}
