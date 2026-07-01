import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

let logFilePath: string | null = null;

export function setLogFile(path: string): void {
  logFilePath = path;
}

export function getLogFile(): string | null {
  return logFilePath;
}

export function logProxy(event: string, payload: Record<string, any>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...payload });
  console.error(`[deepseek2responses] ${line}`);
  if (logFilePath) {
    void appendLog(logFilePath, line);
  }
}

async function appendLog(path: string, line: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${line}\n`, "utf8");
  } catch (error) {
    console.error(`[deepseek2responses] failed to write log file: ${error instanceof Error ? error.message : String(error)}`);
  }
}
