FROM node:20-slim

WORKDIR /app

# Install the published npm package
RUN npm install @kansei-link/cockpit@latest

# stdio MCP server — reads from stdin, writes to stdout
ENTRYPOINT ["npx", "@kansei-link/cockpit"]
