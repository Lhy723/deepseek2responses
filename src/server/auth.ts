import type { FastifyRequest } from "fastify";
import type { Config } from "../core/types.js";

export function verifyApiKey(request: FastifyRequest, config: Config, noAuth: boolean): void {
  if (noAuth || !config.deepseek_api_key) return;
  const auth = request.headers.authorization || "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== config.deepseek_api_key) {
    const error: any = new Error("Invalid or missing API key");
    error.statusCode = 401;
    error.payload = { error: { code: "unauthorized", message: "Invalid or missing API key" } };
    throw error;
  }
}
