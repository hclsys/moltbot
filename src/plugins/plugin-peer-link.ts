import fs from "node:fs/promises";
import path from "node:path";
import { resolveOpenClawPackageRootSync } from "../infra/openclaw-root.js";

type PluginPeerLinkLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type RelinkManagedNpmRootResult = {
  checked: number;
  attempted: number;
};

export type PeerLinkAuditEntry = {
  packageDir: string;
  issue: "missing" | "stale";
  linkPath: string;
  currentTarget?: string;
  expectedTarget: string;
};

export type AuditOpenClawPeerLinkResult = {
  hostRoot: string | null;
  entries: PeerLinkAuditEntry[];
};

function readStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      record[key] = raw;
    }
  }
  return record;
}

async function readPackagePeerDependencies(packageDir: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(packageDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { peerDependencies?: unknown };
    return readStringRecord(parsed.peerDependencies);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function listManagedNpmRootPackageDirs(npmRoot: string): Promise<string[]> {
  const nodeModulesDir = path.join(npmRoot, "node_modules");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(nodeModulesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const packageDirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".bin") {
      continue;
    }
    const entryPath = path.join(nodeModulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      const scopedEntries = await fs.readdir(entryPath, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw error;
      });
      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.isDirectory()) {
          packageDirs.push(path.join(entryPath, scopedEntry.name));
        }
      }
      continue;
    }
    if (!entry.name.startsWith(".")) {
      packageDirs.push(entryPath);
    }
  }
  return packageDirs.toSorted((a, b) => a.localeCompare(b));
}

/**
 * Symlink the host openclaw package for plugins that declare it as a peer.
 * Plugin package managers still own third-party dependencies; this only wires
 * the host SDK package into the plugin-local Node graph.
 */
export async function linkOpenClawPeerDependencies(params: {
  installedDir: string;
  peerDependencies: Record<string, string>;
  logger: PluginPeerLinkLogger;
}): Promise<void> {
  const peers = Object.keys(params.peerDependencies).filter((name) => name === "openclaw");
  if (peers.length === 0) {
    return;
  }

  const hostRoot = resolveOpenClawPackageRootSync({
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
    cwd: process.cwd(),
  });
  if (!hostRoot) {
    params.logger.warn?.(
      "Could not locate openclaw package root to symlink peerDependencies; plugin may fail to resolve openclaw at runtime.",
    );
    return;
  }

  const nodeModulesDir = path.join(params.installedDir, "node_modules");
  await fs.mkdir(nodeModulesDir, { recursive: true });

  for (const peerName of peers) {
    const linkPath = path.join(nodeModulesDir, peerName);

    try {
      await fs.rm(linkPath, { recursive: true, force: true });
      await fs.symlink(hostRoot, linkPath, "junction");
      params.logger.info?.(`Linked peerDependency "${peerName}" -> ${hostRoot}`);
    } catch (err) {
      params.logger.warn?.(`Failed to symlink peerDependency "${peerName}": ${String(err)}`);
    }
  }
}

export async function relinkOpenClawPeerDependenciesInManagedNpmRoot(params: {
  npmRoot: string;
  logger: PluginPeerLinkLogger;
}): Promise<RelinkManagedNpmRootResult> {
  let checked = 0;
  let attempted = 0;
  for (const packageDir of await listManagedNpmRootPackageDirs(params.npmRoot)) {
    const peerDependencies = await readPackagePeerDependencies(packageDir);
    if (!Object.hasOwn(peerDependencies, "openclaw")) {
      continue;
    }
    checked += 1;
    await linkOpenClawPeerDependencies({
      installedDir: packageDir,
      peerDependencies,
      logger: params.logger,
    });
    attempted += 1;
  }
  return { checked, attempted };
}

export async function auditOpenClawPeerLinksInManagedNpmRoot(
  npmRoot: string,
): Promise<AuditOpenClawPeerLinkResult> {
  const hostRoot = resolveOpenClawPackageRootSync({
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
    cwd: process.cwd(),
  });
  const entries: PeerLinkAuditEntry[] = [];

  for (const packageDir of await listManagedNpmRootPackageDirs(npmRoot)) {
    const peerDependencies = await readPackagePeerDependencies(packageDir);
    if (!Object.hasOwn(peerDependencies, "openclaw")) {
      continue;
    }
    const linkPath = path.join(packageDir, "node_modules", "openclaw");
    if (!hostRoot) {
      continue;
    }
    let currentTarget: string | undefined;
    try {
      currentTarget = await fs.readlink(linkPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        entries.push({ packageDir, issue: "missing", linkPath, expectedTarget: hostRoot });
        continue;
      }
      if (code === "EINVAL") {
        // Not a symlink — treat as stale (real directory in place of expected link).
        try {
          await fs.access(linkPath);
          entries.push({
            packageDir,
            issue: "stale",
            linkPath,
            currentTarget: "<directory>",
            expectedTarget: hostRoot,
          });
        } catch {
          entries.push({ packageDir, issue: "missing", linkPath, expectedTarget: hostRoot });
        }
        continue;
      }
      continue;
    }
    const resolvedTarget = path.resolve(path.dirname(linkPath), currentTarget);
    if (resolvedTarget !== path.resolve(hostRoot)) {
      entries.push({
        packageDir,
        issue: "stale",
        linkPath,
        currentTarget,
        expectedTarget: hostRoot,
      });
    }
  }

  return { hostRoot, entries };
}
