import { z } from 'zod';

// Responses
export const errorResponse = z
  .object({
    error: z.string().optional(),
    errors: z.string().array().optional()
  })
  .partial()
  .meta({
    description:
      'Common error response, containing a single error field or multiple errors field'
  });
