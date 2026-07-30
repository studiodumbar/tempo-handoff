#!/usr/bin/env python3
"""Dev server — plain static file serving with caching disabled, so module
edits always arrive on reload.

Also accepts POST /save/<name>, writing the body into ./out/. Browser renders
(MP4s) have nowhere to go otherwise: the File System Access pickers need a real
user gesture, so an automated export cannot use them, and a plain download
lands somewhere we cannot verify. Writing through the server puts the files at
a known path.
"""
import http.server
import os
import re
import socketserver

PORT = 8484
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/save/"):
            self.send_error(404)
            return
        name = os.path.basename(self.path[len("/save/"):])
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", name or ""):
            self.send_error(400, "bad name")
            return
        n = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(n)
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(data)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(f"{len(data)}".encode())

    def log_message(self, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), NoStoreHandler) as httpd:
    print(f"serving on http://localhost:{PORT}  (POST /save/<name> -> out/)")
    httpd.serve_forever()
