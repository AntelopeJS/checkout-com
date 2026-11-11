import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";

import type { AssertGenuine as AssertGenuineSource } from "../../../src/implementations/payment/signature.ts";

export { WebhookVerificationError } from "@antelopejs/interface-payment";

interface SignatureExports {
  AssertGenuine?: typeof AssertGenuineSource;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE = path.join(root, "src/implementations/payment/signature.ts");

/**
 * Loads `AssertGenuine` from the TypeScript source of the module, compiled in
 * memory, so the check needs no build and runs on any checkout. A scratch copy
 * of the source, named by `WEBHOOK_SIGNATURE_SOURCE`, replaces it for the
 * mutation runs; its imports still resolve from the module's own folder.
 */
function loadAssertGenuine(): typeof AssertGenuineSource {
  const file = process.env.WEBHOOK_SIGNATURE_SOURCE ?? SOURCE;
  try {
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    });
    const compiled = vm.compileFunction(outputText, ["exports", "require"], { filename: file });
    const exported: SignatureExports = {};
    compiled(exported, createRequire(SOURCE));
    if (exported.AssertGenuine === undefined) {
      throw new Error("it does not export AssertGenuine");
    }
    return exported.AssertGenuine;
  } catch (error) {
    console.error(`cannot load AssertGenuine from ${file}: ${String(error)}`);
    return process.exit(2);
  }
}

export const AssertGenuine = loadAssertGenuine();
