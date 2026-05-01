import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';

function cloudinaryUploadSignature(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const paramString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto
    .createHash('sha1')
    .update(paramString + apiSecret)
    .digest('hex');
}

interface CloudinaryUploadResponse {
  secure_url?: string;
  error?: { message?: string };
}

@Injectable()
export class CloudinaryService {
  async uploadImageBuffer(buffer: Buffer, folder: string): Promise<string> {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException('Cloudinary is not configured');
    }

    const timestamp = Math.round(Date.now() / 1000);
    const signPayload: Record<string, string | number> = {
      timestamp,
      folder,
    };
    const signature = cloudinaryUploadSignature(signPayload, apiSecret);

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)]);
    formData.append('file', blob, 'upload.jpg');
    formData.append('api_key', apiKey);
    formData.append('timestamp', String(timestamp));
    formData.append('signature', signature);
    formData.append('folder', folder);

    const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
    try {
      const { data } = await axios.post<CloudinaryUploadResponse>(
        url,
        formData,
      );
      if (data.error?.message) {
        throw new InternalServerErrorException(data.error.message);
      }
      if (!data.secure_url) {
        throw new InternalServerErrorException(
          'Cloudinary upload returned no secure URL',
        );
      }
      return data.secure_url;
    } catch (e: unknown) {
      if (e instanceof InternalServerErrorException) {
        throw e;
      }
      const msg =
        axios.isAxiosError(e) && e.response?.data
          ? JSON.stringify(e.response.data)
          : e instanceof Error
            ? e.message
            : 'Image upload failed';
      throw new InternalServerErrorException(msg);
    }
  }
}
