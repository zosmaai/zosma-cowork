import { stat } from "fs/promises";
import { resolve } from "path";
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { BackendError } from "@/packages/pi-backend/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
    const cwd = resolve(requestedCwd);

    let cwdStat;
    try {
      cwdStat = await stat(cwd);
    } catch {
      throw new BackendError("invalid_request", `Directory does not exist: ${cwd}`);
    }
    if (!cwdStat.isDirectory()) {
      throw new BackendError("invalid_request", `Not a directory: ${cwd}`);
    }
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      throw new BackendError("access_denied", "Access denied");
    }

    return apiSuccess(await getPiBackend().getModels({ cwd }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}