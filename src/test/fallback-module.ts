import path from "node:path";
import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REMOTE = "git@github.com:AntelopeJS/payment-subscriptions.git";
const COMMIT = "bdb266c55481ac03d0a794b3ff63a88486197c49";
const INTERFACE_SUBSCRIPTIONS_PIN =
  "git+ssh://git@github.com/AntelopeJS/interface-subscriptions.git#481ede61b57cab94d82c9dd301a92935398cf01c";
const FOLDER = `.antelope/payment-subscriptions-${COMMIT.slice(0, 7)}`;
const BUILT_ENTRY = "dist/index.js";
const OWN_DEPENDENCIES = "node_modules";

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function build(folder: string, root: string): void {
  run("git", ["clone", "--quiet", REMOTE, folder], root);
  run("git", ["checkout", "--quiet", COMMIT], folder);
  run(
    "pnpm",
    [
      "pkg",
      "set",
      `dependencies.@antelopejs/interface-subscriptions=${INTERFACE_SUBSCRIPTIONS_PIN}`,
    ],
    folder,
  );
  run("pnpm", ["install", "--no-frozen-lockfile", "--reporter=silent"], folder);
  run("pnpm", ["run", "build"], folder);
}

/**
 * Prepares `@antelopejs/payment-subscriptions` at the pinned commit for the
 * renewal test, and returns where it is.
 *
 * Its package.json at that commit links `../interface-subscriptions` as a
 * sibling directory, so neither pnpm nor the core's git loader can install it
 * as it stands; the link is replaced by the same pinned interface before
 * building.
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
