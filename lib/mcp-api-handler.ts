import getRawBody from "raw-body";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";
import { createClient } from "redis";
import { Socket } from "net";
import { Readable } from "stream";
import { resolve } from "path";

interface SerializedRequest {
  url: string;
  method: string;
  body: string;
  headers: IncomingHttpHeaders;
}

const redis = createClient({ url: process.env.REDIS_URL });
const redisPromise = redis.connect();
redis.on("error", (err) => {
  console.error("Redis error", err);
});

let servers: Server[] = [];

export async function mcpApiHandler(req: IncomingMessage, res: ServerResponse) {
  await redisPromise;
  const url = new URL(req.url || "", "https://example.com");
  if (url.pathname === "/sse") {
    console.log("Got new SSE connection");

    const transport = new SSEServerTransport("/message", res);
    const sessionId = transport.sessionId;
    const server = new Server(
      {
        name: "mcp-typescript test server on vercel",
        version: "0.1.0",
      },
      {
        capabilities: {},
      }
    );

    servers.push(server);

    server.onclose = () => {
      console.log("SSE connection closed");
      servers = servers.filter((s) => s !== server);
    };

    let logs: {
      type: "log" | "error";
      messages: string[];
    }[] = [];
    // This ensures that we logs in the context of the right invocation since the subscriber
    // is not itself invoked in request context.
    function logInContext(severity: "log" | "error", ...messages: string[]) {
      logs.push({
        type: severity,
        messages,
      });
    }

    const handleMessage = async (message: string) => {
      console.log("Received message from Redis", message);
      logInContext("log", "Received message from Redis", message);
      const request = JSON.parse(message) as SerializedRequest;

      const req = createFakeIncomingMessage({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
      });
      const syntheticRes = new ServerResponse(req);
      let status = 100;
      let body = "";
      syntheticRes.writeHead = (statusCode) => {
        status = statusCode;
        return syntheticRes;
      };
      syntheticRes.end = (b) => {
        body = b;
        return syntheticRes;
      };
      await transport.handlePostMessage(req, syntheticRes);

      if (status >= 200 && status < 300) {
        logInContext("log", `Request ${sessionId} succeeded`);
      } else {
        logInContext(
          "error",
          `Message for ${sessionId} failed with status ${status}: ${body}`
        );
      }
    };

    const interval = setInterval(() => {
      for (const log of logs) {
        console[log.type].call(console, ...log.messages);
      }
      logs = [];
    }, 100);

    await redis.subscribe(`requests:${sessionId}`, handleMessage);
    console.log(`Subscribed to requests:${sessionId}`);

    let timeout: NodeJS.Timeout;
    let resolveTimeout: (value: unknown) => void;
    const waitPromise = new Promise((resolve) => {
      resolveTimeout = resolve;
      timeout = setTimeout(() => {
        resolve("max duration reached");
      }, 795 * 1000);
    });

    async function cleanup() {
      clearTimeout(timeout);
      clearInterval(interval);
      await redis.unsubscribe(`requests:${sessionId}`, handleMessage);
      console.log("Done");
      res.end();
    }
    req.on("close", () => resolveTimeout("client hang up"));

    await server.connect(transport);
    const closeReason = await waitPromise;
    console.log(closeReason);
    await cleanup();
  } else if (url.pathname === "/message") {
    console.log("Received message");

    const body = await getRawBody(req, {
      length: req.headers["content-length"],
      encoding: "utf-8",
    });

    const sessionId = url.searchParams.get("sessionId") || "";
    if (!sessionId) {
      res.statusCode = 400;
      res.end("No sessionId provided");
      return;
    }

    const serializedRequest: SerializedRequest = {
      url: req.url || "",
      method: req.method || "",
      body: body,
      headers: req.headers,
    };

    // Queue the request in Redis so that a subscriber can pick it up.
    // One queue per session.
    await Promise.all([
      redis.publish(`requests:${sessionId}`, JSON.stringify(serializedRequest)),
      redis.expire(`requests:${sessionId}`, 1 * 60), // 1 minute
    ]);
    console.log(`Published requests:${sessionId}`);

    res.statusCode = 202;
    res.end("Accepted");
  } else if (url.pathname === "/") {
    res.statusCode = 200;
    res.end("Hello, world!");
  } else {
    res.statusCode = 404;
    res.end("Not found");
  }
}

// Define the options interface
interface FakeIncomingMessageOptions {
  method?: string;
  url?: string;
  headers?: IncomingHttpHeaders;
  body?: string | Buffer | Record<string, any> | null;
  socket?: Socket;
}

// Create a fake IncomingMessage
function createFakeIncomingMessage(
  options: FakeIncomingMessageOptions = {}
): IncomingMessage {
  const {
    method = "GET",
    url = "/",
    headers = {},
    body = null,
    socket = new Socket(),
  } = options;

  // Create a readable stream that will be used as the base for IncomingMessage
  const readable = new Readable();
  readable._read = (): void => {}; // Required implementation

  // Add the body content if provided
  if (body) {
    if (typeof body === "string") {
      readable.push(body);
    } else if (Buffer.isBuffer(body)) {
      readable.push(body);
    } else {
      readable.push(JSON.stringify(body));
    }
    readable.push(null); // Signal the end of the stream
  }

  // Create the IncomingMessage instance
  const req = new IncomingMessage(socket);

  // Set the properties
  req.method = method;
  req.url = url;
  req.headers = headers;

  // Copy over the stream methods
  req.push = readable.push.bind(readable);
  req.read = readable.read.bind(readable);
  req.on = readable.on.bind(readable);
  req.pipe = readable.pipe.bind(readable);

  return req;
}
