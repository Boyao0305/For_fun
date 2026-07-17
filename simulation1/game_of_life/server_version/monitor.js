"use strict";

// Read-only monitoring server. Binds to 127.0.0.1 ONLY — reach it from a
// laptop via an ssh tunnel:  ssh -L 8080:localhost:8080 user@server
// It opens the database readonly and exposes no write endpoint of any kind;
// it cannot influence the computation.
//
// Usage: node monitor.js [--db runs.db] [--port 8080]

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { openReadonly } = require("./storage.js");

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--([\w-]+)$/);
  if (m) { args[m[1]] = process.argv[i + 1]; i++; }
}
const DB_PATH = path.resolve(__dirname, args.db || "runs.db");
const PORT = parseInt(args.port || "8080", 10);
const HOST = "127.0.0.1";

// static files served by exact whitelist — no path traversal possible
const STATIC = {
  "/": [path.join(__dirname, "public", "monitor.html"), "text/html"],
  "/monitor.css": [path.join(__dirname, "public", "monitor.css"), "text/css"],
  "/monitor.js": [path.join(__dirname, "public", "monitor.js"), "text/javascript"],
  "/life.js": [path.join(__dirname, "..", "version1", "life.js"), "text/javascript"],
};

let store = null;
function getStore() {
  if (!store) store = openReadonly(DB_PATH); // throws if db doesn't exist yet
  return store;
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body);
}

// ---------- SSE ----------

const sseClients = new Set();
let lastSimId = 0;

function pollNewSims() {
  if (sseClients.size === 0) return;
  let s;
  try { s = getStore(); } catch { return; }
  try {
    if (lastSimId === 0) lastSimId = s.maxSimId(); // start tailing from "now"
    const rows = s.simsAfter(lastSimId, 500);
    if (rows.length === 0) return;
    lastSimId = Number(rows[rows.length - 1].id);
    const payload = `event: sims\ndata: ${JSON.stringify(rows)}\n\n`;
    for (const res of sseClients) res.write(payload);
  } catch (err) {
    console.error("sse poll error:", err.message);
  }
}
setInterval(pollNewSims, 1000);

// ---------- server ----------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;

  if (STATIC[p]) {
    const [file, type] = STATIC[p];
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    });
    return;
  }

  if (p === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  let match;
  try {
    if (p === "/api/runs") {
      return json(res, 200, getStore().listRuns());
    }
    if ((match = p.match(/^\/api\/runs\/(\d+)\/generations$/))) {
      return json(res, 200, getStore().listGenerations(Number(match[1])));
    }
    if ((match = p.match(/^\/api\/runs\/(\d+)\/gens\/(\d+)\/sims$/))) {
      return json(res, 200, getStore().listSims(Number(match[1]), Number(match[2])));
    }
    if ((match = p.match(/^\/api\/runs\/(\d+)\/top$/))) {
      return json(res, 200, getStore().topSims(Number(match[1]), 20));
    }
    if ((match = p.match(/^\/api\/sims\/(\d+)$/))) {
      const sim = getStore().getSim(Number(match[1]));
      return sim ? json(res, 200, sim) : json(res, 404, { error: "no such sim" });
    }
  } catch (err) {
    store = null; // reopen next time (db may not exist yet, or WAL handoff)
    return json(res, 503, { error: err.message });
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`monitor (read-only) on http://${HOST}:${PORT}  db=${DB_PATH}`);
  console.log(`from your laptop:  ssh -L ${PORT}:localhost:${PORT} <user>@<server>  then open http://localhost:${PORT}`);
});
