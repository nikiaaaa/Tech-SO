"""Entry point:  python run.py
Serves the API and, when frontend/dist exists (npm run build), the web app too: one process, one port.

  TECHSO_HOST      default 127.0.0.1. Set 0.0.0.0 to reach it from phones on the same network.
  TECHSO_PORT      default 8000
  TECHSO_SSL_CERT / TECHSO_SSL_KEY   PEM files. Phones need https for GPS and the camera.
"""
import os
import uvicorn

if __name__ == "__main__":
    cert, key = os.environ.get("TECHSO_SSL_CERT"), os.environ.get("TECHSO_SSL_KEY")
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("TECHSO_HOST", "127.0.0.1"),
        port=int(os.environ.get("TECHSO_PORT", "8000")),
        ssl_certfile=cert if cert and key else None,
        ssl_keyfile=key if cert and key else None,
        # The WebSocket carries the access token in its query string; access logs would record it.
        access_log=False,
    )
