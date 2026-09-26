"""
prompt_builder.py — E4 Structured Prompt Builder
================================================
Replaces static text files with a programmatic builder for system prompts.
"""

import os
from typing import Optional

class PromptBuilder:
    def __init__(self, template_path: Optional[str] = None):
        if template_path is None:
            template_path = os.path.join(os.path.dirname(__file__), "prompts", "system_v1.txt")
            
        with open(template_path, "r", encoding="utf-8") as f:
            self.base_prompt = f.read()

    def build_system_prompt(self, extension_version: str, browser: str) -> str:
        """
        Builds the system prompt, optionally substituting dynamic client metadata.
        """
        prompt = self.base_prompt
        # Future-proofing: If we want to inject BROWSER or VERSION into system prompt
        # prompt = prompt.replace("{{BROWSER}}", browser)
        return prompt

prompt_builder = PromptBuilder()
