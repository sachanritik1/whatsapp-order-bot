export type LogLevel = "info" | "warn" | "error";

export const serializeForLog = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (typeof value === "object" && value !== null) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }

  return value;
};

const writeLog = (level: LogLevel, payload: Record<string, unknown>) => {
  const line = JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    ...payload
  });

  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
};

export const logInfo = (event: string, payload: Record<string, unknown> = {}) =>
  writeLog("info", { event, ...payload });

export const logWarn = (event: string, payload: Record<string, unknown> = {}) =>
  writeLog("warn", { event, ...payload });

export const logError = (event: string, payload: Record<string, unknown> = {}) =>
  writeLog("error", { event, ...payload });
