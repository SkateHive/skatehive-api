/**
 * IPFS Upload Endpoint
 * 
 * POST /api/v2/ipfs/upload
 * 
 * Upload images and videos to Skatehive IPFS via Pinata.
 * Requires API key authentication.
 * 
 * @example
 * curl -X POST https://api.skatehive.app/api/v2/ipfs/upload \
 *   -H "Authorization: Bearer YOUR_API_KEY" \
 *   -F "file=@image.jpg" \
 *   -F "creator=myusername"
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkApiKey } from '@/app/utils/apiAuth';

// Configuration
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const PINATA_API_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const SKATEHIVE_GATEWAY = 'https://ipfs.skatehive.app/ipfs/';

// Supported file extensions
const SUPPORTED_IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const SUPPORTED_VIDEO_TYPES = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
const ALL_SUPPORTED_TYPES = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_VIDEO_TYPES];

/**
 * Validate file type by extension
 */
function validateFileType(filename: string): { valid: boolean; mediaType: string | null; error?: string } {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  
  if (!ext) {
    return { valid: false, mediaType: null, error: 'No file extension found' };
  }
  
  if (!ALL_SUPPORTED_TYPES.includes(ext)) {
    return { 
      valid: false, 
      mediaType: null, 
      error: `Unsupported file type: ${ext}. Supported: ${ALL_SUPPORTED_TYPES.join(', ')}` 
    };
  }
  
  const mediaType = SUPPORTED_IMAGE_TYPES.includes(ext) ? 'image' : 'video';
  return { valid: true, mediaType };
}

/**
 * Upload file to Pinata IPFS
 */
async function uploadToPinata(
  file: File,
  creator: string,
  pinataJwt: string
): Promise<{ IpfsHash: string; PinSize: number; Timestamp: string }> {
  const formData = new FormData();
  formData.append('file', file);

  // Validate file type
  const { valid, mediaType, error } = validateFileType(file.name);
  if (!valid) {
    throw new Error(error || 'Invalid file type');
  }

  // Add metadata
  const metadata = {
    name: file.name,
    keyvalues: {
      creator: creator || 'api-upload',
      fileType: mediaType,
      uploadDate: new Date().toISOString(),
      source: 'skatehive-api',
      size: file.size,
    }
  };
  formData.append('pinataMetadata', JSON.stringify(metadata));

  // Add options (CID v1)
  const options = { cidVersion: 1 };
  formData.append('pinataOptions', JSON.stringify(options));

  // Upload to Pinata
  const response = await fetch(PINATA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${pinataJwt}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinata upload failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  return {
    IpfsHash: result.IpfsHash,
    PinSize: result.PinSize,
    Timestamp: result.Timestamp || new Date().toISOString(),
  };
}

/**
 * POST handler
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Check API key
    const authResult = checkApiKey(request);
    if (!authResult.authorized) {
      return NextResponse.json(
        { 
          error: 'Unauthorized', 
          message: 'Valid API key required. Include as Bearer token in Authorization header.' 
        },
        { status: 401 }
      );
    }

    // 2. Get PINATA_JWT from environment
    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      console.error('[IPFS Upload] PINATA_JWT not configured');
      return NextResponse.json(
        { error: 'Server configuration error', message: 'IPFS service not configured' },
        { status: 500 }
      );
    }

    // 3. Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const creator = (formData.get('creator') as string) || authResult.keyName || 'api-upload';

    if (!file) {
      return NextResponse.json(
        { error: 'Bad request', message: 'No file provided. Send file as multipart/form-data with field name "file".' },
        { status: 400 }
      );
    }

    // 4. Validate file size
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      const maxMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
      return NextResponse.json(
        { 
          error: 'File too large', 
          message: `File size ${sizeMB}MB exceeds limit of ${maxMB}MB` 
        },
        { status: 413 }
      );
    }

    // 5. Validate file type
    const { valid, mediaType, error } = validateFileType(file.name);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid file type', message: error },
        { status: 400 }
      );
    }

    // 6. Upload to Pinata
    console.log(`[IPFS Upload] Uploading ${file.name} (${(file.size / 1024).toFixed(2)}KB) for ${creator}...`);
    
    const uploadResult = await uploadToPinata(file, creator, pinataJwt);

    // 7. Return result
    const response = {
      success: true,
      ipfsHash: uploadResult.IpfsHash,
      pinSize: uploadResult.PinSize,
      timestamp: uploadResult.Timestamp,
      ipfsUrl: `${SKATEHIVE_GATEWAY}${uploadResult.IpfsHash}`,
      ipfsUri: `ipfs://${uploadResult.IpfsHash}`,
      filename: file.name,
      fileSize: file.size,
      mediaType,
      creator,
    };

    console.log(`[IPFS Upload] Success: ${uploadResult.IpfsHash}`);
    
    return NextResponse.json(response);

  } catch (error) {
    console.error('[IPFS Upload] Error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Upload failed', 
        message: errorMessage 
      },
      { status: 500 }
    );
  }
}

/**
 * GET handler - show documentation
 */
export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/v2/ipfs/upload',
    description: 'Upload images and videos to Skatehive IPFS via Pinata',
    authentication: 'Required: API key as Bearer token',
    contentType: 'multipart/form-data',
    fields: {
      file: {
        required: true,
        type: 'File',
        description: 'Image or video file to upload',
        maxSize: '100MB',
        supportedTypes: ALL_SUPPORTED_TYPES,
      },
      creator: {
        required: false,
        type: 'string',
        description: 'Username of the uploader (defaults to API key name)',
      }
    },
    response: {
      success: 'boolean',
      ipfsHash: 'string (CID)',
      ipfsUrl: 'string (Skatehive gateway URL)',
      ipfsUri: 'string (ipfs:// URI)',
      filename: 'string',
      fileSize: 'number (bytes)',
      mediaType: 'string (image | video)',
      creator: 'string',
    },
    example: {
      curl: `curl -X POST https://api.skatehive.app/api/v2/ipfs/upload \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "file=@image.jpg" \\
  -F "creator=myusername"`,
      response: {
        success: true,
        ipfsHash: "QmYH8ZqN...",
        ipfsUrl: "https://ipfs.skatehive.app/ipfs/QmYH8ZqN...",
        ipfsUri: "ipfs://QmYH8ZqN...",
        filename: "image.jpg",
        fileSize: 245678,
        mediaType: "image",
        creator: "myusername"
      }
    },
    rateLimits: {
      perKey: '100 uploads per hour',
      perIP: '50 uploads per hour (if no key)',
    }
  });
}
