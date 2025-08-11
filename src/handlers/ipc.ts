import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
// @ts-ignore ipc-client is lacking typing... fix this
import IPC, { type IPCMessage } from 'ipc-client';
import { sessionsTable } from '../db/schema';
import { validateToken } from './session';

const db = drizzle(process.env.DATABASE_URL ?? '');

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
        const { sessionId } = await validateToken(token);

        // Check session is still valid in database
        const [session] = await db
          .select()
          .from(sessionsTable)
          .where(eq(sessionsTable.id, sessionId));

        if (session === undefined)
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
          await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));

          return ipc.send('gateway', {
            type: 'response',
            action: 'VERIFY_TOKEN',
            token,
            valid: false,
            userId: null
          });
        }

        // Update session last use
        await db
          .update(sessionsTable)
          .set({
            lastUse: new Date()
          })
          .where(eq(sessionsTable.id, sessionId));

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
  }

  // Response:
  if (type === 'response') {
  }
});
