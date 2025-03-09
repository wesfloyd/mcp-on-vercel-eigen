# Run an MCP Server on Vercel

## Sample POST

```sh
curl -X POST "https://mcp-on-vercel.vercel.app/message?sessionId=3657fb33-19a4-4e05-bc33-3fd17d0fffe8" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello, world!"
  }'
```
