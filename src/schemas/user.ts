import { z } from 'zod';

// URL params
export const userDeleteFriendParam = z.object({
  userId: z
    .string()
    .nonempty()
    .meta({ description: 'User ID of friend to remove' })
});

export const userUpdateRequestParam = z.object({
  userId: z
    .string()
    .nonempty()
    .meta({ description: 'User ID of request to accept/ignore' })
});

export const userDeleteRequestParam = z.object({
  userId: z
    .string()
    .nonempty()
    .meta({ description: 'User ID of request to cancel' })
});

export const userDeleteBlockedParam = z.object({
  userId: z.string().nonempty().meta({ description: 'User ID to unblock' })
});

export const userGetParam = z.object({
  userId: z.string().nonempty().meta({ description: 'User ID to fetch' })
});

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

export const userCreateRequestBody = z.object({
  username: z
    .string()
    .nonempty()
    .meta({ description: 'Username of user to send friend request to' })
});

export const userUpdateRequestBody = z.object({
  accept: z
    .boolean()
    .meta({ description: 'Whether to accept the friend request or not' })
});

export const userCreateBlockedBody = z.object({
  userId: z.string().nonempty().meta({ description: 'User ID to block' })
});

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

export const userGetFriendsResponse = z.string().array().meta({
  description: 'Array of user IDs'
});

export const userGetRequestsResponse = z
  .object({
    direction: z.enum(['INCOMING', 'OUTGOING']),
    from: z.string(),
    to: z.string()
  })
  .array()
  .meta({
    description: 'Array of friend request objects'
  });

export const userGetResponse = z
  .object({
    id: z.string().meta({ description: 'User ID' }),
    username: z.string().meta({ description: 'Username' })
  })
  .meta({
    description: 'User object'
  });