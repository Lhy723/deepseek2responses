from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field


# Request models

class InputText(BaseModel):
    type: Literal["input_text"] = "input_text"
    text: str


class InputImage(BaseModel):
    type: Literal["input_image"] = "input_image"
    image_url: Optional[str] = None
    data: Optional[str] = None


InputContent = Union[InputText, InputImage]


class InputMessage(BaseModel):
    role: Literal["user", "assistant", "system", "developer"]
    content: Union[str, List[InputContent]]


class ToolFunction(BaseModel):
    name: str
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None


class Tool(BaseModel):
    type: Literal["function"] = "function"
    function: ToolFunction


class ResponseRequest(BaseModel):
    model: str
    input: Union[str, List[InputMessage]]
    instructions: Optional[str] = None
    temperature: Optional[float] = Field(default=1.0, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)
    max_output_tokens: Optional[int] = None
    stream: Optional[bool] = False
    tools: Optional[List[Tool]] = None
    tool_choice: Optional[Union[str, Dict[str, Any]]] = "auto"
    previous_response_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


# Response models

class OutputText(BaseModel):
    type: Literal["output_text"] = "output_text"
    text: str
    annotations: List[Any] = []


class FunctionCall(BaseModel):
    type: Literal["function_call"] = "function_call"
    id: str
    call_id: str
    name: str
    arguments: str


class OutputMessage(BaseModel):
    type: Literal["message"] = "message"
    id: Optional[str] = None
    status: Literal["in_progress", "completed", "incomplete"] = "completed"
    role: Literal["assistant"] = "assistant"
    content: List[Union[OutputText, FunctionCall]]


class Usage(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int = 0


class Response(BaseModel):
    id: str
    object: Literal["response"] = "response"
    created_at: int = Field(default_factory=lambda: int(__import__("time").time()))
    status: Literal["in_progress", "completed", "incomplete"] = "completed"
    error: Optional[Dict[str, Any]] = None
    model: str
    output: List[Union[OutputMessage, FunctionCall]]
    usage: Optional[Usage] = None
    metadata: Optional[Dict[str, Any]] = None


# Error model

class ErrorResponse(BaseModel):
    error: Dict[str, Any]
