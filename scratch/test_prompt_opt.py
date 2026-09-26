import sys, json, os, httpx, time
from aegis_server.protocol import ContextUpdatePayload, SanitizedSchema, SanitizedElement, BoundingBox

elements = [
    SanitizedElement(id='name', tagName='input', type='text', label='Full Name', value='Ramesh Kumar', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=10, width=200, height=30)),
    SanitizedElement(id='aadhaar', tagName='input', type='text', label='Aadhaar Number', value='[REDACTED_AADHAAR]', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=50, width=200, height=30)),
    SanitizedElement(id='pan', tagName='input', type='text', label='PAN', value='[REDACTED_PAN]', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=90, width=200, height=30)),
    SanitizedElement(id='mobile', tagName='input', type='tel', label='Mobile Number', value='[REDACTED_PHONE]', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=130, width=200, height=30)),
    SanitizedElement(id='email', tagName='input', type='email', label='Email', value='[REDACTED_EMAIL]', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=170, width=200, height=30)),
    SanitizedElement(id='bank_account', tagName='input', type='text', label='Bank Account No.', value='[REDACTED_BANK_ACCOUNT]', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=210, width=200, height=30)),
    SanitizedElement(id='category', tagName='select', label='Category', value='', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=250, width=200, height=30), attributes={'options': ['General', 'OBC', 'SC', 'ST']}),
    SanitizedElement(id='state', tagName='select', label='State', value='', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=290, width=200, height=30), attributes={'options': ['Rajasthan', 'Delhi']}),
    SanitizedElement(id='city', tagName='input', type='text', label='City', value='', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=330, width=200, height=30)),
    SanitizedElement(id='course', tagName='select', label='Course', value='', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=370, width=200, height=30), attributes={'options': ['B.Tech', 'B.Sc']}),
    SanitizedElement(id='declaration', tagName='input', type='checkbox', label='I accept the declaration', value='', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=410, width=20, height=20)),
    SanitizedElement(id='submit_btn', tagName='button', label='Submit Application', isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True, boundingBox=BoundingBox(x=10, y=450, width=150, height=35)),
]

def test_prompt(goal, include_image=True):
    elements_summary = []
    for e in elements:
        opts = f", options={e.attributes.get('options')}" if e.attributes and 'options' in e.attributes else ""
        val = f", value=\"{e.value}\"" if e.value else ""
        elements_summary.append(f"- id=\"{e.id}\" tag=\"{e.tagName}\" label=\"{e.label}\"{val}{opts}")
    
    compact_elements = "\n".join(elements_summary)
    
    sys_prompt = """You are an ultra-fast browser automation action planner.
Output ONLY a single JSON ActionObject:
{
  "action_type": "type" | "click" | "select" | "scroll" | "done" | "fail",
  "target": "<element id from schema or null>",
  "value": "<text to type, dropdown option, scroll direction, or null>",
  "reasoning": "<short reasoning under 10 words>"
}

ACTION EXECUTION RULES:
- "type": Use directly to type text into an input field (DO NOT click first). Requires: target, value.
- "select": Use directly to choose a dropdown option. Requires: target, value.
- "click": Use to click buttons or links or checkboxes. Requires: target.
- "scroll": Use value "up" or "down" when target is off-screen.
- "fail": Use when the requested target does not exist on page.

Respond with valid raw JSON only. No markdown, no prose."""

    user_msg = f"""USER GOAL: {goal}
CURRENT STEP: 1

PAGE ELEMENTS:
{compact_elements}

Respond with the single JSON action to execute:"""

    # 1x1 100-byte webp image as sample sanitized image
    sample_img = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA='
    
    payload = {
        'model': 'qwen3-vl:4b',
        'messages': [
            {'role': 'system', 'content': sys_prompt},
            {
                'role': 'user', 
                'content': user_msg,
                'images': [sample_img] if include_image else []
            }
        ],
        'format': 'json',
        'options': {'temperature': 0.0, 'num_predict': 768},
        'stream': False
    }

    t0 = time.time()
    with httpx.Client(timeout=30.0) as client:
        resp = client.post('http://127.0.0.1:11434/api/chat', json=payload)
        data = resp.json()
    t1 = time.time()
    
    content = data.get('message', {}).get('content', '').strip()
    thinking = data.get('message', {}).get('thinking', '').strip()
    done_reason = data.get('done_reason')
    eval_count = data.get('eval_count')
    
    print(f"Goal: {goal} (Image: {include_image})")
    print(f"Latency: {t1 - t0:.2f}s | Eval count: {eval_count} | Done: {done_reason}")
    print(f"Content: {repr(content)}")
    if thinking:
        print(f"Thinking length: {len(thinking)}")
    print("-" * 50)

if __name__ == '__main__':
    test_prompt("Enter Jaipur in the City field", True)
    test_prompt("Select OBC from Category dropdown", True)
    test_prompt("Click Submit Application button", True)
    test_prompt("Find Learn More button and click it", True)
