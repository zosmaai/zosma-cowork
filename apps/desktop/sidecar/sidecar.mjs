#!/usr/bin/env node
/**
 * Node.js Sidecar for Zosma Cowork
 *
 * This is the entry point for the Node.js sidecar process. It uses `jiti` to
 * dynamically load TypeScript extensions (Pi packages) and communicates with
 * the Rust backend via JSON messages over stdin/stdout IPC.
 *
 * Protocol: Each message is a single JSON line (one JSON object per line).
 *
 * Request (Rust -> Node):
 * { "id": 1, "type": "invoke", "payload": { "extensionId": "...", "toolName": "...", "args": { ... } } }
 * { "id": 2, "type": "list_tools", "payload": { "extensionId": "..." } }
 * { "id": 3, "type": "load_extension", "payload": { "extensionPath": "..." } }
 * { "id": 4, "type": "ready" }
 *
 * Response (Node -> Rust):
 * { "id": 1, "success": true, "result": { ... } }
 * { "id": 2, "success": false, "error": "extension not found" }
 */

import { createJiti } from 'jiti';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Loaded extensions registry
const extensions = new Map(); // extensionId -> { tools: Map<toolName, fn> }
let extensionsDir = '';

/**
 * Send a JSON response to stdout.
 */
function sendResponse(id, success, result = null, error = null) {
  const msg = JSON.stringify({ id, success, result, error });
  process.stdout.write(msg + '\n');
}

/**
 * Log to stderr (doesn't interfere with IPC).
 */
function log(...args) {
  process.stderr.write('[sidecar] ' + args.join(' ') + '\n');
}

/**
 * Read package.json to get extension ID.
 */
function readPackageJson(dir) {
  const pkgPath = resolve(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load an extension from a directory path.
 */
async function loadExtension(extensionPath) {
  const pkg = readPackageJson(extensionPath);
  if (!pkg) {
    return { success: false, error: `No package.json found at ${extensionPath}` };
  }

  const extId = pkg.name || extensionPath.split('/').pop();
  const jiti = createJiti(extensionPath, {
    interopDefault: true,
    alias: {},
    experimentalBun: false,
  });

  const tools = new Map();

  // Try to load extensions defined in package.json
  if (pkg.extensions && Array.isArray(pkg.extensions)) {
    for (const extEntry of pkg.extensions) {
      const extPath = typeof extEntry === 'string' ? extEntry : extEntry.entry;
      if (!extPath) continue;

      const fullPath = resolve(extensionPath, extPath);
      log(`Loading extension: ${fullPath}`);

      try {
        const mod = jiti(fullPath);
        // The extension factory function returns an object with tools
        const factory = mod.default || mod;
        if (typeof factory === 'function') {
          const extInstance = factory({ log, fs: await import('node:fs') });
          if (extInstance && extInstance.tools) {
            for (const [name, toolFn] of Object.entries(extInstance.tools)) {
              tools.set(name, toolFn);
              log(`  Registered tool: ${name}`);
            }
          }
        }
      } catch (err) {
        log(`Warning: Failed to load extension entry ${extPath}: ${err.message}`);
      }
    }
  }

  // Also try loading skills directory
  const skillsDir = resolve(extensionPath, 'skills');
  if (existsSync(skillsDir)) {
    const { readdirSync } = await import('node:fs');
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skillPath = resolve(skillsDir, entry.name, 'SKILL.md');
        if (existsSync(skillPath)) {
          log(`Found skill: ${entry.name} at ${skillPath}`);
          // Skills are markdown-based; register them as metadata for now
          tools.set(`skill:${entry.name}`, async ({ input }) => {
            const content = readFileSync(skillPath, 'utf-8');
            return { type: 'skill', name: entry.name, content };
          });
        }
      }
    }
  }

  extensions.set(extId, { tools, path: extensionPath, pkg });
  log(`Loaded extension ${extId} with ${tools.size} tool(s)`);

  return {
    success: true,
    result: { extensionId: extId, tools: [...tools.keys()] },
  };
}

/**
 * Invoke a tool in a loaded extension.
 */
async function invokeTool(extensionId, toolName, args) {
  const ext = extensions.get(extensionId);
  if (!ext) {
    return { success: false, error: `Extension not found: ${extensionId}` };
  }

  const toolFn = ext.tools.get(toolName);
  if (!toolFn) {
    return {
      success: false,
      error: `Tool not found in ${extensionId}: ${toolName}`,
    };
  }

  try {
    const result = await toolFn(args);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * List all tools in an extension.
 */
function listTools(extensionId) {
  const ext = extensions.get(extensionId);
  if (!ext) {
    return { success: false, error: `Extension not found: ${extensionId}` };
  }

  return {
    success: true,
    result: {
      extensionId,
      tools: [...ext.tools.keys()],
      path: ext.path,
    },
  };
}

/**
 * Scan and load all extensions in the extensions directory.
 */
async function scanExtensions() {
  if (!extensionsDir) return;

  const { readdirSync } = await import('node:fs');
  if (!existsSync(extensionsDir)) {
    log(`Extensions dir does not exist: ${extensionsDir}`);
    return;
  }

  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const extPath = resolve(extensionsDir, entry.name);
      log(`Scanning extension: ${extPath}`);
      await loadExtension(extPath);
    }
  }
}

/**
 * Main IPC loop.
 */
async function main() {
  log('Sidecar starting...');

  // Handle stdin line by line
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let request;
    try {
      request = JSON.parse(line);
    } catch {
      log(`Invalid JSON: ${line.substring(0, 100)}`);
      continue;
    }

    const { id, type, payload } = request;
    log(`Request id=${id} type=${type}`);

    try {
      switch (type) {
        case 'init':
          extensionsDir = payload.extensionsDir || '';
          log(`Initialized with extensionsDir: ${extensionsDir}`);
          // Scan for existing extensions
          await scanExtensions();
          sendResponse(id, true, { loaded: extensions.size });
          break;

        case 'ready':
          sendResponse(id, true, { status: 'ready', extensions: extensions.size });
          break;

        case 'load_extension':
          const loadResult = await loadExtension(payload.extensionPath);
          sendResponse(id, loadResult.success, loadResult.result, loadResult.error);
          break;

        case 'invoke':
          const invokeResult = await invokeTool(
            payload.extensionId,
            payload.toolName,
            payload.args
          );
          sendResponse(id, invokeResult.success, invokeResult.result, invokeResult.error);
          break;

        case 'list_tools':
          const listResult = listTools(payload.extensionId);
          sendResponse(id, listResult.success, listResult.result, listResult.error);
          break;

        case 'list_extensions':
          sendResponse(id, true, {
            extensions: [...extensions.entries()].map(([id, ext]) => ({
              id,
              tools: [...ext.tools.keys()],
              path: ext.path,
            })),
          });
          break;

        default:
          sendResponse(id, false, null, `Unknown request type: ${type}`);
      }
    } catch (err) {
      log(`Error handling request id=${id}: ${err.message}`);
      sendResponse(id, false, null, err.message);
    }
  }

  log('Sidecar shutting down (stdin closed)');
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
