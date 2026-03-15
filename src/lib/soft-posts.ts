import { supabase } from '@/app/utils/supabase/supabaseClient';
import { Comment } from '@/app/api/v2/feed/helpers';

export function extractSafeUser(metadata: any): string | null {
  try {
    const parsed = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.skatehive_user === 'string') return parsed.skatehive_user;
      if (typeof parsed.safe_user === 'string') return parsed.safe_user;
      
      const onchain = parsed.onchain;
      if (onchain && typeof onchain === 'object') {
        if (typeof onchain.skatehive_user === 'string') return onchain.skatehive_user;
        if (typeof onchain.safe_user === 'string') return onchain.safe_user;
      }
    }
  } catch (e) {
    // Silently fail if metadata is not valid JSON
  }
  return null;
}

export async function dealiasSoftPosts(posts: Comment[]): Promise<Comment[]> {
  if (!supabase) return posts;

  const softPostCandidates = posts.filter(p => p.author === 'skateuser');
  
  if (softPostCandidates.length === 0) return posts;

  const batch = softPostCandidates.map(p => ({
    author: p.author,
    permlink: p.permlink,
    safe_user: extractSafeUser(p.post_json_metadata)
  })).filter(b => b.safe_user);

  if (batch.length === 0) return posts;

  const safeUserHashes = Array.from(new Set(batch.map(b => b.safe_user as string)));

  try {
    const { data: softPostsData, error: softPostsError } = await supabase
      .from('userbase_soft_posts')
      .select('safe_user, userbase_users(display_name, handle, avatar_url)')
      .in('safe_user', safeUserHashes);

    if (softPostsError) throw softPostsError;

    const overlayMap = new Map<string, any>();
    softPostsData?.forEach((item: any) => {
      overlayMap.set(item.safe_user, item.userbase_users);
    });

    return posts.map(post => {
      if (post.author === 'skateuser') {
        const safeUser = extractSafeUser(post.post_json_metadata);
        if (safeUser && overlayMap.has(safeUser)) {
          const user = overlayMap.get(safeUser);
          return {
            ...post,
            is_soft_post: true,
            soft_post_author: user.handle || post.author,
            soft_post_display_name: user.display_name,
            soft_post_avatar: user.avatar_url
          };
        }
      }
      return post;
    });
  } catch (error) {
    console.error('Error de-aliasing soft posts:', error);
    return posts;
  }
}
