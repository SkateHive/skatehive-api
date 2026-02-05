import { NextRequest, NextResponse } from 'next/server';
import { CommentOperation, PrivateKey } from '@hiveio/dhive';
import { HiveClient } from '@/lib/hive-client';
import { HAFSQL_Database } from '@/lib/hafsql_database';

const DEBUG = true;
const db = new HAFSQL_Database();

function new_permlink() {
  return new Date().toISOString().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export async function POST(request: NextRequest) {
  if (DEBUG) console.log('Received POST request');

  const postingKey = request.headers.get('Authorization')?.replace("Bearer ", "");
  if (!postingKey) return NextResponse.json({ error: 'Missing posting key in headers' }, { status: 400 });

  const pinataApiKey = process.env.PINATA_API_KEY;
  const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;
  const pinataUrl = process.env.PINATA_API_URL;
  const ipfsHashes: string[] = [];

  if (!pinataApiKey || !pinataSecretApiKey) {
    if (DEBUG) console.error('Pinata API keys are missing');
    return NextResponse.json({ error: 'Pinata API keys are missing' }, { status: 500 });
  }

  if (!pinataUrl) {
    if (DEBUG) console.error('Pinata API URL is missing');
    return NextResponse.json({ error: 'Pinata API URL is missing' }, { status: 500 });
  }

  try {
    const contentType = request.headers.get('content-type') || '';
    let data: any;
    if (contentType.includes('multipart/form-data')) {
      if (DEBUG) console.log('Detected multipart/form-data upload');
      const form = await request.formData();
      const file = form.get('file') || form.get('image') || form.get('photo') || null;
      if (!file) {
        if (DEBUG) console.error('Multipart upload missing file field');
        return NextResponse.json({ error: 'Missing file field in multipart/form-data' }, { status: 400 });
      }
      const arrayBuffer = await (file as any).arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const b64 = Buffer.from(bytes).toString('base64');
      data = {
        author: form.get('author') || undefined,
        body: form.get('body') || '',
        media: {
          name: (file as any).name || 'upload.jpg',
          type: (file as any).type || 'image/jpeg',
          data: b64
        }
      };
      if (DEBUG) {
        console.log('Multipart parsed:', { mediaName: data.media.name, mediaType: data.media.type, size: bytes.length });
        console.log('upload: content-type=', contentType, 'content-length=', request.headers.get('content-length'));
        try { console.log('multipart keys:', Array.from((await request.formData()).keys())); } catch(e){/* ignore */}
      }
    } else {
      data = await request.json();
      if (DEBUG) console.log('JSON data received:', Object.keys(data));
    }

    const { author, body, media } = data;

    if (!author) return NextResponse.json({ error: 'Missing author' }, { status: 400 });
    if (!body && !media) return NextResponse.json({ error: 'Missing body' }, { status: 400 });

    if (media) {
      if (DEBUG) console.log('Processing media:', media.name, media.type);

      const formData = new FormData();
      const binaryString = atob(media.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: media.type });
      
      formData.append('file', blob, media.name);

      const pinataResponse = await fetch(pinataUrl, {
        method: 'POST',
        headers: {
          'pinata_api_key': pinataApiKey,
          'pinata_secret_api_key': pinataSecretApiKey,
        },
        body: formData,
      });

      if (!pinataResponse.ok) {
        const errorText = await pinataResponse.text();
        console.error('Pinata upload error:', errorText);
        return NextResponse.json({ error: 'Failed to upload to Pinata', details: errorText }, { status: pinataResponse.status });
      }

      const pinataResult = await pinataResponse.json();
      ipfsHashes.push(pinataResult.IpfsHash);
      
      if (DEBUG) console.log('Media uploaded to IPFS:', pinataResult.IpfsHash);
    }

    const isVideo = media?.type.startsWith('video/');
    const mediaType = isVideo ? 'video' : 'image';
    const ipfsProviderUrl = 'https://gateway.pinata.cloud/ipfs/';
    let mediaContent = '';

    // Handle media embedding based on type
    ipfsHashes.forEach((hash) => {
      const mediaUrl = `${ipfsProviderUrl}${hash}`;
      if (isVideo) {
        mediaContent += `\n<iframe src="${mediaUrl}" frameborder="0" allowfullscreen></iframe>`;
      } else {
        mediaContent += `\n![](${mediaUrl})`;
      }
    });

    const {rows: snapContainerRow} = await db.executeQuery(`
      SELECT permlink
      FROM comments
      WHERE author = 'peak.snaps'
      ORDER BY created DESC
      LIMIT 1
    `);

    if (DEBUG) console.log('Latest snap container:', snapContainerRow);

    const commentOp: CommentOperation[1] = {
      parent_author: 'peak.snaps',
      parent_permlink: snapContainerRow[0].permlink,
      author,
      permlink: new_permlink(),
      title: "",
      body: body + mediaContent,
      json_metadata: JSON.stringify({
        app: "skatehiveapp/alpha",
        [mediaType]: ipfsHashes.map(hash => `${ipfsProviderUrl}${hash}`),
        tags: ["snaps", "hive-173115", "skatehive", "skate"],
      }, null, 2)
    };

    if (DEBUG) console.log('Posting to Hive:', commentOp);

    const key = PrivateKey.from(postingKey);
    const result = await HiveClient.broadcast.comment(commentOp, key);
    
    if (DEBUG) console.log('Hive broadcast result:', result);

    return NextResponse.json({
      success: true,
      message: 'Upload and Post successful',
      ipfsHashes,
      hiveData: {
        body: commentOp.body,
        author: commentOp.author,
        permlink: commentOp.permlink,
        transaction: result
      }
    }, { status: 200 });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}