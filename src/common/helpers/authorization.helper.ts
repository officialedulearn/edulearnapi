import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import db from '../../../drizzle';
import { user } from '../../../lib/db/schema';
import { eq } from 'drizzle-orm';

export async function verifyUserAuthorization(
  authenticatedUser: any,
  targetUserId: string,
  operationName: string = 'this operation'
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

  const email = authenticatedUser.email;
  if (!email) {
    throw new UnauthorizedException('Email not found in JWT token');
  }

  const users = await db.select().from(user).where(eq(user.email, email)).limit(1);
  
  if (!users.length) {
    throw new UnauthorizedException('User not found in database');
  }

  const authenticatedUserId = users[0].id;

  if (authenticatedUserId !== targetUserId) {
    throw new ForbiddenException(
      `You are not authorized to perform ${operationName} for another user`
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

export async function verifyUserEmail(authenticatedUser: any): Promise<string> {
  if (!authenticatedUser) {
    throw new UnauthorizedException('Authentication required');
  }

  if (authenticatedUser.role === 'reviewer' || authenticatedUser.role === 'marketplace') {
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
  targetUserId: string
): Promise<void> {
  if (!authenticatedUser) {
    throw new UnauthorizedException('Authentication required');
  }

  if (authenticatedUser.role === 'reviewer' || authenticatedUser.role === 'marketplace') {
    return;
  }

  const email = authenticatedUser.email;
  if (!email) {
    throw new UnauthorizedException('Email not found in JWT token');
  }

  const users = await db.select().from(user).where(eq(user.email, email)).limit(1);
  
  if (!users.length) {
    throw new UnauthorizedException('User not found in database');
  }

  const authenticatedUserId = users[0].id;

  if (authenticatedUserId === targetUserId) {
    return;
  }

  const targetUser = await db.select().from(user).where(eq(user.id, targetUserId)).limit(1);
  
  if (!targetUser.length) {
    throw new UnauthorizedException('Target user not found');
  }
}

export async function verifyChatAccess(
  authenticatedUser: any,
  chat: any,
  operationName: string = 'access this chat'
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

  if (authenticatedUser.role === 'reviewer' || authenticatedUser.role === 'marketplace') {
    return;
  }

  const email = authenticatedUser.email;
  if (!email) {
    throw new UnauthorizedException('Email not found in authentication token');
  }

  const users = await db.select().from(user).where(eq(user.email, email)).limit(1);
  
  if (!users.length) {
    throw new UnauthorizedException('User not found in database');
  }

  const authenticatedUserId = users[0].id;

  if (chat.userId !== authenticatedUserId) {
    throw new ForbiddenException(
      `You are not authorized to ${operationName}. This chat is private.`
    );
  }
}

