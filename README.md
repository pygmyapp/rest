# 🐰🌐 pygmyapp/rest
REST API to handle interacting with most of the platform

## Dependencies
**Pygmy is built with Bun!** It doesn't run on node.js alone, [see here to install Bun](https://bun.com/docs/installation) or [here to learn more](https://bun.sh).

`pygmyapp/rest` depends on:
- a [PostgreSQL](https://www.postgresql.org/) database with:
    - a database for Pygmy;
    - a user created for Pygmy;
    - ideally password protected;
    - and with full access to the database created.
- a [Valkey](https://valkey.io/) instance for cache and ratelimiting
    - this should be behind a firewall and only accessible from within the same machine/environment, **not remote**.

`pygmyapp/rest` also depends on:
- an active IPC server (`pygmyapp/ipc-server`), used for sending events
- an active CDN (`pygmyapp/cdn`), used for uploading/serving avatars, attachments, etc.

## Documentation

The REST API will automatically expose an OpenAPI 3.0 compliant specification at `/openapi.json` (and `/openapi`)

This is generated on the fly when requested, so changing source code should update this when reloaded

In *dev mode*, human-readable API documentation is automatically generated and served at `/docs` 

## Install

### Docker

If you are using Docker, you can clone this repository and run:

```sh
docker compose build # build image

docker compose up # start image
```

### Manual

- Clone this repository
- Install dependencies with `bun install`
- Ensure a PostgreSQL database is installed, configured and running
- Ensure a Valkey instance is installed and running
- Copy `.env.example` to `.env` and configure environment variables
- Copy `config.json.example` to `config.json` and configure mailer settings
- Run `bunx --bun prisma migrate deploy` to configure database & `bunx --bun prisma generate` to generate Prisma client

You can then start in production/dev mode:

```sh
bun run prod # production

bun run dev # dev mode - reloads on file changes, human-readable documentation, raised rate limits
```

## Scripts

- `bun run lint`: runs Biome linting, applies safe fixes, and auto-organizes imports
- `bunx --bun prisma format`: formats Prisma schema, if/when changes are made
- `bunx --bun prisma migrate dev --name <name>`: applies Prisma schema to database using migration file (recommended)
- `bunx --bun prisma migrate deploy`: deploys Prisma schema to database, for production
- `bunx --bun prisma generate`: generates Prisma client

## ⚠️ Development: Database Changes

When making database/schema changes, such as adding or modifying fields to implement new features, it is **important**
to create a new migration with `bunx --bun prisma migrate dev --name <name>`, with an approproate and accurate name.

This ensures that database changes can be safely pushed to existing instances in production, and allows for safer
development changes.

`prisma db push` immediantly syncs schema changes to the database without creating a migration, which is **not recommended.**

## Licence
Copyright (c) 2025 Pygmy & contributors

All code & assets are licensed under GNU GPL v3 unless stated otherwise.  
See `LICENSE` or [see here](https://www.gnu.org/licenses/gpl-3.0.txt).