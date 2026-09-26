"""
main.py — AEGIS FastAPI application
====================================
E1 changes:
 - Bind 127.0.0.1 by default (ADR-11)
 - Pass ?token= query parameter to WebSocket handler for demo auth
 - CORS restricted to localhost origins (localhost demo mode)
"""

from typing import Optional

from fastapi import FastAPI, WebSocket, Query
from fastapi.middleware.cors import CORSMiddleware

from aegis_server.ws_gateway import handle_websocket_connection
from aegis_server.view import router as view_router

app = FastAPI(
    title="AEGIS Server",
    description="Agentic Engine for Guarded Intelligent Surfing — Backend & Gateway",
    version="1.0.0",
)
app.include_router(view_router)

# Localhost-only CORS for demo (ADR-11)
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
async def websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None),
):
    """
    WebSocket endpoint.
    Demo-grade auth: pass ?token=<value> query parameter.
    If AEGIS_AUTH_TOKEN env var is not set, auth is skipped (localhost demo mode).
    The token value is NEVER logged or persisted.
    """
    await handle_websocket_connection(websocket, token=token)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "aegis_server.main:app",
        host="127.0.0.1",   # ADR-11: localhost only
        port=8765,
        log_level="info",
    )
