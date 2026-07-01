import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config, RequestStatsRecord, ResponseRequest, Usage } from "../core/types.js";
import { maskSecret } from "../core/config.js";
import { logProxy, setLogFile } from "../core/logger.js";
import { DeepSeekConverter, UnsupportedFeatureError, extractUsageStats } from "../core/converter.js";
import { ResponseStore } from "../core/responses-store.js";
import { StatsStore } from "../core/stats-store.js";
import { generateId } from "../core/ids.js";
import { verifyApiKey } from "./auth.js";
import { readableStreamToLines, writeSseHeaders } from "./sse.js";

export interface CreateServerOptions {
  config: Config;
  noAuth?: boolean;
  rendererDir?: string;
  fetchImpl?: typeof fetch;
}

export interface ServerContext {
  app: FastifyInstance;
  converter: DeepSeekConverter;
  responseStore: ResponseStore;
  statsStore: StatsStore;
}

export async function createServer(options: CreateServerOptions): Promise<ServerContext> {
  setLogFile(options.config.log_file);
  logProxy("server_start", { host: options.config.host, port: options.config.port, logFile: options.config.log_file, statsFile: options.config.stats_file, noAuth: Boolean(options.noAuth) });
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  const responseStore = new ResponseStore();
  const converter = new DeepSeekConverter({
    apiKey: options.config.deepseek_api_key,
    baseUrl: options.config.deepseek_base_url,
    modelMapping: options.config.model_mapping,
    responseStore,
    maxOutputTokensCap: options.config.max_output_tokens_cap,
    unsupportedTools: options.config.unsupported_tools,
    sanitizeToolNames: options.config.tool_name_sanitize,
  });
  const statsStore = new StatsStore(options.config.stats_file);
  const fetcher = options.fetchImpl || fetch;

  await app.register(cors, { origin: true, credentials: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type"] });

  if (options.rendererDir && existsSync(options.rendererDir)) {
    await app.register(staticPlugin, { root: options.rendererDir, prefix: "/dashboard/" });
  }

  app.addHook("onRequest", async (request) => {
    logProxy("access", {
      method: request.method,
      url: request.url,
      hasAuthorization: Boolean(request.headers.authorization),
      contentType: request.headers["content-type"] || null,
      userAgent: request.headers["user-agent"] || null,
    });
  });

  app.addHook("preHandler", async (request) => {
    if (request.method === "OPTIONS" || request.url.startsWith("/dashboard")) return;
    if (request.url === "/" || request.url === "/v1" || request.url === "/models" || request.url === "/v1/models") return;
    try {
      verifyApiKey(request, options.config, Boolean(options.noAuth));
    } catch (error: any) {
      logProxy("auth_error", { url: request.url, method: request.method, message: error?.message || "Invalid or missing API key", hasAuthorization: Boolean(request.headers.authorization) });
      throw error;
    }
  });

  const modelList = () => ({
    object: "list",
    data: [
      { id: "deepseek-v4-pro", object: "model", created: 0, owned_by: "deepseek" },
      { id: "deepseek-v4-flash", object: "model", created: 0, owned_by: "deepseek" },
    ],
  });

  app.get("/", async () => ({ ok: true, name: "deepseek2responses", runtime: "node", models_url: "/v1/models", responses_url: "/v1/responses" }));
  app.get("/v1", async () => modelList());
  app.get("/models", async () => modelList());
  app.get("/v1/models", async () => modelList());

  const handleResponses = async (request: any, reply: any) => {
    const started = Date.now();
    const body = request.body as ResponseRequest;
    const requestId = generateId("req_");
    let converted;
    try {
      converted = await converter.convertRequest(body);
      converted.diagnostics.requestId = requestId;
      logProxy("request", { requestId, diagnostics: converted.diagnostics });
    } catch (error: any) {
      const statusCode = error instanceof UnsupportedFeatureError ? 400 : 500;
      const code = error instanceof UnsupportedFeatureError ? "unsupported_feature" : "conversion_error";
      const diagnostics = converted?.diagnostics ? { ...converted.diagnostics, requestId, upstreamError: error.message } : diagnoseFailedConversion(body, requestId, error.message);
      await recordStats(statsStore, requestId, body, null, converted?.cacheHit ?? null, started, "failed", code, converter.mapModel(body?.model || ""), diagnostics);
      logProxy("conversion_error", { requestId, statusCode, code, message: error.message, diagnostics });
      return reply.code(statusCode).send({ error: { code, message: error.message, request_id: requestId, diagnostics } });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.config.timeout * 1000);

    try {
      const upstream = await fetcher(converter.upstreamUrl, {
        method: "POST",
        headers: converter.authHeaders,
        body: JSON.stringify(converted.payload),
        signal: controller.signal,
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        const diagnostics = { ...converted.diagnostics, requestId, upstreamStatus: upstream.status, upstreamError: text.slice(0, 1000) };
        await recordStats(statsStore, requestId, body, null, converted.cacheHit, started, "failed", "provider_error", converted.payload.model, diagnostics);
        logProxy("provider_error", { requestId, status: upstream.status, body: text.slice(0, 1000), diagnostics });
        return reply.code(upstream.status).send({ error: { code: "provider_error", message: text, provider_status: upstream.status, upstream_url: converter.upstreamUrl, request_id: requestId, diagnostics } });
      }

      if (body.stream) {
        if (!upstream.body) throw new Error("Upstream stream body is empty");
        writeSseHeaders(reply);
        let result: { response: any; usage: Usage | null } | undefined;
        const stream = converter.convertStream(readableStreamToLines(upstream.body), body);
        while (true) {
          const next = await stream.next();
          if (next.done) {
            result = next.value;
            break;
          }
          reply.raw.write(next.value);
        }
        reply.raw.end();
        if (result?.response && (body.store ?? true)) {
          const messages = converter.buildCacheMessages(converted, result.response);
          converter.responseStore.put({ responseId: result.response.id, createdAt: result.response.created_at, model: body.model, messages });
        }
        const streamStatus = result?.response?.status === "in_progress" ? "completed" : (result?.response?.status || "completed");
        await recordStats(statsStore, requestId, body, result?.response || null, converted.cacheHit, started, streamStatus, result?.response?.error?.type || null, converted.payload.model, { ...converted.diagnostics, requestId });
        return reply;
      }

      const upstreamData = await upstream.json();
      const response = await converter.convertResponse(upstreamData, body);
      if (body.store ?? true) {
        const messages = converter.buildCacheMessages(converted, response);
        converter.responseStore.put({ responseId: response.id, createdAt: response.created_at, model: body.model, messages });
      }
        await recordStats(statsStore, requestId, body, response, converted.cacheHit, started, response.status === "in_progress" ? "completed" : response.status, response.error?.type || null, converted.payload.model, { ...converted.diagnostics, requestId });
      return reply.send(response);
    } catch (error: any) {
      const aborted = error?.name === "AbortError";
      const code = aborted ? "gateway_timeout" : "bad_gateway";
      const diagnostics = { ...converted.diagnostics, requestId, upstreamError: errorDetail(error) };
      await recordStats(statsStore, requestId, body, null, converted.cacheHit, started, "failed", code, converted.payload.model, diagnostics);
      logProxy("upstream_exception", { requestId, code, message: errorMessage(error), detail: errorDetail(error), diagnostics });
      return reply.code(aborted ? 504 : 502).send({ error: { code, message: aborted ? "Upstream API timeout" : errorMessage(error), detail: errorDetail(error), upstream_url: converter.upstreamUrl, request_id: requestId, diagnostics } });
    } finally {
      clearTimeout(timeout);
    }
  };

  app.post("/v1/responses", handleResponses);
  app.post("/responses", handleResponses);

  app.get("/dashboard/api/summary", async () => statsStore.summary());
  app.get("/dashboard/api/requests", async (request: any) => statsStore.recent(Number(request.query?.limit || 100)));
  app.get("/dashboard/api/tokens", async (request: any) => statsStore.tokensByHour(Number(request.query?.hours || 24)));
  app.get("/dashboard/api/cache", async () => responseStore.stats());
  app.get("/dashboard/api/runtime", async () => ({
    host: options.config.host,
    port: options.config.port,
    baseUrl: options.config.deepseek_base_url,
    timeout: options.config.timeout,
    configAuth: Boolean(options.config.deepseek_api_key),
    noAuth: Boolean(options.noAuth),
    apiKey: maskSecret(options.config.deepseek_api_key),
    modelMapping: options.config.model_mapping,
    statsFile: options.config.stats_file,
  }));

  app.setNotFoundHandler((request, reply) => {
    logProxy("not_found", { method: request.method, url: request.url });
    return reply.code(404).send({ error: { code: "not_found", message: `Route ${request.method} ${request.url} not found` } });
  });

  app.setErrorHandler((error: any, request, reply) => {
    logProxy("internal_error", { method: request.method, url: request.url, statusCode: error.statusCode || 500, message: error.message || "Internal server error" });
    if (error.payload) return reply.code(error.statusCode || 500).send(error.payload);
    return reply.code(error.statusCode || 500).send({ error: { code: "internal_error", message: error.message || "Internal server error" } });
  });

  return { app, converter, responseStore, statsStore };
}

async function recordStats(statsStore: StatsStore, requestId: string, body: ResponseRequest, response: any, responseCacheHit: boolean | null, started: number, status: RequestStatsRecord["status"], errorCode: string | null, upstreamModel: string, diagnostics?: RequestStatsRecord["diagnostics"]): Promise<void> {
  const usageStats = extractUsageStats(response?.usage || null);
  await statsStore.append({
    id: requestId,
    responseId: response?.id || null,
    timestamp: new Date().toISOString(),
    model: body?.model || "",
    upstreamModel,
    stream: Boolean(body?.stream),
    status,
    durationMs: Date.now() - started,
    ...usageStats,
    responseCacheHit,
    errorCode,
    diagnostics,
  });
}

function diagnoseFailedConversion(body: ResponseRequest | undefined, requestId: string, message: string) {
  const inputTypes: Record<string, number> = {};
  if (typeof body?.input === "string") inputTypes.string = 1;
  else if (Array.isArray(body?.input)) {
    for (const item of body.input) {
      const type = (item as any)?.type || "message";
      inputTypes[type] = (inputTypes[type] || 0) + 1;
    }
  }
  const toolTypes: Record<string, number> = {};
  for (const tool of body?.tools || []) {
    const type = (tool as any)?.type || "unknown";
    toolTypes[type] = (toolTypes[type] || 0) + 1;
  }
  return {
    requestId,
    model: body?.model || "",
    upstreamModel: body?.model || "",
    stream: Boolean(body?.stream),
    maxOutputTokens: body?.max_output_tokens ?? null,
    upstreamMaxTokens: null,
    inputTypes,
    toolTypes,
    toolCount: body?.tools?.length || 0,
    toolChoice: typeof body?.tool_choice === "string" ? body.tool_choice : (body?.tool_choice as any)?.type,
    textFormat: (body?.text as any)?.format?.type,
    include: body?.include ?? null,
    previousResponseId: body?.previous_response_id ?? null,
    payloadBytes: body ? Buffer.byteLength(JSON.stringify(body), "utf8") : 0,
    warnings: [],
    upstreamError: message,
  };
}

function errorMessage(error: any): string {
  return error?.message || String(error) || "Upstream API unreachable";
}

function errorDetail(error: any): string {
  const cause = error?.cause;
  const parts = [error?.name, error?.message, cause?.code, cause?.message].filter(Boolean);
  return parts.join(": ") || String(error);
}

export async function listenServer(options: CreateServerOptions): Promise<ServerContext> {
  const context = await createServer(options);
  await context.app.listen({ host: options.config.host, port: options.config.port });
  return context;
}
