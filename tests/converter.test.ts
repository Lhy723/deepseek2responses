import { describe, expect, it } from "vitest";
import { DeepSeekConverter, UnsupportedFeatureError } from "../src/core/converter.js";
import { ResponseStore } from "../src/core/responses-store.js";
import type { ResponseRequest } from "../src/core/types.js";

function converter(store = new ResponseStore(), options = {}) {
  return new DeepSeekConverter({ apiKey: "sk", baseUrl: "https://api.deepseek.com/v1", modelMapping: { "gpt-4.1": "deepseek-v4-pro" }, responseStore: store, ...options });
}

describe("DeepSeekConverter", () => {
  it("converts string input and fixed DeepSeek fields", async () => {
    const result = await converter().convertRequest({
      model: "gpt-4.1",
      input: "hello",
      max_output_tokens: 123,
      temperature: 0.2,
      top_p: 0.5,
      text: { format: { type: "json_object" } },
      parallel_tool_calls: false,
      user: "u-1",
    });

    expect(result.payload.model).toBe("deepseek-v4-pro");
    expect(result.payload.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(result.payload.max_tokens).toBe(123);
    expect(result.payload).not.toHaveProperty("max_completion_tokens");
    expect(result.payload.thinking).toEqual({ type: "enabled", reasoning_effort: "high" });
    expect(result.payload).not.toHaveProperty("temperature");
    expect(result.payload).not.toHaveProperty("top_p");
    expect(result.payload.response_format).toEqual({ type: "json_object" });
    expect(result.payload).not.toHaveProperty("parallel_tool_calls");
    expect(result.payload.user_id).toBe("u-1");
  });

  it("caps max_output_tokens before forwarding to DeepSeek", async () => {
    const result = await converter(new ResponseStore(), { maxOutputTokensCap: 393216 }).convertRequest({ model: "gpt-4.1", input: "hello", max_output_tokens: 500000 });
    expect(result.payload.max_tokens).toBe(393216);
    expect(result.diagnostics.maxOutputTokens).toBe(500000);
    expect(result.diagnostics.upstreamMaxTokens).toBe(393216);
  });

  it("maps high reasoning effort to max", async () => {
    const result = await converter().convertRequest({ model: "gpt-4.1", input: "hello", reasoning: { effort: "high" } });
    expect(result.payload.thinking).toEqual({ type: "enabled", reasoning_effort: "max" });
  });

  it("translates function/local/custom/namespace tools and sanitizes tool names", async () => {
    const result = await converter(new ResponseStore(), { unsupportedTools: "drop" }).convertRequest({
      model: "gpt-4.1",
      input: "hello",
      tools: [
        { type: "function", name: "fn.with/slash", parameters: { type: "object" }, strict: true },
        { type: "local_shell" },
        { type: "custom", name: "custom" },
        { type: "namespace", name: "browser", tools: [{ type: "function", name: "open.url" }] },
        { type: "web_search_preview" },
      ],
      tool_choice: { type: "function", name: "fn.with/slash" },
    });
    expect(result.payload.tools?.map((tool) => tool.function.name)).toEqual(["fn_with_slash", "shell", "custom", "browser_open_url"]);
    expect(result.payload.tool_choice).toEqual({ type: "function", function: { name: "fn_with_slash" } });
    expect(result.unsupportedWarnings[0]).toContain("web_search_preview");
  });

  it("throws on unsupported hosted tools by default", async () => {
    await expect(converter().convertRequest({ model: "gpt-4.1", input: "hello", tools: [{ type: "web_search_preview" }] })).rejects.toBeInstanceOf(UnsupportedFeatureError);
  });

  it("throws on input_file instead of silently dropping it", async () => {
    await expect(converter().convertRequest({ model: "gpt-4.1", input: [{ type: "input_file", file_id: "file_1" } as any] })).rejects.toBeInstanceOf(UnsupportedFeatureError);
  });

  it("uses previous_response_id history before current input and does not inherit instructions", async () => {
    const store = new ResponseStore();
    store.put({ responseId: "resp_prev", createdAt: 1, model: "gpt-4.1", messages: [{ role: "user", content: "old" }, { role: "assistant", content: "answer" }] });
    const result = await converter(store).convertRequest({ model: "gpt-4.1", previous_response_id: "resp_prev", instructions: "new system", input: "next" });
    expect(result.cacheHit).toBe(true);
    expect(result.payload.messages).toEqual([
      { role: "user", content: "old" },
      { role: "assistant", content: "answer" },
      { role: "system", content: "new system" },
      { role: "user", content: "next" },
    ]);
  });

  it("converts DeepSeek response with complete response fields and tool_calls completed", async () => {
    const response = await converter().convertResponse({
      choices: [{ finish_reason: "tool_calls", message: { reasoning_content: "think", content: "", tool_calls: [{ id: "call_1", function: { name: "fn", arguments: "{}" } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 7, prompt_cache_miss_tokens: 3, completion_tokens_details: { reasoning_tokens: 2 } },
    }, { model: "gpt-4.1", input: "hi", parallel_tool_calls: false, store: false } satisfies ResponseRequest);

    expect(response.status).toBe("completed");
    expect(response.parallel_tool_calls).toBe(false);
    expect(response.store).toBe(false);
    expect(response.output.map((item: any) => item.type)).toEqual(["reasoning", "function_call"]);
    expect(response.usage?.input_tokens_details?.cached_tokens).toBe(7);
    expect(response.usage?.output_tokens_details?.reasoning_tokens).toBe(2);
  });
});
