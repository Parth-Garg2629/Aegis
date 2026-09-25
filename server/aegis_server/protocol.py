from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field

MessageType = Literal[
    "session_init",
    "context_update",
    "session_resume",
    "session_end",
    "action_denied",
    "action_result",
    "ping",
    "session_created",
    "action",
    "session_error",
    "session_resumed",
    "pong",
]


class BaseEnvelope(BaseModel):
    # type: str here (not strict MessageType Literal) so that unknown message
    # types pass envelope validation and are silently discarded by the gateway
    # per API_SPEC §5.2. Each typed message model still enforces its own Literal.
    type: str
    session_id: Optional[str] = None
    timestamp: str
    protocol_version: Literal["1.0"] = "1.0"
    payload: Dict[str, Any] = Field(default_factory=dict)


class ClientMetadata(BaseModel):
    extension_version: str
    browser: Literal["chrome", "edge"]
    browser_version: str
    max_steps: int = Field(ge=1, le=100, default=30)


class SessionInitPayload(BaseModel):
    goal: str = Field(min_length=1, max_length=1000)
    client_metadata: ClientMetadata


class SessionInitMessage(BaseEnvelope):
    type: Literal["session_init"] = "session_init"
    session_id: Optional[str] = None
    payload: SessionInitPayload


class SessionCreatedPayload(BaseModel):
    server_max_steps: int = Field(ge=1, le=100, default=30)


class SessionCreatedMessage(BaseEnvelope):
    type: Literal["session_created"] = "session_created"
    session_id: str
    payload: SessionCreatedPayload


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class SanitizedElement(BaseModel):
    id: str
    tagName: str
    type: Optional[str] = None
    role: Optional[str] = None
    label: Optional[str] = None
    text: Optional[str] = None
    value: Optional[str] = None
    boundingBox: BoundingBox
    isVisible: bool
    isDisabled: bool
    isReadOnly: bool
    isInteractive: bool
    parentFormId: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None


class SanitizedForm(BaseModel):
    id: str
    action: Optional[str] = None
    method: Optional[Literal["GET", "POST", "get", "post"]] = None
    elementIds: List[str] = Field(default_factory=list)


class SanitizedSchema(BaseModel):
    url: str
    title: str
    elements: List[SanitizedElement] = Field(default_factory=list)
    forms: Optional[List[SanitizedForm]] = None


class PreviousActionResult(BaseModel):
    action_type: str
    target_element_id: Optional[str] = None
    success: bool
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    local_input_status: Optional[Literal["LOCAL_INPUT_PROVIDED", "LOCAL_INPUT_CANCELLED"]] = None


class ContextUpdatePayload(BaseModel):
    step_number: int = Field(ge=1)
    agent_state: Literal["running", "paused", "confirming"]
    sanitized_screenshot: str
    screenshot_format: Literal["webp", "jpeg"]
    sanitized_schema: SanitizedSchema
    previous_action_result: Optional[PreviousActionResult] = None


class ContextUpdateMessage(BaseEnvelope):
    type: Literal["context_update"] = "context_update"
    session_id: str
    payload: ContextUpdatePayload


ActionType = Literal["click", "type", "scroll", "select", "hover", "wait", "done", "fail"]


class ActionObject(BaseModel):
    action_type: ActionType
    target: Optional[str] = None
    value: Optional[str] = Field(default=None, max_length=500)
    reasoning: Optional[str] = Field(default=None, max_length=1000)


class RiskAssessment(BaseModel):
    level: Literal["safe", "high_risk", "blocked"]
    category: Optional[str] = None
    reason: Optional[str] = None


class ActionPayload(BaseModel):
    step_number: int = Field(ge=1)
    action: ActionObject
    risk_assessment: Optional[RiskAssessment] = None


class ActionMessage(BaseEnvelope):
    type: Literal["action"] = "action"
    session_id: str
    payload: ActionPayload


class ActionResultPayload(BaseModel):
    step_number: int = Field(ge=1)
    action_type: str
    success: bool
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    local_input_status: Optional[Literal["LOCAL_INPUT_PROVIDED", "LOCAL_INPUT_CANCELLED"]] = None


class ActionResultMessage(BaseEnvelope):
    type: Literal["action_result"] = "action_result"
    session_id: str
    payload: ActionResultPayload


class ActionDeniedPayload(BaseModel):
    step_number: int = Field(ge=1)
    denied_action_type: str
    risk_category: str
    denial_source: Literal["user", "risk_engine_blocked"]


class ActionDeniedMessage(BaseEnvelope):
    type: Literal["action_denied"] = "action_denied"
    session_id: str
    payload: ActionDeniedPayload


class SessionResumePayload(BaseModel):
    last_known_step: int = Field(ge=0)


class SessionResumeMessage(BaseEnvelope):
    type: Literal["session_resume"] = "session_resume"
    session_id: str
    payload: SessionResumePayload


class SessionResumedPayload(BaseModel):
    resumed: bool
    server_step: Optional[int] = None
    reason: Optional[str] = None


class SessionResumedMessage(BaseEnvelope):
    type: Literal["session_resumed"] = "session_resumed"
    session_id: str
    payload: SessionResumedPayload


SessionEndReason = Literal[
    "goal_achieved",
    "agent_failed",
    "user_cancelled",
    "max_steps_reached",
    "stuck_detected",
    "repeated_failures",
    "connection_error",
]


class SessionEndPayload(BaseModel):
    reason: SessionEndReason
    final_step: int = Field(ge=0)


class SessionEndMessage(BaseEnvelope):
    type: Literal["session_end"] = "session_end"
    session_id: str
    payload: SessionEndPayload


class SessionErrorPayload(BaseModel):
    error_code: str
    error_message: str
    recoverable: bool
    suggested_action: Optional[Literal["retry", "reconnect", "terminate"]] = None


class SessionErrorMessage(BaseEnvelope):
    type: Literal["session_error"] = "session_error"
    session_id: str
    payload: SessionErrorPayload


class PingMessage(BaseEnvelope):
    type: Literal["ping"] = "ping"
    session_id: str
    payload: Dict[str, Any] = Field(default_factory=dict)


class PongMessage(BaseEnvelope):
    type: Literal["pong"] = "pong"
    session_id: str
    payload: Dict[str, Any] = Field(default_factory=dict)


AegisClientMessage = Union[
    SessionInitMessage,
    ContextUpdateMessage,
    SessionResumeMessage,
    SessionEndMessage,
    ActionDeniedMessage,
    ActionResultMessage,
    PingMessage,
]

AegisServerMessage = Union[
    SessionCreatedMessage,
    ActionMessage,
    SessionErrorMessage,
    SessionResumedMessage,
    PongMessage,
]
