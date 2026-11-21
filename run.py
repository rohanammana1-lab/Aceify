import os
import threading
import time
import webbrowser

import uvicorn

PORT = int(os.environ.get("ACEIFY_PORT", "8825"))


def _open():
    time.sleep(1.2)
    webbrowser.open(f"http://127.0.0.1:{PORT}/")


if __name__ == "__main__":
    threading.Thread(target=_open, daemon=True).start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, log_level="warning")
