import { z } from 'zod';

// Query params
export const sessionDeleteQuery = z
  .string()
  .nonempty()
  .meta({ description: 'Session ID' });

// Requests
export const sessionCreateBody = z.object({
  email: z.email().meta({ description: 'Email address' }),
  password: z.string().meta({ description: 'Password' })
});

// Responses
export const sessionListResponse = z
  .object({
    id: z.string().meta({ description: 'Session ID' }),
    userId: z.string().meta({ description: 'User ID' }),
    lastUsed: z.string().meta({ description: 'Date provided as a string' }),
    active: z.boolean().meta({
      description:
        'Whether this session is the current session (authorized/logged in)'
    })
  })
  .array()
  .meta({
    description: 'List of active sessions'
  });

export const sessionCreateResponse = z
  .object({
    id: z.string().meta({ description: 'Session ID' })
  })
  .meta({
    description: 'Session created successfully'
  });
