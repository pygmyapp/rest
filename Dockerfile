FROM oven/bun:latest

COPY bun.lock package.json ./
COPY . .

RUN bun i

EXPOSE 3002

ENTRYPOINT [ "bun", "run", "dev" ]