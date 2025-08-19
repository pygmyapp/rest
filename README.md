# 🐰🌐 pygmyapp/rest
REST API to handle interacting with most of the platform

## Dependencies
**Pygmy is built with Bun!** It doesn't run on node.js alone, [see here to install Bun](https://bun.com/docs/installation) or [here to learn more](https://bun.sh).

`pygmyapp/rest` depends on a [PostgreSQL](https://www.postgresql.org/) database with:
- a database for Pygmy;
- a user created for Pygmy;
- ideally password protected;
- and with full access to the database created.

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
- Copy `.env.example` to `.env` and configure environment variables
- Copy `config.json.example` to `config.json` and configure mailer settings
- Run `bun run init-db` to configure database & generate Prisma client

You can then start in production/dev mode:
```sh
bun run prod # production

bun run dev # dev mode - reloads on file changes, human-readable documentation
```

## Scripts

- `bun run lint`: runs Biome linting, applies safe fixes, and auto-organizes imports
- `bun run init-db`: shortcut for `bunx prisma db push`; applies Prisma schema to database, generates Prisma client from schema
- `bunx prisma generate`: generates Prisma client from schema
- `bunx prisma format`: formats Prisma schema, if/when changes are made

## Licence
Copyright (c) 2025 Pygmy & contributors

All code & assets are licensed under GNU GPL v3 unless stated otherwise.  
See `LICENSE` or [see here](https://www.gnu.org/licenses/gpl-3.0.txt).