import type { ValidationTargets } from 'hono';
import { validator as zv } from 'hono-openapi';
import type { ZodType } from 'zod';

export const validate = <
  T extends ZodType,
  Target extends keyof ValidationTargets
>(
  target: Target,
  schema: T
) =>
  zv(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          errors: result.error.map(
            ({ path, message }) => `"${path}": ${message}`
          )
        },
        400
      );
    }
  });
