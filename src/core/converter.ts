import type {
  ChatMessage,
  ChatToolCall,
  ConvertedRequest,
  DeepSeekPayload,
  FunctionCall,
  FunctionCallOutput,
  InputItem,
  InputMessage,
  OutputMessage,
  ReasoningItem,
  RequestDiagnostics,
  ResponseObject,
  ResponseRequest,
  ToolDef,
  Usage,
} from "./types.js";
import { generateId } from "./ids.js";
import { ResponseStore, stripInstructionMessages } from "./responses-store.js";

const LOCAL_SHELL_FN = {
  type: "function",
  function: {
    name: "shell",
    description: "Execute a shell command on the local machine. Returns stdout, stderr and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "array", items: { type: "string" }, description: "Argv array, e.g. [\"ls\", \"-la\"]." },
        workdir: { type: "string", description: "Working directory (optional)." },
        timeout_ms: { type: "number", description: "Timeout in milliseconds (optional, default 30000)." },
      },
      required: ["command"],
    },
  },
};

const SERVER_SIDE_TOOLS = new Set(["code_interpreter", "file_search", "image_generation", "computer_use_preview", "computer_use", "web_search", "web_search_preview", "web_search_preview_2025_03_11"]);

export class UnsupportedFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFeatureError";
  }
}

export interface ConverterOptions {
  apiKey: string;
  baseUrl: string;
  modelMapping: Record<string, string>;
  responseStore?: ResponseStore;
  maxOutputTokensCap?: number;
  unsupportedTools?: "error" | "drop";
  sanitizeToolNames?: boolean;
}

export class DeepSeekConverter {
  readonly responseStore: ResponseStore;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelMapping: Record<string, string>;
  private readonly maxOutputTokensCap: number;
  private readonly unsupportedTools: "error" | "drop";
  private readonly sanitizeToolNames: boolean;
  private readonly toolNameBySafeName = new Map<string, string>();

  constructor(options: ConverterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.modelMapping = options.modelMapping;
    this.maxOutputTokensCap = options.maxOutputTokensCap ?? 8192;
    this.unsupportedTools = options.unsupportedTools ?? "error";
    this.sanitizeToolNames = options.sanitizeToolNames ?? true;
    this.responseStore = options.responseStore || new ResponseStore();
  }

  get upstreamUrl(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  get authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  mapModel(model: string): string {
    return this.modelMapping[model] || model;
  }

  async convertRequest(request: ResponseRequest): Promise<ConvertedRequest> {
    const unsupportedWarnings: string[] = [];
    const currentMessages: ChatMessage[] = [];

    if (request.instructions) {
      currentMessages.push({ role: "system", content: request.instructions });
    }

    const inputMessages = this.convertInputToMessages(request.input);
    currentMessages.push(...inputMessages);

    let conversationPrefix: ChatMessage[] = [];
    let cacheHit: boolean | null = null;
    if (request.previous_response_id) {
      const cached = this.responseStore.get(request.previous_response_id);
      cacheHit = Boolean(cached);
      if (cached) conversationPrefix = cached.messages;
    }

    const messages = [...conversationPrefix, ...currentMessages];
    removeOrphanToolMessages(messages);
    ensureToolCallsHaveOutputs(messages);

    const payload: DeepSeekPayload = {
      model: this.mapModel(request.model),
      messages,
      stream: Boolean(request.stream),
    };

    if (request.stream) payload.stream_options = { include_usage: true };
    if (request.max_output_tokens != null) payload.max_tokens = Math.min(request.max_output_tokens, this.maxOutputTokensCap);
    if (request.stop != null) payload.stop = request.stop;

    const userId = request.user_id || request.user;
    if (userId) payload.user_id = userId;

    const thinking = buildThinking(request);
    payload.thinking = thinking;
    if (thinking.type !== "enabled") {
      if (request.temperature != null) payload.temperature = request.temperature;
      if (request.top_p != null) payload.top_p = request.top_p;
    }

    const responseFormat = mapTextFormat(request.text);
    if (responseFormat) payload.response_format = responseFormat;

    if (request.tools?.length) {
      const chatTools: any[] = [];
      for (const tool of request.tools) {
        const translated = this.translateTool(tool);
        if (translated.unsupported) {
          unsupportedWarnings.push(translated.unsupported);
          if (this.unsupportedTools === "error") throw new UnsupportedFeatureError(translated.unsupported);
        }
        chatTools.push(...translated.tools);
      }
      if (chatTools.length) {
        payload.tools = chatTools;
        const choice = this.translateToolChoice(request.tool_choice);
        if (choice != null) payload.tool_choice = choice;
      }
    }

    const diagnostics = buildDiagnostics(request, payload, unsupportedWarnings);
    return { payload, cacheHit, unsupportedWarnings, diagnostics, conversationPrefix, currentMessages: stripInstructionMessages(currentMessages) };
  }

  convertInputToMessages(input: ResponseRequest["input"]): ChatMessage[] {
    if (typeof input === "string") return [{ role: "user", content: input }];

    const messages: ChatMessage[] = [];
    let pending: ChatMessage | null = null;

    const flushPending = () => {
      if (!pending) return;
      if (pending.content == null && !pending.tool_calls?.length) pending.content = "";
      messages.push(pending);
      pending = null;
    };

    for (const rawItem of input) {
      const item = toObject(rawItem) as any;
      const itemType = item.type || "message";
      if (itemType === "input_file") {
        throw new UnsupportedFeatureError("input_file is not supported by DeepSeek Chat Completions in Codex-priority mode");
      }
      if (itemType === "message" || (!isSpecialItemType(itemType) && item.role)) {
        const role = item.role || "user";
        if (role === "system" || role === "developer") {
          const text = flattenToText(item.content || "");
          if (text) messages.push({ role: "system", content: text });
        } else if (role === "assistant") {
          flushPending();
          const content = flattenInput(item.content || "");
          if (typeof content === "string") {
            pending = { role: "assistant", content };
          } else {
            const toolUses = content.filter((part) => part.type === "tool_use");
            const text = content.filter((part) => part.type === "text").map((part) => part.text || "").join("");
            pending = { role: "assistant", content: text || null } as ChatMessage;
            if (toolUses.length) {
              pending.tool_calls = toolUses.map((part) => ({
                id: part.id || generateId("call_"),
                type: "function",
                function: { name: part.name || "", arguments: JSON.stringify(part.input || {}) },
              }));
            }
          }
        } else if (role === "tool") {
          flushPending();
          messages.push({ role: "tool", tool_call_id: item.tool_call_id || item.call_id || "", content: flattenOutputContent(item.content || "") });
        } else {
          flushPending();
          messages.push({ role: "user", content: flattenInput(item.content || "") });
        }
      } else if (itemType === "function_call") {
        const call: ChatToolCall = {
          id: item.call_id || generateId("call_"),
          type: "function",
          function: { name: item.name || "", arguments: item.arguments || "" },
        };
        if (pending?.role === "assistant") {
          pending.tool_calls = pending.tool_calls || [];
          pending.tool_calls.push(call);
        } else {
          flushPending();
          pending = { role: "assistant", content: null, tool_calls: [call] };
        }
      } else if (itemType === "function_call_output") {
        flushPending();
        messages.push({ role: "tool", tool_call_id: item.call_id || "", content: flattenOutputContent(item.output || "") });
      } else if (itemType === "reasoning") {
        const encrypted = item.encrypted_content || "";
        if (encrypted && pending?.role === "assistant") {
          pending.reasoning_content = encrypted;
          if (pending.content == null && !pending.tool_calls?.length) pending.content = "";
        } else if (encrypted) {
          flushPending();
          pending = { role: "assistant", content: "", reasoning_content: encrypted };
        }
      }
    }

    flushPending();
    return messages;
  }

  async convertResponse(responseData: any, request: ResponseRequest): Promise<ResponseObject> {
    const choice = (responseData.choices || [{}])[0];
    const message = choice.message || {};
    const finishReason = choice.finish_reason || "stop";
    const output: ResponseObject["output"] = [];

    const reasoningText = message.reasoning_content || "";
    if (reasoningText) {
      output.push({
        id: generateId("rsn_"),
        type: "reasoning",
        summary: [{ type: "summary_text", text: reasoningText }],
        encrypted_content: reasoningText,
        status: "completed",
      } satisfies ReasoningItem);
    }

    const text = message.content || "";
    if (text) {
      output.push({
        id: generateId("msg_"),
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      } satisfies OutputMessage);
    }

    for (const toolCall of message.tool_calls || []) {
      const fn = toolCall.function || {};
      output.push({
        id: generateId("fc_"),
        type: "function_call",
        call_id: toolCall.id || "",
        name: fn.name || "",
        arguments: fn.arguments || "",
        status: "completed",
      } satisfies FunctionCall);
    }

    if (!output.length) {
      output.push({
        id: generateId("msg_"),
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: "", annotations: [] }],
      } satisfies OutputMessage);
    }

    const { status, incompleteDetails, error } = mapFinishReason(finishReason);
    return buildResponseObject(request, output, mapUsage(responseData.usage), status, incompleteDetails, error);
  }

  buildCacheMessages(converted: ConvertedRequest, response: ResponseObject): ChatMessage[] {
    const assistantMessages = responseOutputToChatMessages(response.output);
    return [...converted.conversationPrefix, ...converted.currentMessages, ...assistantMessages];
  }

  private safeToolName(name: string): string {
    if (!this.sanitizeToolNames) return name;
    let safe = name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (!safe) safe = "tool";
    safe = safe.slice(0, 64);
    let unique = safe;
    let suffix = 2;
    while (this.toolNameBySafeName.has(unique) && this.toolNameBySafeName.get(unique) !== name) {
      const tail = `_${suffix++}`;
      unique = `${safe.slice(0, 64 - tail.length)}${tail}`;
    }
    this.toolNameBySafeName.set(unique, name);
    return unique;
  }

  private translateTool(tool: ToolDef, namespace?: string): { tools: any[]; unsupported?: string } {
    const t = tool as any;
    const type = t?.type;
    if (type === "function") {
      const rawName = namespace && t.name ? `${namespace}__${t.name}` : t.name;
      if (!rawName) return { tools: [] };
      const fn: any = { name: this.safeToolName(rawName) };
      if (t.description) fn.description = t.description;
      if (t.parameters) fn.parameters = t.parameters;
      if (typeof t.strict === "boolean") fn.strict = t.strict;
      return { tools: [{ type: "function", function: fn }] };
    }
    if (type === "local_shell") return { tools: [{ ...LOCAL_SHELL_FN, function: { ...LOCAL_SHELL_FN.function, name: this.safeToolName(namespace ? `${namespace}__shell` : "shell") } }] };
    if (type === "custom") {
      const rawName = namespace && t.name ? `${namespace}__${t.name}` : t.name;
      if (!rawName) return { tools: [] };
      const fmtType = t.format?.type;
      const description = `${t.description || ""}${fmtType ? ` (originally a \"${fmtType}\"-format custom tool).` : ""}`.trim();
      return { tools: [{ type: "function", function: { name: this.safeToolName(rawName), description: description || undefined, parameters: { type: "object", properties: { input: { type: "string", description: "Input text." } }, additionalProperties: true } } }] };
    }
    if (type === "namespace") {
      const out: any[] = [];
      const ns = [namespace, t.name].filter(Boolean).join("__") || namespace;
      for (const inner of t.tools || []) out.push(...this.translateTool(inner, ns).tools);
      return { tools: out };
    }
    if (SERVER_SIDE_TOOLS.has(type)) return { tools: [], unsupported: `Tool type \"${type}\" is not supported by DeepSeek Chat Completions proxy mode` };
    return { tools: [] };
  }

  private translateToolChoice(choice: ResponseRequest["tool_choice"]): any {
    if (choice == null) return undefined;
    if (typeof choice === "string") return choice;
    const c = choice as any;
    if (c.type === "function") {
      const name = c.function?.name || c.name || "";
      return { type: "function", function: { name: this.safeToolName(name) } };
    }
    return undefined;
  }

  async *convertStream(lines: AsyncIterable<string>, request: ResponseRequest): AsyncGenerator<string, { response: ResponseObject; usage: Usage | null }, unknown> {
    const responseId = generateId("resp_");
    const createdAt = Math.floor(Date.now() / 1000);
    let seq = 0;
    let outputIndex = 0;
    let activeKind: "message" | "reasoning" | null = null;
    let activeId = "";
    let activeBuffer = "";
    let reasoningBuffer = "";
    const finalOutput: ResponseObject["output"] = [];
    const toolCalls = new Map<number, { itemId: string; outputIndex: number; callId: string; name: string; args: string }>();
    let usage: Usage | null = null;
    let finishReason: string | null = null;

    const emit = (event: string, data: any) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const snapshot = (status: ResponseObject["status"], out: ResponseObject["output"], usageValue: Usage | null, extra: Partial<ResponseObject> = {}) => ({
      ...buildResponseObject(request, out, usageValue, status, null, null, responseId, createdAt),
      ...extra,
    });

    yield emit("response.created", { type: "response.created", sequence_number: seq++, response: snapshot("in_progress", [], null) });
    yield emit("response.in_progress", { type: "response.in_progress", sequence_number: seq++, response: snapshot("in_progress", [], null) });

    const finalizeActive = function* (): Generator<string> {
      if (!activeKind) return;
      const oi = outputIndex - 1;
      if (activeKind === "message") {
        yield emit("response.output_text.done", { type: "response.output_text.done", sequence_number: seq++, item_id: activeId, output_index: oi, content_index: 0, text: activeBuffer });
        yield emit("response.content_part.done", { type: "response.content_part.done", sequence_number: seq++, item_id: activeId, output_index: oi, content_index: 0, part: { type: "output_text", text: activeBuffer, annotations: [] } });
        const item: OutputMessage = { id: activeId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: activeBuffer, annotations: [] }] };
        finalOutput.push(item);
        yield emit("response.output_item.done", { type: "response.output_item.done", sequence_number: seq++, output_index: oi, item });
      } else {
        yield emit("response.reasoning_summary_text.done", { type: "response.reasoning_summary_text.done", sequence_number: seq++, item_id: activeId, output_index: oi, summary_index: 0, text: reasoningBuffer });
        yield emit("response.reasoning_summary_part.done", { type: "response.reasoning_summary_part.done", sequence_number: seq++, item_id: activeId, output_index: oi, summary_index: 0, part: { type: "summary_text", text: reasoningBuffer } });
        const item: ReasoningItem = { id: activeId, type: "reasoning", summary: [{ type: "summary_text", text: reasoningBuffer }], encrypted_content: reasoningBuffer, status: "completed" };
        finalOutput.push(item);
        yield emit("response.output_item.done", { type: "response.output_item.done", sequence_number: seq++, output_index: oi, item });
      }
      activeKind = null;
      activeId = "";
      activeBuffer = "";
      reasoningBuffer = "";
    };

    const openMessage = function* (): Generator<string> {
      yield* finalizeActive();
      activeKind = "message";
      activeId = generateId("msg_");
      activeBuffer = "";
      const oi = outputIndex++;
      yield emit("response.output_item.added", { type: "response.output_item.added", sequence_number: seq++, output_index: oi, item: { id: activeId, type: "message", role: "assistant", status: "in_progress", content: [] } });
      yield emit("response.content_part.added", { type: "response.content_part.added", sequence_number: seq++, item_id: activeId, output_index: oi, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
    };

    const openReasoning = function* (): Generator<string> {
      yield* finalizeActive();
      activeKind = "reasoning";
      activeId = generateId("rsn_");
      reasoningBuffer = "";
      const oi = outputIndex++;
      yield emit("response.output_item.added", { type: "response.output_item.added", sequence_number: seq++, output_index: oi, item: { id: activeId, type: "reasoning", summary: [], encrypted_content: null, status: "in_progress" } });
      yield emit("response.reasoning_summary_part.added", { type: "response.reasoning_summary_part.added", sequence_number: seq++, item_id: activeId, output_index: oi, summary_index: 0, part: { type: "summary_text", text: "" } });
    };

    try {
      for await (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line === "data: [DONE]" || line === "[DONE]") {
          if (line.includes("[DONE]")) break;
          continue;
        }
        if (!line.startsWith("data: ")) continue;
        const chunk = safeJsonParse(line.slice(6));
        if (!chunk) continue;

        if (chunk.usage) usage = mapUsage(chunk.usage);
        const choice = (chunk.choices || [{}])[0];
        const delta = choice.delta || {};
        if (choice.finish_reason) finishReason = choice.finish_reason;

        if (delta.reasoning_content) {
          if (activeKind !== "reasoning") yield* openReasoning();
          reasoningBuffer += delta.reasoning_content;
          yield emit("response.reasoning_summary_text.delta", { type: "response.reasoning_summary_text.delta", sequence_number: seq++, item_id: activeId, output_index: outputIndex - 1, summary_index: 0, delta: delta.reasoning_content });
        }

        if (delta.content) {
          if (activeKind !== "message") yield* openMessage();
          activeBuffer += delta.content;
          yield emit("response.output_text.delta", { type: "response.output_text.delta", sequence_number: seq++, item_id: activeId, output_index: outputIndex - 1, content_index: 0, delta: delta.content });
        }

        for (const toolDelta of delta.tool_calls || []) {
          const idx = toolDelta.index || 0;
          if (!toolCalls.has(idx)) {
            yield* finalizeActive();
            const itemId = generateId("fc_");
            const oi = outputIndex++;
            const state = { itemId, outputIndex: oi, callId: toolDelta.id || "", name: toolDelta.function?.name || "", args: "" };
            toolCalls.set(idx, state);
            yield emit("response.output_item.added", { type: "response.output_item.added", sequence_number: seq++, output_index: oi, item: { id: itemId, type: "function_call", call_id: state.callId, name: state.name, arguments: "", status: "in_progress" } });
          }
          const state = toolCalls.get(idx)!;
          if (toolDelta.function?.name && !state.name) state.name = toolDelta.function.name;
          const argsDelta = toolDelta.function?.arguments || "";
          if (argsDelta) {
            state.args += argsDelta;
            yield emit("response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", sequence_number: seq++, item_id: state.itemId, output_index: state.outputIndex, delta: argsDelta });
          }
        }
      }

      yield* finalizeActive();
      for (const idx of [...toolCalls.keys()].sort((a, b) => a - b)) {
        const state = toolCalls.get(idx)!;
        yield emit("response.function_call_arguments.done", { type: "response.function_call_arguments.done", sequence_number: seq++, item_id: state.itemId, output_index: state.outputIndex, arguments: state.args });
        const item: FunctionCall = { id: state.itemId, type: "function_call", call_id: state.callId, name: state.name, arguments: state.args, status: "completed" };
        finalOutput.push(item);
        yield emit("response.output_item.done", { type: "response.output_item.done", sequence_number: seq++, output_index: state.outputIndex, item });
      }

      const { status, incompleteDetails, error } = mapFinishReason(finishReason || "stop");
      const response = snapshot(status, finalOutput.length ? finalOutput : [{ id: generateId("msg_"), type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "", annotations: [] }] }], usage, { incomplete_details: incompleteDetails, error });
      yield emit("response.completed", { type: "response.completed", sequence_number: seq++, response });
      return { response, usage };
    } catch (error: any) {
      yield* finalizeActive();
      const failed = snapshot("failed", finalOutput, usage, { error: { type: "upstream_error", message: error?.message || String(error) } });
      yield emit("response.failed", { type: "response.failed", sequence_number: seq++, response: failed });
      return { response: failed, usage };
    }
  }
}

function buildThinking(request: ResponseRequest): { type: "enabled"; reasoning_effort: "high" | "max" } {
  const effort = request.reasoning?.effort || "medium";
  return { type: "enabled", reasoning_effort: effort === "high" ? "max" : "high" };
}

function mapTextFormat(text: any): { type: "json_object" } | null {
  const type = text?.format?.type;
  if (type === "json_object" || type === "json_schema") return { type: "json_object" };
  return null;
}

function buildDiagnostics(request: ResponseRequest, payload: DeepSeekPayload, warnings: string[]): RequestDiagnostics {
  const inputTypes: Record<string, number> = {};
  if (typeof request.input === "string") {
    inputTypes.string = 1;
  } else {
    for (const item of request.input || []) {
      const type = (item as any)?.type || "message";
      inputTypes[type] = (inputTypes[type] || 0) + 1;
    }
  }

  const toolTypes: Record<string, number> = {};
  for (const tool of request.tools || []) {
    const type = (tool as any)?.type || "unknown";
    toolTypes[type] = (toolTypes[type] || 0) + 1;
  }

  return {
    model: request.model,
    upstreamModel: payload.model,
    stream: Boolean(request.stream),
    maxOutputTokens: request.max_output_tokens ?? null,
    upstreamMaxTokens: payload.max_tokens ?? null,
    inputTypes,
    toolTypes,
    toolCount: request.tools?.length || 0,
    toolChoice: typeof request.tool_choice === "string" ? request.tool_choice : (request.tool_choice as any)?.type,
    textFormat: (request.text as any)?.format?.type,
    include: request.include ?? null,
    previousResponseId: request.previous_response_id ?? null,
    payloadBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    warnings,
  };
}

function toObject(item: any): Record<string, any> {
  return item && typeof item === "object" ? item : {};
}

function isSpecialItemType(type: string): boolean {
  return ["function_call", "function_call_output", "reasoning", "input_text", "output_text", "input_image", "input_file"].includes(type);
}

function flattenInput(content: any): string | any[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  const parts: any[] = [];
  for (const raw of content) {
    const part = toObject(raw);
    if (part.type === "input_text" || part.type === "output_text") parts.push({ type: "text", text: part.text || "" });
    else if (part.type === "input_image") {
      if (part.file_id) throw new UnsupportedFeatureError("input_image.file_id is not supported by DeepSeek Chat Completions proxy mode");
      const image: any = { type: "image_url", image_url: { url: part.image_url || "" } };
      if (part.detail) image.image_url.detail = part.detail;
      parts.push(image);
    } else if (part.type === "input_file") throw new UnsupportedFeatureError("input_file is not supported by DeepSeek Chat Completions proxy mode");
    else if (part.type === "function_call") {
      let args = {};
      try { args = typeof part.arguments === "string" ? JSON.parse(part.arguments || "{}") : part.arguments || {}; } catch {}
      parts.push({ type: "tool_use", id: part.call_id || "", name: part.name || "", input: args });
    } else if (part.type === "function_call_output") {
      parts.push({ type: "tool_result", tool_use_id: part.call_id || "", content: flattenOutputContent(part.output || "") });
    }
  }
  if (parts.length && parts.every((part) => part.type === "text")) return parts.map((part) => part.text).join("");
  return parts.length ? parts : "";
}

function flattenToText(content: any): string {
  const flattened = flattenInput(content);
  if (typeof flattened === "string") return flattened;
  return flattened.filter((part) => part.type === "text").map((part) => part.text || "").join("");
}

function flattenOutputContent(output: any): string {
  if (typeof output === "string") return output;
  if (!Array.isArray(output)) return String(output ?? "");
  return output.map((part) => {
    const p = toObject(part);
    return p.type === "input_text" || p.type === "output_text" ? p.text || "" : "";
  }).join("");
}

export function removeOrphanToolMessages(messages: ChatMessage[]): void {
  let validIds: Set<string> | null = null;
  let i = 0;
  while (i < messages.length) {
    const message = messages[i]!;
    if (message.role === "assistant") {
      const calls = message.tool_calls || [];
      validIds = calls.length ? new Set(calls.map((call) => call.id).filter(Boolean)) : null;
      i += 1;
    } else if (message.role === "tool") {
      if (validIds?.has(message.tool_call_id || "")) i += 1;
      else messages.splice(i, 1);
    } else {
      validIds = null;
      i += 1;
    }
  }
}

export function ensureToolCallsHaveOutputs(messages: ChatMessage[]): void {
  const existing = new Set(messages.filter((m) => m.role === "tool" && m.tool_call_id).map((m) => m.tool_call_id!));
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    if (message.role !== "assistant" || !message.tool_calls?.length) continue;
    let insertAt = i + 1;
    while (insertAt < messages.length && messages[insertAt]!.role === "tool") insertAt += 1;
    for (const call of message.tool_calls) {
      if (!existing.has(call.id)) {
        messages.splice(insertAt, 0, { role: "tool", tool_call_id: call.id, content: "[tool output missing]" });
        existing.add(call.id);
        insertAt += 1;
      }
    }
  }
}

function mapUsage(data: any): Usage {
  const inputDetails: any = data?.prompt_tokens_details ? { ...data.prompt_tokens_details } : {};
  if (typeof data?.prompt_cache_hit_tokens === "number") inputDetails.cached_tokens = data.prompt_cache_hit_tokens;
  if (typeof data?.prompt_cache_miss_tokens === "number") inputDetails.cache_miss_tokens = data.prompt_cache_miss_tokens;
  return {
    input_tokens: data?.prompt_tokens || 0,
    output_tokens: data?.completion_tokens || 0,
    total_tokens: data?.total_tokens || 0,
    input_tokens_details: Object.keys(inputDetails).length ? inputDetails : undefined,
    output_tokens_details: data?.completion_tokens_details || undefined,
  };
}

function mapFinishReason(finishReason: string): { status: ResponseObject["status"]; incompleteDetails: any; error: any } {
  if (finishReason === "length") return { status: "incomplete", incompleteDetails: { reason: "max_output_tokens" }, error: null };
  if (finishReason === "content_filter") return { status: "incomplete", incompleteDetails: { reason: "content_filter" }, error: null };
  if (finishReason === "insufficient_system_resource") return { status: "failed", incompleteDetails: null, error: { type: "provider_error", message: "DeepSeek reported insufficient_system_resource" } };
  return { status: "completed", incompleteDetails: null, error: null };
}

function buildResponseObject(request: ResponseRequest, output: ResponseObject["output"], usage: Usage | null, status: ResponseObject["status"], incompleteDetails: any, error: any, responseId = generateId("resp_"), createdAt = Math.floor(Date.now() / 1000)): ResponseObject {
  return {
    id: responseId,
    object: "response",
    created_at: createdAt,
    status,
    error,
    incomplete_details: incompleteDetails,
    instructions: request.instructions ?? null,
    max_output_tokens: request.max_output_tokens ?? null,
    model: request.model,
    output,
    parallel_tool_calls: request.parallel_tool_calls ?? true,
    previous_response_id: request.previous_response_id ?? null,
    reasoning: request.reasoning ?? null,
    store: request.store ?? true,
    temperature: request.temperature ?? null,
    text: request.text || { format: { type: "text" } },
    tool_choice: request.tool_choice ?? "auto",
    tools: request.tools || [],
    top_p: request.top_p ?? null,
    truncation: request.truncation || "disabled",
    usage,
    user: request.user ?? request.user_id ?? null,
    metadata: request.metadata ?? null,
  };
}

function responseOutputToChatMessages(output: ResponseObject["output"]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let assistant: ChatMessage | null = null;
  for (const item of output as any[]) {
    if (item.type === "reasoning" && item.encrypted_content) {
      assistant = assistant || { role: "assistant", content: "" };
      assistant.reasoning_content = item.encrypted_content;
    } else if (item.type === "message") {
      assistant = assistant || { role: "assistant", content: "" };
      assistant.content = (item.content || []).map((part: any) => part.type === "output_text" ? part.text || "" : "").join("");
    } else if (item.type === "function_call") {
      assistant = assistant || { role: "assistant", content: null, tool_calls: [] };
      assistant.tool_calls = assistant.tool_calls || [];
      assistant.tool_calls.push({ id: item.call_id || "", type: "function", function: { name: item.name || "", arguments: item.arguments || "" } });
    }
  }
  if (assistant) messages.push(assistant);
  return messages;
}

function safeJsonParse(value: string): any | null {
  try { return JSON.parse(value); } catch { return null; }
}

export function extractUsageStats(usage: Usage | null | undefined) {
  const inputDetails = usage?.input_tokens_details || {};
  const outputDetails = usage?.output_tokens_details || {};
  const promptCacheHitTokens = Number(inputDetails.cached_tokens ?? inputDetails.prompt_cache_hit_tokens ?? 0);
  const promptCacheMissTokens = Number(inputDetails.cache_miss_tokens ?? inputDetails.prompt_cache_miss_tokens ?? 0);
  const totalCache = promptCacheHitTokens + promptCacheMissTokens;
  return {
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
    reasoningTokens: Number(outputDetails.reasoning_tokens || 0),
    promptCacheHitTokens,
    promptCacheMissTokens,
    providerPromptCacheHitRate: totalCache ? promptCacheHitTokens / totalCache : null,
  };
}
