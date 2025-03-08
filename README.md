# Run an MCP Server on Vercel

## Sample POST

```sh
curl -X POST "https://mcp-on-vercel.vercel.app/message?sessionId=711b468f-bc3b-4d91-ad56-a51e815dbc63" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello, world!"
  }'
```
