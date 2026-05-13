import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import db from '../../../drizzle';
import { user } from '../../../lib/db/schema';
import { eq } from 'drizzle-orm';

const AUTH_USER_CACHE_TTL_MS = 60_000;
const AUTH_USER_CACHE_MAX_ENTRIES = 1000;

const authUserIdByEmail = new Map<string, { id: string; expiresAt: number }>();

function cacheAuthUserId(email: string, id: string): void {
  if (authUserIdByEmail.size >= AUTH_USER_CACHE_MAX_ENTRIES) {
    const oldestKey = authUserIdByEmail.keys().next().value;
    if (oldestKey) {
      authUserIdByEmail.delete(oldestKey);
    }
  }

  authUserIdByEmail.set(email.toLowerCase(), {
    id,
    expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
  });
}

async function getAuthenticatedDatabaseUserId(
  authenticatedUser: any,
): Promise<string> {
  const email = authenticatedUser.email;
  if (!email) {
    throw new UnauthorizedException('Email not found in JWT token');
  }

  const cacheKey = email.toLowerCase();
  const cachedUser = authUserIdByEmail.get(cacheKey);
  if (cachedUser && cachedUser.expiresAt > Date.now()) {
    return cachedUser.id;
  }

  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (!users.length) {
    authUserIdByEmail.delete(cacheKey);
    throw new UnauthorizedException('User not found in database');
  }

  cacheAuthUserId(email, users[0].id);

  return users[0].id;
}

export async function verifyUserAuthorization(
  authenticatedUser: any,
  targetUserId: string,
  operationName: string = 'this operation',
): Promise<void> {
  if (!authenticatedUser) {
    throw new UnauthorizedException('Authentication required');
  }

  if (authenticatedUser.role === 'reviewer') {
    return;
  }

  if (authenticatedUser.role === 'marketplace') {
    return;
  }

  const authenticatedUserId =
    await getAuthenticatedDatabaseUserId(authenticatedUser);

  if (authenticatedUserId !== targetUserId) {
    throw new ForbiddenException(
      `You are not authorized to perform ${operationName} for another user`,
    );
  }
}

export function getAuthenticatedUserId(authenticatedUser: any): string {
  if (!authenticatedUser) {
    throw new UnauthorizedException('Authentication required');
  }

  const userId = authenticatedUser.sub || authenticatedUser.id;

  if (!userId) {
    throw new UnauthorizedException('Invalid authentication token');
  }

  return userId;
}

export async function getDatabaseUserId(
  authenticatedUser: any,
): Promise<string> {
  if (!authenticatedUser) {
    throw new UnauthorizedException('Authentication required');
  }

  if (
    authenticatedUser.role === 'reviewer' ||
    authenticatedUser.role === 'marketplace'
  ) {
    throw new UnauthorizedException(
      'This operation is not available for system users',
    );
  }

  return await getAuthenticatedDatabaseUserId(authenticatedUser);
}

export async function verifyUserEmail(authenticatedUser: any): Promise<string> {
  if (!authenticatedUser) {
    throw new UnauthorizedException('Authentication required');
  }

  if (
    authenticatedUser.role === 'reviewer' ||
    authenticatedUser.role === 'marketplace'
  ) {
    return authenticatedUser.email;
  }

  const email = authenticatedUser.email;
  if (!email) {
    throw new UnauthorizedException('Email not found in authentication token');
  }

  return email;
}

export async function verifyUserViewAuthorization(
  authenticatedUser: any,
  targetUserId: string,
): Promise<void> {
  if (!authenticatedUser) {
    throw new UnauthorizedException('Authentication required');
  }

  if (
    authenticatedUser.role === 'reviewer' ||
    authenticatedUser.role === 'marketplace'
  ) {
    return;
  }

  const authenticatedUserId =
    await getAuthenticatedDatabaseUserId(authenticatedUser);

  if (authenticatedUserId === targetUserId) {
    return;
  }

  const targetUser = await db
    .select()
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);

  if (!targetUser.length) {
    throw new UnauthorizedException('Target user not found');
  }
}

export async function verifyChatAccess(
  authenticatedUser: any,
  chat: any,
  operationName: string = 'access this chat',
): Promise<void> {
  if (!chat) {
    throw new UnauthorizedException('Chat not found');
  }

  if (chat.visibility === 'public') {
    return;
  }

  if (!authenticatedUser) {
    throw new UnauthorizedException('Authentication required');
  }

  if (
    authenticatedUser.role === 'reviewer' ||
    authenticatedUser.role === 'marketplace'
  ) {
    return;
  }

  const authenticatedUserId =
    await getAuthenticatedDatabaseUserId(authenticatedUser);

  if (chat.userId !== authenticatedUserId) {
    throw new ForbiddenException(
      `You are not authorized to ${operationName}. This chat is private.`,
    );
  }
}
