import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server/create-server.js";
import type { Config } from "../src/core/types.js";

async function testConfig(): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), "d2r-router-"));
  return {
    deepseek_api_key: "sk-test",
    deepseek_base_url: "https://api.deepseek.com/v1",
    model_mapping: { "gpt-4.1": "deepseek-v4-pro" },
    host: "127.0.0.1",
    port: 19199,
    timeout: 10,
    stats_file: join(dir, "stats.jsonl"),
    log_file: join(dir, "app.log"),
    max_output_tokens_cap: 8192,
    unsupported_tools: "drop",
    tool_name_sanitize: true,
  };
}

function jsonResponse(body: any, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("server routes", () => {
  it("lists real DeepSeek models, not mapping aliases", async () => {
    const context = await createServer({ config: await testConfig(), fetchImpl: async () => jsonResponse({}) as any });
    const res = await context.app.inject({ method: "GET", url: "/v1/models" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((model: any) => model.id)).toEqual(["deepseek-v4-pro", "deepseek-v4-flash"]);
    await context.app.close();
  });

  it("handles non-streaming responses and stats", async () => {
    const context = await createServer({
      config: await testConfig(),
      fetchImpl: async () => jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }) as any,
    });

    const res = await context.app.inject({ method: "POST", url: "/v1/responses", headers: { authorization: "Bearer sk-test" }, payload: { model: "gpt-4.1", input: "hi" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().output[0].content[0].text).toBe("ok");

    const summary = await context.app.inject({ method: "GET", url: "/dashboard/api/summary" });
    expect(summary.json().totalRequests).toBe(1);
    await context.app.close();
  });

  it("rejects missing auth", async () => {
    const context = await createServer({ config: await testConfig(), fetchImpl: async () => jsonResponse({}) as any });
    const res = await context.app.inject({ method: "POST", url: "/v1/responses", payload: { model: "gpt-4.1", input: "hi" } });
    expect(res.statusCode).toBe(401);
    await context.app.close();
  });

  it("streams Responses SSE", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const context = await createServer({ config: await testConfig(), fetchImpl: async () => new Response(stream, { status: 200 }) as any });
    const res = await context.app.inject({ method: "POST", url: "/v1/responses", headers: { authorization: "Bearer sk-test" }, payload: { model: "gpt-4.1", input: "hi", stream: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("response.output_text.delta");
    expect(res.body).toContain("response.completed");
    await context.app.close();
  });
});
