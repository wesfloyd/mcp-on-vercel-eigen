import getRawBody from "raw-body";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";
import { createClient } from "redis";
import { Socket } from "net";
import { Readable } from "stream";

interface SerializedRequest {
  url: string;
  method: string;
  body: string;
  headers: IncomingHttpHeaders;
}

const redis = await createClient({ url: process.env.REDIS_URL }).connect();

let servers: Server[] = [];

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
) {
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

    redis.subscribe(`requests:${sessionId}`, async (message) => {
      console.log("Received message from Redis", message);
      const request = JSON.parse(message) as SerializedRequest;

      const req = createFakeIncomingMessage({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
      });
      const res = new ServerResponse(req);
      let status = 100;
      let body = "";
      res.writeHead = (statusCode) => {
        status = statusCode;
        return res;
      };
      res.end = () => {
        return res;
      };
      await transport.handlePostMessage(req, res);

      if (status >= 200 && status < 300) {
        console.info(`Request ${sessionId} succeeded`);
      } else {
        console.error(
          `Message for ${sessionId} failed with status ${status}: ${body}\n\n${JSON.stringify(
            req,
            null,
            2
          )}`
        );
      }
    });

    await server.connect(transport);
  } else if (url.pathname === "/message") {
    console.log("Received message");

    const body = await getRawBody(req, {
      length: req.headers["content-length"],
      encoding: "utf-8",
    });

    const sessionId = url.searchParams.get("sessionId") || "";

    const serializedRequest: SerializedRequest = {
      url: req.url || "",
      method: req.method || "",
      body: body,
      headers: req.headers,
    };

    // Queue the request in Redis so that a subscriber can pick it up.
    // One queue per session.
    await redis.publish(
      `requests:${sessionId}`,
      JSON.stringify(serializedRequest)
    );
    await redis.expire(`requests:${sessionId}`, 1 * 60); // 1 minute

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
