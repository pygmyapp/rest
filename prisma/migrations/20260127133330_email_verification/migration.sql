-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationCreatedAt" TIMESTAMP(3),
ADD COLUMN     "emailVerificationToken" TEXT,
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false;
