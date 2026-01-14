# Build stage
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
# Note: If bun.lockb exists in the build context, it will be used for reproducible builds.
# To enable frozen lockfile builds, generate bun.lockb locally with `bun install`
# and ensure it's copied into the build context.
RUN bun install

# Copy source code
COPY src ./src
COPY tsconfig.json ./
COPY prisma ./prisma

# Generate Prisma client
RUN bun x prisma generate

# Build TypeScript
RUN bun build src/index.ts --outdir dist --target bun

# Production stage
FROM oven/bun:1.1-alpine

WORKDIR /app

# Copy built application and dependencies from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

# Expose port
EXPOSE 3000

# Health check - uses bun to make HTTP request to /health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run application
CMD ["bun", "run", "dist/index.js"]
