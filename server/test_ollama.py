import requests
import json

payload = {
    "model": "qwen3-vl:4b",
    "messages": [
        {
            "role": "system",
            "content": "Output ONLY a single JSON ActionObject:\n{\n  \"action_type\": \"click\",\n  \"target\": \"test\"\n}"
        },
        {
            "role": "user",
            "content": "Do it."
        }
    ],
    "format": "json",
    "stream": False
}

try:
    resp = requests.post("http://127.0.0.1:11434/api/chat", json=payload, timeout=60)
    print("STATUS:", resp.status_code)
    content = resp.json().get("message", {}).get("content", "")
    print("CONTENT:", repr(content))
except Exception as e:
    print("ERROR:", e)
