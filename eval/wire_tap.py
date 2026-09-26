import asyncio
import websockets
import json
import time
import os
import argparse
from urllib.parse import urlparse

class WireTapProxy:
    def __init__(self, listen_port=8001, target_url="ws://127.0.0.1:8000/ws", run_dir="eval/runs/latest"):
        self.listen_port = listen_port
        self.target_url = target_url
        self.run_dir = run_dir
        self.allowed_origins = ["http://localhost:8080", "http://127.0.0.1:8080"]
        os.makedirs(self.run_dir, exist_ok=True)
        self.log_file = open(os.path.join(self.run_dir, "wire_tap.jsonl"), "w")

    def _log_frame(self, direction, payload):
        entry = {
            "timestamp": time.time(),
            "direction": direction,
            "payload": payload
        }
        self.log_file.write(json.dumps(entry) + "\n")
        self.log_file.flush()

    async def handle_client(self, websocket):
        async with websockets.connect(self.target_url) as target_ws:
            async def forward_to_target():
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        if data.get("type") == "context_update":
                            url = data.get("payload", {}).get("sanitized_schema", {}).get("url", "")
                            origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}" if url else ""
                            if origin not in self.allowed_origins and "AEGIS_EVAL_MODE" not in os.environ:
                                print(f"Wire tap blocked frame from non-eval origin: {origin}")
                                continue
                    except json.JSONDecodeError:
                        pass
                    
                    self._log_frame("client_to_server", message)
                    await target_ws.send(message)

            async def forward_to_client():
                async for message in target_ws:
                    self._log_frame("server_to_client", message)
                    await websocket.send(message)

            await asyncio.gather(
                forward_to_target(),
                forward_to_client()
            )

    async def start(self):
        print(f"Wire-tap proxy listening on ws://127.0.0.1:{self.listen_port}")
        print(f"Forwarding to {self.target_url}")
        async with websockets.serve(self.handle_client, "127.0.0.1", self.listen_port):
            await asyncio.Future()  # run forever

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--target", type=str, default="ws://127.0.0.1:8000/ws")
    parser.add_argument("--run-dir", type=str, default="eval/runs/latest")
    args = parser.parse_args()

    os.environ["AEGIS_EVAL_MODE"] = "1"
    
    proxy = WireTapProxy(args.port, args.target, args.run_dir)
    asyncio.run(proxy.start())
