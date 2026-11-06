# Runs the Brandrail MCP server over stdio (used by Glama to inspect the server).
FROM node:22-slim
RUN npm install -g brandrail@0.10.1
WORKDIR /work
ENTRYPOINT ["brandrail", "mcp"]
