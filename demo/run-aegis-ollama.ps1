$env:VLM_PROVIDER = "ollama"
$env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
$env:OLLAMA_MODEL = "qwen3-vl:4b"
Set-Location -Path server
..\.venv\Scripts\python.exe -m uvicorn aegis_server.main:app --host 127.0.0.1 --port 8765
