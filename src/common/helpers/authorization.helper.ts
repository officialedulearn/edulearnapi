import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

function getTokenUserId(authenticatedUser: any): string {
  const userId =
    authenticatedUser?.sub ||
    authenticatedUser?.id ||
    authenticatedUser?.user?.id ||
    authenticatedUser?.user_metadata?.sub;

  if (!userId) {
    throw new UnauthorizedException('Invalid authentication token');
  }

  return userId;
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

  const authenticatedUserId = getTokenUserId(authenticatedUser);

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

  return getTokenUserId(authenticatedUser);
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

  return getTokenUserId(authenticatedUser);
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

  getTokenUserId(authenticatedUser);
  return;
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

  const authenticatedUserId = getTokenUserId(authenticatedUser);

  if (chat.userId !== authenticatedUserId) {
    throw new ForbiddenException(
      `You are not authorized to ${operationName}. This chat is private.`,
    );
  }
}
