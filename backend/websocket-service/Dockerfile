FROM oven/bun:1

WORKDIR /app

# Copy package files
COPY package.json .
COPY package-lock.json* .
COPY pnpm-lock.yaml* .

# Install dependencies
RUN bun install

# Copy source code
COPY src ./src
COPY tsconfig.json .

# Expose port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD bun run -e "const res = await fetch('http://localhost:3003/health'); process.exit(res.ok ? 0 : 1)"

# Run service
CMD ["bun", "run", "src/index.ts"]
