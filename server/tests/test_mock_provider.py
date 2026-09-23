from aegis_server.protocol import (
    BoundingBox,
    ContextUpdatePayload,
    SanitizedElement,
    SanitizedSchema,
)
from aegis_server.providers.mock import MockVLMProvider


def create_test_context(step: int) -> ContextUpdatePayload:
    elements = [
        SanitizedElement(
            id="el-search-input",
            tagName="input",
            type="text",
            label="Search Query",
            boundingBox=BoundingBox(x=10, y=20, width=200, height=30),
            isVisible=True,
            isDisabled=False,
            isReadOnly=False,
            isInteractive=True,
        ),
        SanitizedElement(
            id="el-submit-button",
            tagName="button",
            type="submit",
            text="Search Scholarships",
            boundingBox=BoundingBox(x=10, y=60, width=120, height=30),
            isVisible=True,
            isDisabled=False,
            isReadOnly=False,
            isInteractive=True,
        ),
    ]

    schema = SanitizedSchema(
        url="http://localhost:8000/fixtures/fp_01.html",
        title="FP-01 Fixture",
        elements=elements,
    )

    return ContextUpdatePayload(
        step_number=step,
        agent_state="running",
        sanitized_screenshot="data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=",
        screenshot_format="webp",
        sanitized_schema=schema,
        previous_action_result=None,
    )


def test_mock_provider_deterministic_cycles():
    provider = MockVLMProvider()

    ctx1 = create_test_context(1)
    act1 = provider.generate_action(ctx1, goal="Find STEM scholarship")
    assert act1.action_type == "type"
    assert act1.target == "el-search-input"
    assert act1.value is not None

    ctx2 = create_test_context(2)
    act2 = provider.generate_action(ctx2, goal="Find STEM scholarship")
    assert act2.action_type == "click"
    assert act2.target == "el-submit-button"

    ctx3 = create_test_context(3)
    act3 = provider.generate_action(ctx3, goal="Find STEM scholarship")
    assert act3.action_type == "done"
