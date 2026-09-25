"""
risk_engine.py — Server-Side Risk Engine (E6)
===========================================
Deterministic risk classification for VLM actions.
"""

from typing import Optional, Tuple
from aegis_server.protocol import ActionObject, ContextUpdatePayload, RiskAssessment

class RiskEngine:
    def __init__(self):
        self.blocked_patterns = ["javascript:", "<script", "eval(", "onclick="]
        
        # High Risk Keywords
        self.hr_01 = {"pay", "buy", "purchase", "checkout", "transfer", "send money", "donate"}
        self.hr_02 = {"delete account", "deactivate account", "close account", "remove account"}
        self.hr_03 = {"delete", "remove", "destroy", "clear all", "factory reset"}
        self.hr_06 = {"login", "sign in", "authenticate", "password"}

    def _matches_keywords(self, text: str, keywords: set[str]) -> bool:
        if not text:
            return False
        text_lower = text.lower()
        for k in keywords:
            if k in text_lower:
                return True
        return False

    def evaluate(self, action: ActionObject, context: ContextUpdatePayload) -> RiskAssessment:
        try:
            # 1. Safe actions by default
            if action.action_type in {"wait", "done", "fail", "scroll"}:
                return RiskAssessment(level="safe")

            # 2. Check blocked patterns
            if action.action_type == "type" and action.value:
                val_lower = str(action.value).lower()
                for bp in self.blocked_patterns:
                    if bp in val_lower:
                        return RiskAssessment(level="blocked", reason="Script injection pattern detected")
            
            # 3. Check target element
            target_el = None
            if action.target:
                for el in context.sanitized_schema.elements:
                    if el.id == action.target:
                        target_el = el
                        break
            
            if not target_el:
                # If target doesn't exist, it's safe from a risk perspective (it will fail validation anyway)
                if action.action_type == "type" and action.value == "[NEEDS_LOCAL_INPUT]":
                    return RiskAssessment(level="safe")
                return RiskAssessment(level="safe")

            # 4. Check external link (Blocked)
            if action.action_type == "click" and target_el.tagName.lower() == "a":
                attrs = target_el.attributes or {}
                href = attrs.get("href", "")
                if str(href).startswith("http"):
                    ctx_url = context.sanitized_schema.url or ""
                    def get_domain(u):
                        parts = u.split("/")
                        if len(parts) >= 3:
                            return parts[2]
                        return u
                    
                    if get_domain(str(href)) != get_domain(ctx_url):
                        return RiskAssessment(level="blocked", reason="External navigation")

            # 5. Check High Risk
            attrs = target_el.attributes or {}
            search_text = f"{target_el.label or ''} {target_el.text or ''} {target_el.value or ''} {attrs.get('aria-label', '')}"

            if action.action_type in {"click", "select"}:
                # HR-07 Download
                if attrs.get("download") is not None:
                    return RiskAssessment(level="high_risk", category="HR-07", reason="Download attribute present")
                
                # HR-01 Payment
                if self._matches_keywords(search_text, self.hr_01):
                    return RiskAssessment(level="high_risk", category="HR-01", reason="Payment action")
                
                # HR-02 Account Deletion
                if self._matches_keywords(search_text, self.hr_02):
                    return RiskAssessment(level="high_risk", category="HR-02", reason="Account deletion")
                
                # HR-06 Password/Credential
                if self._matches_keywords(search_text, self.hr_06):
                    return RiskAssessment(level="high_risk", category="HR-06", reason="Credential action")
                
                # HR-03 Irreversible
                if target_el.type == "submit" and self._matches_keywords(search_text, self.hr_03):
                    return RiskAssessment(level="high_risk", category="HR-03", reason="Irreversible action")

                # Check form submissions for HR-04 / HR-05
                if target_el.type == "submit":
                    # Count redacted fields in the schema
                    redacted_count = 0
                    has_sensitive = False
                    for el in context.sanitized_schema.elements:
                        val = str(el.value or "")
                        if "[REDACTED_" in val:
                            redacted_count += 1
                            if "[REDACTED_AADHAAR]" in val or "[REDACTED_PAN]" in val or "[REDACTED_CREDIT_CARD]" in val:
                                has_sensitive = True
                    
                    if has_sensitive:
                        return RiskAssessment(level="high_risk", category="HR-04", reason="Financial form submission")
                    if redacted_count >= 3:
                        return RiskAssessment(level="high_risk", category="HR-05", reason="Sensitive form submission")

            if action.action_type == "type":
                if action.value == "[NEEDS_LOCAL_INPUT]":
                    return RiskAssessment(level="safe")
                
                # Double check typing into sensitive fields
                if target_el.type == "password" or attrs.get("autocomplete") == "cc-number":
                    return RiskAssessment(level="blocked", category="HR-06", reason="Cannot type raw values into sensitive fields")

            return RiskAssessment(level="safe")

        except Exception as e:
            print("RISK ENGINE ERROR:", e)
            import traceback
            traceback.print_exc()
            # Fail closed
            return RiskAssessment(level="blocked", reason=f"Risk engine error: {str(e)}")

risk_engine = RiskEngine()
