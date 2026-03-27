#!/usr/bin/env node
/**
 * Backfill thumbnails for existing Pinata videos.
 *
 * For each mp4 pin that has no thumbnailUrl:
 *   1. Download the video from IPFS gateway
 *   2. Detect orientation with ffprobe (vertical / horizontal / square)
 *   3. Generate a JPEG thumbnail with FFmpeg
 *   4. Upload thumbnail to Pinata
 *   5. Update the video pin's metadata with thumbnailUrl + orientation
 *
 * Usage:
 *   node scripts/backfill-thumbnails.mjs              # process all
 *   node scripts/backfill-thumbnails.mjs --limit 5    # process first 5
 *   node scripts/backfill-thumbnails.mjs --dry-run    # just list, no changes
 *
 * Requires: PINATA_API_KEY, PINATA_SECRET_API_KEY, PINATA_JWT in .env.local
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
import { randomUUID } from 'crypto';

// ── Config ───────────────────────────────────────────────────────────────────

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_API_KEY = process.env.PINATA_SECRET_API_KEY;
const PINATA_JWT = process.env.PINATA_JWT;
const IPFS_GATEWAY = process.env.PINATA_GATEWAY || 'https://ipfs.skatehive.app/ipfs';

if (!PINATA_API_KEY || !PINATA_SECRET_API_KEY) {
  console.error('❌ Missing PINATA_API_KEY or PINATA_SECRET_API_KEY in environment');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// ── Pinata helpers ───────────────────────────────────────────────────────────

const pinataHeaders = {
  pinata_api_key: PINATA_API_KEY,
  pinata_secret_api_key: PINATA_SECRET_API_KEY,
};

const pinataJwtHeaders = PINATA_JWT
  ? { Authorization: `Bearer ${PINATA_JWT}` }
  : pinataHeaders;

async function listVideosPaginated() {
  const allRows = [];
  let pageOffset = 0;
  const pageLimit = 100;

  while (true) {
    const url = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=${pageLimit}&pageOffset=${pageOffset}&sortBy=date_pinned&sortOrder=DESC`;
    const res = await fetch(url, { headers: pinataHeaders });
    if (!res.ok) throw new Error(`Pinata pinList failed: ${res.status}`);

    const data = await res.json();
    const rows = data.rows || [];
    allRows.push(...rows);

    if (rows.length < pageLimit) break;
    pageOffset += pageLimit;
  }

  return allRows;
}

async function updatePinMetadata(hash, metadata) {
  const res = await fetch('https://api.pinata.cloud/pinning/hashMetadata', {
    method: 'PUT',
    headers: {
      ...pinataHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ipfsPinHash: hash,
      keyvalues: metadata,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`hashMetadata failed (${res.status}): ${text}`);
  }
}

async function uploadThumbnail(thumbPath, creator, hash) {
  const FormData = (await import('form-data')).default;
  const https = await import('https');
  const form = new FormData();
  form.append('file', fs.createReadStream(thumbPath), {
    filename: `${creator}-thumb-${hash.slice(0, 8)}.jpg`,
    contentType: 'image/jpeg',
  });

  const metadata = {
    name: `${creator}-thumbnail.jpg`,
    keyvalues: {
      creator,
      source: 'backfill-script',
      fileType: 'thumbnail',
      parentVideoHash: hash,
      uploadDate: new Date().toISOString(),
    },
  };
  form.append('pinataMetadata', JSON.stringify(metadata));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  // Use form-data's native submit via https (fetch doesn't handle form-data streams correctly)
  const result = await new Promise((resolve, reject) => {
    const authHeader = PINATA_JWT
      ? { Authorization: `Bearer ${PINATA_JWT}` }
      : { pinata_api_key: PINATA_API_KEY, pinata_secret_api_key: PINATA_SECRET_API_KEY };

    form.submit(
      {
        protocol: 'https:',
        host: 'api.pinata.cloud',
        path: '/pinning/pinFileToIPFS',
        method: 'POST',
        headers: authHeader,
      },
      (err, res) => {
        if (err) return reject(err);
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`Thumbnail upload failed (${res.statusCode}): ${body}`));
          }
        });
      }
    );
  });

  return `${IPFS_GATEWAY.replace(/\/+$/, '')}/${result.IpfsHash}`;
}

// ── FFmpeg / ffprobe helpers ─────────────────────────────────────────────────

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

async function getVideoInfo(videoPath) {
  const output = await runCommand('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    videoPath,
  ]);

  const info = JSON.parse(output);
  const videoStream = info.streams?.find((s) => s.codec_type === 'video');
  if (!videoStream) return null;

  const width = parseInt(videoStream.width);
  const height = parseInt(videoStream.height);
  const duration = parseFloat(info.format?.duration || '0');

  // Detect rotation from side_data or display matrix
  let rotation = 0;
  if (videoStream.side_data_list) {
    const rotData = videoStream.side_data_list.find((d) => d.rotation !== undefined);
    if (rotData) rotation = Math.abs(rotData.rotation);
  }
  if (videoStream.tags?.rotate) {
    rotation = Math.abs(parseInt(videoStream.tags.rotate));
  }

  // After rotation, effective dimensions may swap
  const isRotated = rotation === 90 || rotation === 270;
  const effectiveWidth = isRotated ? height : width;
  const effectiveHeight = isRotated ? width : height;

  let orientation;
  if (effectiveWidth > effectiveHeight) orientation = 'horizontal';
  else if (effectiveHeight > effectiveWidth) orientation = 'vertical';
  else orientation = 'square';

  return { width: effectiveWidth, height: effectiveHeight, duration, orientation };
}

async function generateThumbnail(videoPath, duration) {
  const thumbPath = path.join(os.tmpdir(), `thumb-${randomUUID()}.jpg`);
  const captureTime = Math.min(Math.max((duration || 2) * 0.1, 0.5), 5);

  await runCommand('ffmpeg', [
    '-y',
    '-ss', String(captureTime),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', 'scale=min(iw\\,640):min(ih\\,640):force_original_aspect_ratio=decrease',
    '-q:v', '4',
    thumbPath,
  ]);

  if (!fs.existsSync(thumbPath)) throw new Error('Thumbnail not created');
  return thumbPath;
}

async function downloadVideo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
  }

  fileStream.end();
  await new Promise((resolve) => fileStream.on('finish', resolve));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('📋 Listing all Pinata pins...');
  const allPins = await listVideosPaginated();
  console.log(`   Found ${allPins.length} total pins`);

  // Filter: mp4 files without thumbnailUrl
  const videosNeedingThumbs = allPins.filter((pin) => {
    const meta = pin.metadata;
    if (!meta || !meta.name) return false;
    if (!meta.name.endsWith('.mp4')) return false;
    const kv = meta.keyvalues || {};
    return !kv.thumbnailUrl;
  });

  console.log(`🎬 ${videosNeedingThumbs.length} videos need thumbnails`);

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN — would process:');
    videosNeedingThumbs.slice(0, LIMIT).forEach((pin) => {
      const kv = pin.metadata?.keyvalues || {};
      console.log(`   ${pin.ipfs_pin_hash} — ${kv.creator || '?'} — ${pin.metadata.name}`);
    });
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const pin of videosNeedingThumbs) {
    if (processed >= LIMIT) break;
    processed++;

    const hash = pin.ipfs_pin_hash;
    const kv = pin.metadata?.keyvalues || {};
    const creator = kv.creator || 'unknown';
    const videoUrl = `${IPFS_GATEWAY.replace(/\/+$/, '')}/${hash}`;
    const tmpVideo = path.join(os.tmpdir(), `dl-${hash.slice(0, 12)}.mp4`);

    console.log(`\n[${processed}/${Math.min(videosNeedingThumbs.length, LIMIT)}] ${creator} — ${hash.slice(0, 20)}...`);

    try {
      // 1. Download video
      process.stdout.write('   ⬇️  Downloading... ');
      await downloadVideo(videoUrl, tmpVideo);
      const sizeMB = (fs.statSync(tmpVideo).size / (1024 * 1024)).toFixed(1);
      console.log(`${sizeMB}MB`);

      // 2. Get video info (orientation, duration)
      process.stdout.write('   🔍 Analyzing... ');
      const info = await getVideoInfo(tmpVideo);
      if (!info) throw new Error('Could not read video streams');
      console.log(`${info.width}x${info.height} ${info.orientation} (${info.duration.toFixed(1)}s)`);

      // 3. Generate thumbnail
      process.stdout.write('   🖼️  Generating thumbnail... ');
      const thumbPath = await generateThumbnail(tmpVideo, info.duration);
      const thumbSize = (fs.statSync(thumbPath).size / 1024).toFixed(0);
      console.log(`${thumbSize}KB`);

      // 4. Upload thumbnail to Pinata
      process.stdout.write('   ⬆️  Uploading thumbnail... ');
      const thumbUrl = await uploadThumbnail(thumbPath, creator, hash);
      console.log('done');

      // 5. Update video pin metadata
      process.stdout.write('   📝 Updating metadata... ');
      await updatePinMetadata(hash, {
        thumbnailUrl: thumbUrl,
        orientation: info.orientation,
        videoWidth: String(info.width),
        videoHeight: String(info.height),
      });
      console.log('done');

      console.log(`   ✅ ${thumbUrl}`);
      succeeded++;

      // Cleanup
      try { fs.unlinkSync(thumbPath); } catch {}
    } catch (err) {
      console.log(`   ❌ Failed: ${err.message}`);
      failed++;
    } finally {
      try { fs.unlinkSync(tmpVideo); } catch {}
    }

    // Small delay to be nice to Pinata API
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n🏁 Done! ${succeeded} succeeded, ${failed} failed, ${videosNeedingThumbs.length - processed} remaining`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
