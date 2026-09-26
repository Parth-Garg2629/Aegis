"""
view.py — Server View / Operational Visibility (E8)
====================================================
Read-only HTTP endpoints exposing privacy-safe operational state.
Inspector D1 tier from DEMO_FLOW §8.

Privacy invariants:
- No raw screenshots ever returned
- No raw goal text (boolean indicator only)
- No raw PII, credentials, or DOM
- Action history values redacted if sensitive
"""

from typing import List, Optional, Any, Dict
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from aegis_server.session import session_manager


router = APIRouter(prefix="/view", tags=["view"])


# ── Response models ──────────────────────────────────────────────────────────

class ActionHistoryItem(BaseModel):
    step_number: int
    action_type: str
    target: Optional[str] = None
    value_safe: Optional[str] = None   # Never the raw sensitive value
    execution_success: Optional[bool] = None

class SessionSummary(BaseModel):
    session_id: str
    state: str
    current_step: int
    max_steps: int
    created_at: float
    goal_present: bool                 # Privacy: boolean only, never raw goal
    uptime_seconds: float

class SessionDetail(BaseModel):
    session_id: str
    state: str
    current_step: int
    max_steps: int
    created_at: float
    goal_present: bool
    uptime_seconds: float
    action_history_last5: List[ActionHistoryItem]
    latest_action_type: Optional[str] = None
    latest_risk_level: Optional[str] = None

class LatestContextMeta(BaseModel):
    session_id: str
    url: Optional[str] = None
    title: Optional[str] = None
    element_count: int
    form_count: int
    screenshot_bytes: int
    screenshot_format: Optional[str] = None
    redacted_field_count: int          # Count only, no raw values
    canary_badge: str = "E8_VIEW_ACTIVE"   # Phase F wire-tap integration point

class SessionListResponse(BaseModel):
    active_sessions: List[SessionSummary]
    total: int
    server_time: str
    canary_badge: str = "E8_VIEW_ACTIVE"   # Phase F wire-tap integration point


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _uptime(created_at: float) -> float:
    return round(datetime.now(timezone.utc).timestamp() - created_at, 1)

def _safe_value(value: Optional[str]) -> Optional[str]:
    """Return a privacy-safe version of an action value."""
    if value is None:
        return None
    if value in ("[NEEDS_LOCAL_INPUT]", "[LOCAL_INPUT_PROVIDED]", "[LOCAL_INPUT_CANCELLED]"):
        return "[LOCAL_INPUT_PROVIDED]"
    # Truncate long values and never expose raw sensitive strings
    return value[:80] if value else None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions():
    """List all active sessions with privacy-safe metadata."""
    sessions = session_manager.list_active_sessions()
    summaries = []
    for s in sessions:
        summaries.append(SessionSummary(
            session_id=s.session_id,
            state=s.state.value,
            current_step=s.current_step,
            max_steps=s.max_steps,
            created_at=s.created_at,
            goal_present=bool(s.goal),
            uptime_seconds=_uptime(s.created_at),
        ))
    return SessionListResponse(
        active_sessions=summaries,
        total=len(summaries),
        server_time=_now_iso(),
    )


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session_detail(session_id: str):
    """Get detail for a specific session including last 5 action history items."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    history = list(session.action_history)
    last5 = history[-5:] if history else []
    history_items = []
    for item in last5:
        history_items.append(ActionHistoryItem(
            step_number=item.step_number,
            action_type=item.action_type,
            target=item.target,
            value_safe=_safe_value(item.value),
            execution_success=item.execution_success,
        ))

    latest_action_type = last5[-1].action_type if last5 else None
    latest_risk_level = None  # Risk level from latest context not stored on session, show None

    return SessionDetail(
        session_id=session.session_id,
        state=session.state.value,
        current_step=session.current_step,
        max_steps=session.max_steps,
        created_at=session.created_at,
        goal_present=bool(session.goal),
        uptime_seconds=_uptime(session.created_at),
        action_history_last5=history_items,
        latest_action_type=latest_action_type,
        latest_risk_level=latest_risk_level,
    )


@router.get("/sessions/{session_id}/latest-context", response_model=LatestContextMeta)
async def get_latest_context(session_id: str):
    """Show metadata about the latest sanitized context. Never returns image data."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    ctx = session.latest_context
    if not ctx:
        raise HTTPException(status_code=404, detail="No context available yet")

    schema = ctx.sanitized_schema
    
    # Count redacted fields (privacy-minimized count, no raw values)
    redacted_count = sum(
        1 for el in schema.elements
        if el.value and "[REDACTED_" in str(el.value)
    )
    
    # Screenshot bytes — size only, never the actual image
    screenshot_bytes = len(ctx.sanitized_screenshot) if ctx.sanitized_screenshot else 0

    return LatestContextMeta(
        session_id=session_id,
        url=schema.url,
        title=schema.title,
        element_count=len(schema.elements),
        form_count=len(schema.forms) if schema.forms else 0,
        screenshot_bytes=screenshot_bytes,
        screenshot_format=ctx.screenshot_format,
        redacted_field_count=redacted_count,
    )
