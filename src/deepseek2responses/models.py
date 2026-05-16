from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field


# ── Request input items (what Codex sends in `input`) ──

class InputText(BaseModel):
    type: Literal["input_text"] = "input_text"
    text: str


class InputImage(BaseModel):
    type: Literal["input_image"] = "input_image"
    image_url: str = ""
    detail: Optional[Literal["auto", "low", "high"]] = None


class InputFile(BaseModel):
    type: Literal["input_file"] = "input_file"
    file_id: Optional[str] = None
    filename: Optional[str] = None
    file_data: Optional[str] = None


class OutputText(BaseModel):
    type: Literal["output_text"] = "output_text"
    text: str
    annotations: List[Any] = []


class FunctionCall(BaseModel):
    type: Literal["function_call"] = "function_call"
    id: Optional[str] = None
    call_id: str
    name: str
    arguments: str
    status: Optional[Literal["in_progress", "completed", "incomplete"]] = None


class FunctionCallOutput(BaseModel):
    type: Literal["function_call_output"] = "function_call_output"
    call_id: str
    output: Union[str, List[Union[InputText, OutputText, InputImage]]] = ""


class ReasoningSummaryPart(BaseModel):
    type: Literal["summary_text"] = "summary_text"
    text: str


class ReasoningItem(BaseModel):
    type: Literal["reasoning"] = "reasoning"
    id: Optional[str] = None
    summary: List[ReasoningSummaryPart] = []
    encrypted_content: Optional[str] = None
    status: Optional[Literal["in_progress", "completed", "incomplete"]] = None


InputItem = Union[InputText, OutputText, InputImage, InputFile, FunctionCall, FunctionCallOutput, ReasoningItem]


class InputMessage(BaseModel):
    """Flexible input message — catches both full input-item shapes and bare {role, content}."""
    type: Optional[Literal["message"]] = "message"
    role: Literal["user", "assistant", "system", "developer", "tool"] = "user"
    content: Union[str, List[Union[InputText, OutputText, InputImage, InputFile, FunctionCall, FunctionCallOutput]]] = ""
    id: Optional[str] = None
    status: Optional[Literal["in_progress", "completed", "incomplete"]] = None


# ── Tool definitions ──

class ToolFunction(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    strict: Optional[bool] = None


class FunctionTool(BaseModel):
    type: Literal["function"] = "function"
    name: Optional[str] = None
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    strict: Optional[bool] = None


class LocalShellTool(BaseModel):
    type: Literal["local_shell"] = "local_shell"


class WebSearchTool(BaseModel):
    type: Literal["web_search", "web_search_preview"] = "web_search"


class CustomTool(BaseModel):
    type: Literal["custom"] = "custom"
    name: Optional[str] = None
    description: Optional[str] = None
    format: Optional[Dict[str, Any]] = None


class NamespaceTool(BaseModel):
    type: Literal["namespace"] = "namespace"
    name: Optional[str] = None
    tools: Optional[List[Any]] = None


ToolDef = Union[FunctionTool, LocalShellTool, WebSearchTool, CustomTool, NamespaceTool, Dict[str, Any]]


class ToolChoiceFunction(BaseModel):
    type: Literal["function"] = "function"
    name: str
    function: Optional[Dict[str, str]] = None


class Reasoning(BaseModel):
    effort: Optional[Literal["minimal", "low", "medium", "high"]] = "medium"
    summary: Optional[Literal["auto", "concise", "detailed"]] = None


# ── Main request ──

class ResponseRequest(BaseModel):
    model: str
    input: Union[str, List[Union[InputMessage, InputItem]]]
    instructions: Optional[str] = None
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    max_output_tokens: Optional[int] = None
    stream: Optional[bool] = False
    tools: Optional[List[ToolDef]] = None
    tool_choice: Optional[Union[str, ToolChoiceFunction, Dict[str, Any]]] = None
    parallel_tool_calls: Optional[bool] = None
    previous_response_id: Optional[str] = None
    reasoning: Optional[Reasoning] = None
    metadata: Optional[Dict[str, Any]] = None
    text: Optional[Dict[str, Any]] = None
    store: Optional[bool] = None
    truncation: Optional[str] = None


# ── Response output items ──

class OutputThinking(BaseModel):
    type: Literal["thinking"] = "thinking"
    thinking: str = ""
    signature: Optional[str] = None


class OutputMessage(BaseModel):
    type: Literal["message"] = "message"
    id: Optional[str] = None
    status: Literal["in_progress", "completed", "incomplete"] = "completed"
    role: Literal["assistant"] = "assistant"
    content: List[Union[OutputText, OutputThinking, FunctionCall]]


class Usage(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int = 0
    input_tokens_details: Optional[Dict[str, Any]] = None
    output_tokens_details: Optional[Dict[str, Any]] = None


class Response(BaseModel):
    id: str
    object: Literal["response"] = "response"
    created_at: int = Field(default_factory=lambda: int(__import__("time").time()))
    status: Literal["in_progress", "completed", "incomplete", "failed"] = "completed"
    error: Optional[Dict[str, Any]] = None
    model: str
    output: List[Union[OutputMessage, FunctionCall, ReasoningItem]]
    usage: Optional[Usage] = None
    metadata: Optional[Dict[str, Any]] = None
    incomplete_details: Optional[Dict[str, Any]] = None


# ── Error ──

class ErrorResponse(BaseModel):
    error: Dict[str, Any]
