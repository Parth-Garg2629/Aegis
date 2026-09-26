"""
orchestrator.py — Agent Orchestrator Engine (E4)
================================================
Engine loop managing VLM calls, session state transitions, 
and generating actions.
"""

from typing import Optional, Tuple
from datetime import datetime, timezone
from aegis_server.protocol import ActionObject, ContextUpdatePayload, RiskAssessment
from aegis_server.providers import VLMProvider, get_configured_provider
from aegis_server.session import Session, SessionState
from aegis_server.slog import slog
from aegis_server.audit_db import audit_db


class AgentOrchestrator:
    def __init__(self, provider: Optional[VLMProvider] = None):
        if provider is None:
            self.provider = get_configured_provider()
        else:
            self.provider = provider

    def decide_next_action(self, session: Session, context: ContextUpdatePayload) -> Tuple[ActionObject, Optional[RiskAssessment]]:
        slog.info(
            module="ORCHESTRATOR",
            event="PROCESSING_CONTEXT_UPDATE",
            session_id=session.session_id,
            step_number=context.step_number,
        )

        session.set_inferring()

        try:
            # 1. Validation (Verify context has sanitized schema and screenshot unless step 1)
            # Handled by E5, but basic checks can go here if needed.

            # 2. Call VLM
            action = self.provider.generate_action(
                context, 
                goal=session.goal,
                action_history=list(session.action_history)
            )

            # 3. Server-side validation
            from aegis_server.action_validator import action_validator
            val_res = action_validator.validate_action(action, context)
            if not val_res.valid:
                slog.warn(
                    module="ORCHESTRATOR",
                    event="ACTION_VALIDATION_FAILED",
                    session_id=session.session_id,
                    step_number=context.step_number,
                    error_code=val_res.error_code,
                    error_message=val_res.error_message
                )
                return ActionObject(action_type="fail", reasoning=f"Action validation failed: {val_res.error_message}"), None

            # 4. Server-side risk evaluation
            from aegis_server.risk_engine import risk_engine
            risk_assessment = risk_engine.evaluate(action, context)
            
            # 5. Fail closed if blocked
            if risk_assessment.level == "blocked":
                slog.warn(
                    module="ORCHESTRATOR",
                    event="ACTION_BLOCKED",
                    session_id=session.session_id,
                    step_number=context.step_number,
                    reason=risk_assessment.reason
                )
                return ActionObject(action_type="fail", reasoning=f"Action blocked by risk engine: {risk_assessment.reason}"), risk_assessment

            slog.info(
                module="ORCHESTRATOR",
                event="ACTION_DECIDED",
                session_id=session.session_id,
                step_number=context.step_number,
                action_type=action.action_type,
                risk_level=risk_assessment.level
            )

            try:
                _ts = datetime.now(timezone.utc).isoformat()
                # Find target role
                sanitized_target_role = None
                action_value_safe = action.value
                value_classification = "NON_SENSITIVE"
                if action.value == "[NEEDS_LOCAL_INPUT]":
                    value_classification = "LOCAL_INPUT_PROVIDED"
                    action_value_safe = "[LOCAL_INPUT_PROVIDED]"
                    
                if action.target:
                    for el in context.sanitized_schema.elements:
                        if el.id == action.target:
                            sanitized_target_role = el.tagName
                            break
                
                audit_db.record_action(
                    session_id=session.session_id,
                    step_number=context.step_number,
                    action_type=action.action_type,
                    target_element_id=action.target,
                    sanitized_target_role=sanitized_target_role,
                    value_classification=value_classification,
                    action_value_safe=action_value_safe,
                    vlm_reasoning=action.reasoning,
                    risk_category=risk_assessment.category or "SAFE",
                    confirmation_required=(risk_assessment.level == "high_risk"),
                    confirmation_outcome="NOT_REQUIRED" if risk_assessment.level == "safe" else None,
                    execution_status="SUCCESS",
                    error_code=None,
                    timestamp=_ts
                )
                
                audit_db.record_metric(
                    session_id=session.session_id,
                    step_number=context.step_number,
                    timestamp=_ts,
                    dom_elements_total=len(context.sanitized_schema.elements),
                    screenshot_payload_bytes=len(context.sanitized_screenshot) if context.sanitized_screenshot else 0
                )
            except Exception as audit_err:
                slog.warn(module="ORCHESTRATOR", event="AUDIT_RECORD_FAILED", error=str(audit_err))

            return action, risk_assessment

        except Exception as e:
            slog.error(
                module="ORCHESTRATOR", 
                event="VLM_GENERATION_FAILED", 
                session_id=session.session_id, 
                error=str(e)
            )
            return ActionObject(action_type="fail", reasoning="VLM generation failed"), None
        
        finally:
            # Return to WAITING_CONTEXT state after inferring is done
            if session.state == SessionState.INFERRING:
                session.set_waiting_context()


orchestrator = AgentOrchestrator()
