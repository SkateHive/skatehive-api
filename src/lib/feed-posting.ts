import { PrivateKey } from '@hiveio/dhive';
import { HiveClient } from '@/lib/hive-client';

export const COMMUNITY_TAG = 'hive-173115';
export const THREAD_AUTHOR = process.env.NEXT_PUBLIC_SKATEHIVE_THREAD_AUTHOR || 'peak.snaps';
export const THREAD_PERMLINK = process.env.NEXT_PUBLIC_SKATEHIVE_THREAD_PERMLINK || 'snaps';

export type PostingAlias = 'skateuser' | 'skatedev' | 'skatehacker';

export interface FeedPostInput {
  body: string;
  images?: string[];
  videoUrl?: string;
  parentAuthor?: string;
  parentPermlink?: string;
  extraTags?: string[];
  appLabel?: string;
}

export interface FeedPostResult {
  author: string;
  permlink: string;
  parentAuthor: string;
  parentPermlink: string;
  txId: string;
}

export function extractHashtags(text: string): string[] {
  const hashtagRegex = /#(\w+)/g;
  const matches = text.match(hashtagRegex) || [];
  return matches.map((hashtag) => hashtag.slice(1));
}

export async function getLatestSnapContainer(): Promise<string> {
  try {
    const beforeDate = new Date().toISOString().split('.')[0];
    const permlink = '';
    const limit = 1;

    const result = await HiveClient.database.call('get_discussions_by_author_before_date', [
      THREAD_AUTHOR,
      permlink,
      beforeDate,
      limit,
    ]);

    if (result && result.length > 0 && result[0].permlink) {
      return result[0].permlink;
    }

    return THREAD_PERMLINK;
  } catch {
    return THREAD_PERMLINK;
  }
}

export function resolvePostingAccount(alias: PostingAlias): { author: string; postingKey: string } {
  const map: Record<PostingAlias, { authorEnv?: string; keyEnv?: string; fallbackAuthor: string }> = {
    skateuser: {
      authorEnv: process.env.SKATEUSER_POSTING_ACCOUNT,
      keyEnv: process.env.SKATEUSER_POSTING_KEY,
      fallbackAuthor: 'skateuser',
    },
    skatedev: {
      authorEnv: process.env.SKATEDEV_POSTING_ACCOUNT,
      keyEnv: process.env.SKATEDEV_POSTING_KEY,
      fallbackAuthor: 'skatedev',
    },
    skatehacker: {
      authorEnv: process.env.SKATEHACKER_POSTING_ACCOUNT,
      keyEnv: process.env.SKATEHACKER_POSTING_KEY,
      fallbackAuthor: 'skatehacker',
    },
  };

  const selected = map[alias];
  const author = selected.authorEnv || selected.fallbackAuthor;
  const postingKey = selected.keyEnv || '';

  if (!postingKey) {
    throw new Error(`Posting key missing for alias: ${alias}`);
  }

  return { author, postingKey };
}

export async function postFeedAsAlias(alias: PostingAlias, input: FeedPostInput): Promise<FeedPostResult> {
  const { author, postingKey } = resolvePostingAccount(alias);

  const parentAuthor = input.parentAuthor || THREAD_AUTHOR;
  const parentPermlink = input.parentPermlink || (await getLatestSnapContainer());

  const permlink = crypto.randomUUID();
  const hashtags = extractHashtags(input.body);
  const tags = [COMMUNITY_TAG, parentPermlink, ...(input.extraTags || []), ...hashtags];

  const metadata: Record<string, any> = {
    app: input.appLabel || `Skatehive API (${alias})`,
    tags,
  };

  if (input.images?.length) {
    metadata.images = input.images;
  }

  if (input.videoUrl) {
    metadata.video = { url: input.videoUrl };
  }

  let finalBody = input.body;
  if (input.images?.length) {
    finalBody += input.images.map((url) => `\n![](${url})`).join('');
  }
  if (input.videoUrl) {
    finalBody += `\n${input.videoUrl}\n`;
  }

  const commentOp: any = [
    'comment',
    {
      parent_author: parentAuthor,
      parent_permlink: parentPermlink,
      author,
      permlink,
      title: '',
      body: finalBody,
      json_metadata: JSON.stringify(metadata),
    },
  ];

  const privateKey = PrivateKey.fromString(postingKey);
  const result = await HiveClient.broadcast.sendOperations([commentOp], privateKey);

  return {
    author,
    permlink,
    parentAuthor,
    parentPermlink,
    txId: result.id,
  };
}
