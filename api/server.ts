import { initializeMcpApiHandler } from "../lib/mcp-api-handler";

export const handler = initializeMcpApiHandler((server) => {
  server.resource("config", "config://app", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: "We are running on Vercel",
      },
    ],
  }));
});
