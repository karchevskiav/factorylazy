#!/usr/bin/env python3
# Static dev server that disables caching, so edited js/css is always reloaded fresh
# (plain `python -m http.server` lets the browser heuristically cache ES modules).
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8095
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
