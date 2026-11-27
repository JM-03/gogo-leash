// vidrec proxy — serves the lab page with its RPC rewritten to a local
// proxy, so the sandbox browser (no direct internet) can talk to the real
// QoreChain EVM RPC through Node. Same page, same vault, same chain.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const LAB = "/home/hatch/workspace/qorechain-gogo-leash/docs/lab/index.html";
const RPC_UPSTREAM = "https://evm-testnet.qore.host/";
const PORT = 8933;

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/lab/") {
    const html = readFileSync(LAB, "utf8").replace(
      "const RPC = 'https://evm-testnet.qore.host/';",
      "const RPC = '/rpc';"
    );
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  if (req.url === "/rpc" && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    try {
      const up = await fetch(RPC_UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const text = await up.text();
      res.writeHead(up.status, { "content-type": "application/json" });
      res.end(text);
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`lab proxy: http://localhost:${PORT}/`));
