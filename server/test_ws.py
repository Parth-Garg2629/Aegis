import asyncio
import websockets
import json
import base64
from PIL import Image
import io

async def test():
    try:
        async with websockets.connect('ws://127.0.0.1:8765/agent') as ws:
            print("Connected.")
            # Send initial message
            img = Image.new('RGB', (1024, 768), color='white')
            buf = io.BytesIO()
            img.save(buf, format='WEBP')
            img_b64 = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()

            req = {
                "url": "https://en.wikipedia.org/wiki/ISRO",
                "goal": "search for isro",
                "step_number": 1,
                "action_history": [],
                "sanitized_schema": '{"type": "root", "children": []}',
                "sanitized_screenshot": img_b64
            }
            await ws.send(json.dumps(req))
            print("Sent request.")

            resp = await ws.recv()
            print("Received:", resp)

    except Exception as e:
        print("Error:", e)

asyncio.run(test())
