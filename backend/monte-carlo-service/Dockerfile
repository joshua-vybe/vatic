FROM oven/bun:1.0

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma client
RUN bun run prisma generate

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Expose port
EXPOSE 3002

# Start service
CMD ["bun", "run", "src/index.ts"]
