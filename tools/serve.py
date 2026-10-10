#!/usr/bin/env python3
"""Static dev server for NEON STREET RUN that refuses to be cached.

python -m http.server sends no cache headers, so browsers (Edge especially) hold on to
ES modules across reloads and a hard refresh doesn't always evict them. This serves the
same files but tells the browser never to store them, so every reload gets current code.

Usage: python tools/serve.py [port]   (default 8200, serves the project root)
"""

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # keep the terminal readable: only log failures
        status = args[1] if len(args) > 1 else ""
        if str(status).startswith(("4", "5")):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8200
    handler = partial(NoCacheHandler, directory=ROOT)
    server = ThreadingHTTPServer(("", port), handler)
    print("NEON STREET RUN (no-cache) -> http://localhost:%d" % port)
    print("serving %s" % ROOT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
