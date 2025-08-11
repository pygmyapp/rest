import { relations } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Users
export const usersTable = pgTable('users', {
  id: text('id').primaryKey(),
  username: text().notNull(),
  email: text().notNull().unique(),
  hash: text().notNull(),
  verified: boolean().notNull()
});

export const usersRelations = relations(usersTable, ({ many }) => ({
  sessions: many(sessionsTable)
}));

// Sessions
export const sessionsTable = pgTable('sessions', {
  id: text('session_id').primaryKey(),
  userId: text('user_id').notNull(),
  lastUse: timestamp({ mode: 'date' }).notNull().defaultNow()
});

export const sessionsRelations = relations(sessionsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [sessionsTable.userId],
    references: [usersTable.id]
  })
}));
