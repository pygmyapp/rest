import { z } from 'zod';

// Requests
export const userCreateBody = z.object({
  email: z.email().meta({ description: 'Email address' }),
  username: z
    .string()
    .min(2)
    .max(36)
    .toLowerCase()
    .regex(
      /^[a-zA-Z0-9_.]*$/,
      'Invalid input: Usernames can only contain letters, numbers, underscores and periods'
    )
    .meta({
      description:
        'Desired username. Usernames are unique and case insensitive (all lowercase).'
    }),
  password: z.string().min(8).max(72).meta({ description: 'Password' })
});

export const userUpdateBody = z
  .object({
    email: z.email().meta({
      description: 'New email address, requires "currentPassword" field'
    }),
    username: z
      .string()
      .min(2)
      .max(36)
      .toLowerCase()
      .regex(
        /^[a-zA-Z0-9_.]*$/,
        'Invalid input: Usernames can only contain letters, numbers, underscores and periods'
      )
      .meta({ description: 'New desired username' }),
    newPassword: z
      .string()
      .min(8)
      .max(72)
      .meta({ description: 'New password, requires "currentPassword" field' }),
    currentPassword: z.string().meta({
      description:
        'Current password, required to change email address or password'
    })
  })
  .partial()
  .refine(
    (data) => {
      if (data.email !== undefined && data.currentPassword === undefined)
        return false;
      if (data.newPassword !== undefined && data.currentPassword === undefined)
        return false;
      return true;
    },
    {
      message:
        '"currentPassword" field required to change email address/password',
      path: ['currentPassword']
    }
  );

// Responses
export const userCreateResponse = z
  .object({
    id: z.string().meta({ description: 'User ID' })
  })
  .meta({
    description: 'User created successfully'
  });

export const userGetSelfResponse = z
  .object({
    id: z.string().meta({ description: 'User ID' }),
    email: z.email().meta({ description: 'Email address' }),
    username: z.string().meta({ description: 'Username' }),
    verified: z.boolean().meta({ description: 'Email address verified status' })
  })
  .meta({
    description: 'User object'
  });
