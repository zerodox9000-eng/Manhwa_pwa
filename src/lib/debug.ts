const DEBUG_STORAGE_KEY = "manhwa-debug-logs";

export function shouldLogAppDebug() {
  try {
    return import.meta.env.DEV || localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
  } catch {
    return import.meta.env.DEV;
  }
}

export function appDebugLog(scope: string, message: string, data?: unknown) {
  if (!shouldLogAppDebug()) return;
  const prefix = `[ManhwaLib:${scope}] ${message}`;
  if (data === undefined) {
    console.info(prefix);
    return;
  }
  console.info(prefix, data);
}
