import pathlib
p = pathlib.Path('d:/Aegis/server/aegis_server/providers/ollama.py')
t = p.read_text(encoding='utf-8')
t = t.replace('"VLM HTTP request failed."', 'f"VLM HTTP request failed: {exc.response.status_code} - {exc.response.text}"')
p.write_text(t, encoding='utf-8')
