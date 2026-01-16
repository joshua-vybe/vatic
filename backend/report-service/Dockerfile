FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lockb ./

RUN bun install --production

COPY . .

RUN bunx prisma generate

EXPOSE 3004

CMD ["bun", "run", "src/index.ts"]
