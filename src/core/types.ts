export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, any>;

export interface Config {
  deepseek_api_key: string;
  deepseek_base_url: string;
  model_mapping: Record<string, string>;
  host: string;
  port: number;
  timeout: number;
  stats_file: string;
  log_file: string;
  max_output_tokens_cap: number;
  unsupported_tools: "error" | "drop";
  tool_name_sanitize: boolean;
}

export interface InputText {
  type: "input_text";
  text: string;
}

export interface InputImage {
  type: "input_image";
  image_url?: string;
  file_id?: string;
  detail?: "auto" | "low" | "high";
}

export interface InputFile {
  type: "input_file";
  file_id?: string;
  filename?: string;
  file_data?: string;
}

export interface OutputText {
  type: "output_text";
  text: string;
  annotations?: any[];
}

export interface Refusal {
  type: "refusal";
  refusal: string;
}

export interface FunctionCall {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: "in_progress" | "completed" | "incomplete";
}

export interface FunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output?: string | Array<InputText | OutputText | InputImage>;
}

export interface ReasoningSummaryPart {
  type: "summary_text";
  text: string;
}

export interface ReasoningItem {
  type: "reasoning";
  id?: string;
  summary?: ReasoningSummaryPart[];
  encrypted_content?: string | null;
  status?: "in_progress" | "completed" | "incomplete";
}

export type InputContentPart = InputText | OutputText | InputImage | InputFile | FunctionCall | FunctionCallOutput | Refusal;
export type InputItem = InputMessage | InputText | OutputText | InputImage | InputFile | FunctionCall | FunctionCallOutput | ReasoningItem;

export interface InputMessage {
  type?: "message";
  role?: "user" | "assistant" | "system" | "developer" | "tool";
  content?: string | InputContentPart[];
  id?: string;
  status?: "in_progress" | "completed" | "incomplete";
  tool_call_id?: string;
  call_id?: string;
}

export interface FunctionTool {
  type: "function";
  name?: string;
  description?: string;
  parameters?: JsonObject;
  strict?: boolean;
}

export interface LocalShellTool {
  type: "local_shell";
}

export interface WebSearchTool {
  type: "web_search" | "web_search_preview" | "web_search_preview_2025_03_11";
  [key: string]: any;
}

export interface CustomTool {
  type: "custom";
  name?: string;
  description?: string;
  format?: JsonObject;
}

export interface NamespaceTool {
  type: "namespace";
  name?: string;
  tools?: ToolDef[];
}

export type ToolDef = FunctionTool | LocalShellTool | WebSearchTool | CustomTool | NamespaceTool | JsonObject;

export interface ToolChoiceFunction {
  type: "function";
  name?: string;
  function?: { name?: string };
}

export interface Reasoning {
  effort?: "minimal" | "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
  generate_summary?: "auto" | "concise" | "detailed";
}

export interface ResponseRequest {
  model: string;
  input: string | InputItem[];
  instructions?: string | null;
  temperature?: number | null;
  top_p?: number | null;
  max_output_tokens?: number | null;
  stream?: boolean | null;
  tools?: ToolDef[] | null;
  tool_choice?: string | ToolChoiceFunction | JsonObject | null;
  parallel_tool_calls?: boolean | null;
  previous_response_id?: string | null;
  reasoning?: Reasoning | null;
  metadata?: JsonObject | null;
  text?: JsonObject | null;
  store?: boolean | null;
  truncation?: string | null;
  stop?: string | string[] | null;
  user?: string | null;
  user_id?: string | null;
  include?: string[] | null;
  service_tier?: string | null;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: JsonObject | null;
  output_tokens_details?: JsonObject | null;
}

export interface OutputMessage {
  type: "message";
  id?: string;
  status: "in_progress" | "completed" | "incomplete";
  role: "assistant";
  content: Array<OutputText | Refusal>;
}

export type ResponseOutputItem = OutputMessage | FunctionCall | ReasoningItem | JsonObject;

export interface ResponseObject {
  id: string;
  object: "response";
  created_at: number;
  status: "in_progress" | "completed" | "incomplete" | "failed";
  error: JsonObject | null;
  incomplete_details: JsonObject | null;
  instructions?: string | null;
  max_output_tokens?: number | null;
  model: string;
  output: ResponseOutputItem[];
  parallel_tool_calls?: boolean;
  previous_response_id?: string | null;
  reasoning?: Reasoning | null;
  store?: boolean;
  temperature?: number | null;
  text?: JsonObject;
  tool_choice?: string | ToolChoiceFunction | JsonObject;
  tools?: ToolDef[];
  top_p?: number | null;
  truncation?: string;
  usage?: Usage | null;
  user?: string | null;
  metadata?: JsonObject | null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: any;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
  reasoning_content?: string;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface DeepSeekPayload {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  stream_options?: { include_usage: boolean };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  thinking?: { type: "enabled" | "disabled"; reasoning_effort?: "high" | "max" };
  tools?: JsonObject[];
  tool_choice?: any;
  response_format?: { type: "text" | "json_object" };
  stop?: string | string[];
  user_id?: string;
}

export interface ConvertedRequest {
  payload: DeepSeekPayload;
  cacheHit: boolean | null;
  unsupportedWarnings: string[];
  diagnostics: RequestDiagnostics;
  conversationPrefix: ChatMessage[];
  currentMessages: ChatMessage[];
}

export interface RequestDiagnostics {
  requestId?: string;
  model: string;
  upstreamModel: string;
  stream: boolean;
  maxOutputTokens?: number | null;
  upstreamMaxTokens?: number | null;
  inputTypes: Record<string, number>;
  toolTypes: Record<string, number>;
  toolCount: number;
  toolChoice?: string;
  textFormat?: string;
  include?: string[] | null;
  previousResponseId?: string | null;
  payloadBytes: number;
  warnings: string[];
  upstreamStatus?: number;
  upstreamError?: string | null;
}

export interface RequestStatsRecord {
  id: string;
  responseId?: string | null;
  timestamp: string;
  model: string;
  upstreamModel?: string;
  stream: boolean;
  status: "completed" | "incomplete" | "failed";
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  providerPromptCacheHitRate: number | null;
  responseCacheHit: boolean | null;
  errorCode: string | null;
  diagnostics?: RequestDiagnostics;
}
