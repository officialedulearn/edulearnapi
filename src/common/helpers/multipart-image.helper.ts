import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { buffer as streamToBuffer } from 'node:stream/consumers';

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;

export async function parseProfileImageMultipart(
  req: FastifyRequest,
  fieldName = 'image',
): Promise<{ buffer: Buffer }> {
  if (!req.isMultipart()) {
    throw new BadRequestException('Expected multipart/form-data');
  }
  const part = await req.file();
  if (!part) {
    throw new BadRequestException('No file provided');
  }
  if (part.fieldname !== fieldName) {
    part.file.resume();
    throw new BadRequestException(`Expected file field "${fieldName}"`);
  }
  if (!ALLOWED_MIMES.has(part.mimetype)) {
    part.file.resume();
    throw new BadRequestException(
      `Invalid file type: ${part.mimetype}. Allowed: JPEG, PNG, WebP.`,
    );
  }
  const buf = await streamToBuffer(part.file);
  if (part.file.truncated || buf.length > MAX_BYTES) {
    throw new BadRequestException('Image file exceeds maximum size');
  }
  return { buffer: buf };
}
