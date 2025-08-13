import { z } from 'zod';

// URL params
export const sessionDeleteParam = z.object({
  sessionId: z.string().nonempty().meta({ description: 'Session ID' })
})

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
    sessionId: z.string().meta({ description: 'Session ID' }),
    token: z.string().meta({ description: 'Session token' })
  })
  .meta({
    description: 'Session created successfully'
  });
