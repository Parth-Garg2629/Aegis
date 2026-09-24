from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from aegis_server.ws_gateway import handle_websocket_connection

app = FastAPI(
    title="AEGIS Server",
    description="Agentic Engine for Guarded Intelligent Surfing — Backend & Gateway",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "aegis-server", "protocol_version": "1.0"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await handle_websocket_connection(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("aegis_server.main:app", host="127.0.0.1", port=8765, log_level="info")
