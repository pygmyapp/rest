// @ts-ignore ipc-client is lacking typing... fix this
import IPC, { type IPCMessage } from 'ipc-client';
import prisma from '../handlers/db';
import { validateToken } from './session';

export const ipc = new IPC('rest');

ipc.on('connect', () => console.log('Connected to IPC server/socket'));

ipc.on('disconnect', () => console.log('Lost connection to IPC server/socket'));

ipc.on('message', async (message: IPCMessage) => {
  if (
    'type' in message.payload === false ||
    'action' in message.payload === false
  )
    return;

  const type = message.payload.type as string;
  const action = message.payload.action as string;

  // Request:
  if (type === 'request') {
    // Verify token
    // NOTE: this should act basically the same as session.ts authMiddleware,
    // apart from error sending ... if it gets updated, update this too!
    if (
      message.from === 'gateway' &&
      action === 'VERIFY_TOKEN' &&
      'token' in message.payload
    ) {
      const token = message.payload.token as string;

      try {
        // Validate token
        const { sessionId: id } = await validateToken(token);

        // Check session is still valid in database
        const session = await prisma.session.findUnique({
          where: { id }
        });

        if (!session)
          return ipc.send('gateway', {
            type: 'response',
            action: 'VERIFY_TOKEN',
            token,
            valid: false,
            userId: null
          });

        // If session hasn't been used in more than 2 weeks, it should be expired
        const now = new Date();
        const weekAgo = new Date();

        weekAgo.setDate(now.getDate() - 14);

        if (session.lastUse < weekAgo) {
          await prisma.session.delete({
            where: { id }
          });

          return ipc.send('gateway', {
            type: 'response',
            action: 'VERIFY_TOKEN',
            token,
            valid: false,
            userId: null
          });
        }

        // Update session last use
        await prisma.session.update({
          where: { id },
          data: {
            lastUse: new Date()
          }
        });

        return ipc.send('gateway', {
          type: 'response',
          action: 'VERIFY_TOKEN',
          token,
          valid: true,
          userId: session.userId
        });
      } catch (err) {
        console.error(err);

        return ipc.send('gateway', {
          type: 'response',
          action: 'VERIFY_TOKEN',
          token,
          valid: false,
          userId: null
        });
      }
    }

    if (
      message.from === 'gateway' &&
      action === 'FETCH_USER_DATA' &&
      'userId' in message.payload
    ) {
      const userId = message.payload.userId as string;

      // Determine user relations

      // A user is considered "related" to another user (and thus entited to receive their data) if:
      // - they are friends
      // - they are both in a group channel
      // - they are both in a server
      const relations: string[] = [];

      // (friends)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          friends: {
            select: { id: true }
          }
        }
      });

      if (user) relations.push(...user.friends.map(({ id }) => id));

      // Fetch the data of those users
      const data = await prisma.user.findMany({
        where: {
          id: {
            in: relations
          }
        },
        select: {
          id: true,
          username: true
        }
      });

      // Send data to Gateway
      return ipc.send('gateway', {
        type: 'response',
        action: 'FETCH_USER_DATA',
        userId,
        data
      });
    }
  }

  // Response:
  if (type === 'response') {
    // TODO: when required, currently not in use.
  }
});
