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

## Documentation

The REST API will automatically expose an OpenAPI 3.0 compliant specification at `/openapi.json` (and `/openapi`)

This is generated on the fly when requested, so changing source code should update this when reloaded

In *dev mode*, human-readable API documentation is automatically generated and served at `/docs` 

## Install

### Manual

- Clone this repository
- Install dependencies with `bun install`
- Ensure a PostgreSQL database is installed, configured and running
- Run `bun run push` to configure database columns
- Copy `.env.example` to `.env` and configure environment variables
- Copy `config.json.example` to `config.json` and configure mailer settings

## Running

To start in production mode:

```sh
bun run prod
```

To run in dev mode (reload on file changes, human-readable documentation):

```sh
bun run dev
```

## Scripts

- `bun run lint`: runs Biome's linting, applies safe fixes, suggests fixes to errors, and auto-organizes imports
- `bun run push`: pushes Drizzle schema changes (in `db/schema.ts`) to the PostgreSQL database
- `bun run studio`: runs Drizzle Studio, to visually access/modify database content

## Licence
Copyright (c) 2025 Pygmy & contributors  
All code & assets are licensed under GNU GPL v3 unless stated otherwise.  
See `LICENSE` or [see here](https://www.gnu.org/licenses/gpl-3.0.txt).