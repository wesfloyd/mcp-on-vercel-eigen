# Run an MCP Server on Vercel

## Sample POST

```sh
curl -X POST "https://mcp-on-vercel.vercel.app/message?sessionId=2009b2d0-7584-4d3e-8f0e-62d6df7211b4" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello, world!"
  }'
```
