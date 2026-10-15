/**
 * Minimal MCP Streamable HTTP client, enough to call a few FastMoss tools in
 * one session from a Cloudflare Worker (no Node `mcp` SDK available at the
 * edge, so this is a small hand-rolled subset of the same protocol
 * engine/client.py uses via the official Python SDK -- same URL, same
 * initialize/tools-call framing, same {result,tool_id} unwrap quirk).
 *
 * No retries: a user-initiated search isn't an unattended batch job, and
 * blindly retrying a tool call that may have already succeeded server-side
 * risks double-spending credits. A failure here is surfaced to the person
 * searching, who can just try again.
 */

const FASTMOSS_MCP_URL = "https://mcp.fastmoss.com/mcp";

export class FastMossError extends Error {}

function unwrap(parsed) {
  if (parsed && typeof parsed === "object" && "result" in parsed && "tool_id" in parsed) {
    const inner = parsed.result;
    if (inner && typeof inner === "object") return inner;
  }
  return parsed;
}

function parseJsonRpcBody(text, contentType) {
  let body = text;
  if ((contentType || "").includes("text/event-stream")) {
    body = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
  }
  if (!body) return null;
  return JSON.parse(body);
}

/**
 * Runs `calls` (array of {tool, arguments}) in order within one MCP
 * session, returning their unwrapped results in the same order. Throws
 * FastMossError on the first failure -- callers decide how many of
 * `calls` to run (e.g. stop after creator_search finds no one).
 */
export async function callFastMossTools(apiKey, calls) {
  const url = `${FASTMOSS_MCP_URL}?api_key=${encodeURIComponent(apiKey)}`;
  let sessionId = null;
  let nextId = 1;

  async function send(method, params, { notification = false } = {}) {
    const payload = { jsonrpc: "2.0", method, params };
    if (!notification) payload.id = nextId++;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    let resp;
    try {
      resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    } catch (e) {
      throw new FastMossError(`could not reach FastMoss MCP for ${method}: ${e.message}`);
    }
    const sid = resp.headers.get("Mcp-Session-Id");
    if (sid) sessionId = sid;
    if (notification) return null;

    const text = await resp.text();
    if (!resp.ok) throw new FastMossError(`${method} HTTP ${resp.status}: ${text.slice(0, 300)}`);
    const parsed = parseJsonRpcBody(text, resp.headers.get("Content-Type"));
    if (!parsed) throw new FastMossError(`${method} returned an empty body`);
    if (parsed.error) throw new FastMossError(`${method} error: ${JSON.stringify(parsed.error)}`);
    return parsed.result;
  }

  await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "product-radar-worker", version: "1.0.0" },
  });
  await send("notifications/initialized", {}, { notification: true });

  const results = [];
  for (const { tool, arguments: args } of calls) {
    const result = await send("tools/call", { name: tool, arguments: args || {} });
    if (result?.isError) {
      throw new FastMossError(`${tool} returned an error: ${JSON.stringify(result.content).slice(0, 300)}`);
    }
    const textBlock = (result?.content || []).find((c) => typeof c?.text === "string");
    if (!textBlock) throw new FastMossError(`${tool} result had no text content block`);
    let data;
    try {
      data = JSON.parse(textBlock.text);
    } catch (e) {
      throw new FastMossError(`${tool} result text wasn't valid JSON: ${e.message}`);
    }
    results.push(unwrap(data));
  }
  return results;
}
