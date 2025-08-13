import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { openAPIRouteHandler } from 'hono-openapi';
import { version } from '../package.json';
import { ipc } from './handlers/ipc';
import session from './routes/session';
import user from './routes/user';

// Validate .env
if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '')
  throw 'Database URL must be defined in .env';

if (
  process.env.SESSION_SECRET === undefined ||
  process.env.SESSION_SECRET === ''
)
  throw 'Session secret must be defined in .env';

const app = new Hono();

app.use('/*', cors());

app.route('/users', user);
app.route('/sessions', session);

// Expose OpenAPI definitions
app.on(
  'GET',
  ['/openapi.json', '/openapi'],
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: '🐰🌐 pygmyapp/rest',
        version,
        description:
          "Pygmy's REST API, used to handle interacting with most of the platform"
      },
      tags: [
        {
          name: 'Users',
          description: 'Create and manage user accounts'
        },
        {
          name: 'Sessions',
          description:
            'Create and manage user sessions (for authentication with the REST API and Gateway)'
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Local development server'
        }
      ]
    }
  })
);

// Serve API documentation if in development mode
if (process.env.NODE_ENV === 'development')
  app.get(
    '/docs',
    Scalar({
      url: '/openapi.json',
      pageTitle: '🐰 Pygmy REST API Documentation'
    })
  );

// Connect to IPC
ipc.connect();

export default app;
