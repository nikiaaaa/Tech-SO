"""WebSocket fan-out, scoped per tenant. Sync request handlers publish through a thread-safe bridge."""
import asyncio
import json
from dataclasses import dataclass
from fastapi import WebSocket


@dataclass
class _Conn:
    ws: WebSocket
    user_id: str
    role: str
    company_id: str


class Hub:
    def __init__(self) -> None:
        self._conns: list[_Conn] = []
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, ws: WebSocket, user_id: str, role: str, company_id: str) -> _Conn:
        await ws.accept()
        c = _Conn(ws, user_id, role, company_id)
        self._conns.append(c)
        return c

    def disconnect(self, c: _Conn) -> None:
        if c in self._conns:
            self._conns.remove(c)

    async def _send(self, company_id: str, event: dict, roles: set[str] | None, user_ids: set[str] | None) -> None:
        text = json.dumps(event, default=str)
        for c in list(self._conns):
            if c.company_id != company_id:
                continue
            targeted = roles is not None or user_ids is not None
            if targeted and not ((roles and c.role in roles) or (user_ids and c.user_id in user_ids)):
                continue
            try:
                await c.ws.send_text(text)
            except Exception:
                self.disconnect(c)

    def publish(self, company_id: str, event: dict, roles: set[str] | None = None,
                user_ids: set[str] | None = None) -> None:
        """Callable from sync code (threadpool). No-op when no loop is bound (e.g. unit tests)."""
        if self._loop is None or self._loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self._send(company_id, event, roles, user_ids), self._loop)


hub = Hub()
STAFF_ROLES = {"super_admin", "management", "supervisor", "scheduler"}
LOCATION_ROLES = {"super_admin", "management", "supervisor", "scheduler"}
