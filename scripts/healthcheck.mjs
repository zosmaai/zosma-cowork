#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function webHealthRequest(env = process.env) {
  const port = env.PORT ?? "30141";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error(`invalid PORT: ${port}`);
  }
  const headers = {};
  if (env.PI_WEB_PASSWORD) {
    headers.authorization = `Basic ${Buffer.from(`pi:${env.PI_WEB_PASSWORD}`).toString("base64")}`;
  }
  return {
    url: `http://127.0.0.1:${port}/api/v1/health`,
    headers,
  };
}

export async function checkWebHealth({ env = process.env, fetchFn = fetch } = {}) {
  try {
    const { url, headers } = webHealthRequest(env);
    return (await fetchFn(url, { headers })).ok;
  } catch {
    return false;
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = (await checkWebHealth()) ? 0 : 1;
}