# Runs the Brandrail MCP server over stdio (used by Glama to inspect the server).
# Pin the base image by digest for reproducible builds: docker pull node:22-slim, then FROM node:22-slim@sha256:<digest>
FROM node:22-slim
RUN npm install -g --ignore-scripts brandrail@0.10.4
USER node
WORKDIR /home/node/work
ENTRYPOINT ["brandrail", "mcp"]
