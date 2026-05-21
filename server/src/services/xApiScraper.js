const API_ROOT = 'https://x.com/i/api';
const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

let syncAborted = false;

export function abortSync() {
  syncAborted = true;
}

const FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  payments_enabled: false,
  rweb_xchat_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

const FEATURES_PAGINATION = {
  rweb_video_screen_enabled: false,
  payments_enabled: false,
  rweb_xchat_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

const PARAMS = {
  include_profile_interstitial_type: '1',
  include_blocking: '1',
  include_blocked_by: '1',
  include_followed_by: '1',
  include_want_retweets: '1',
  include_mute_edge: '1',
  include_can_dm: '1',
  include_can_media_tag: '1',
  include_ext_is_blue_verified: '1',
  include_ext_verified_type: '1',
  include_ext_profile_image_shape: '1',
  skip_status: '1',
  cards_platform: 'Web-12',
  include_cards: '1',
  include_ext_alt_text: 'true',
  include_ext_limited_action_results: 'true',
  include_quote_count: 'true',
  include_reply_count: '1',
  tweet_mode: 'extended',
  include_ext_views: 'true',
  include_entities: 'true',
  include_user_entities: 'true',
  include_ext_media_color: 'true',
  include_ext_media_availability: 'true',
  include_ext_sensitive_media_warning: 'true',
  include_ext_trusted_friends_metadata: 'true',
  send_error_codes: 'true',
  simple_quoted_tweet: 'true',
  ext: 'mediaStats,highlightedLabel,parodyCommentaryFanLabel,voiceInfo,birdwatchPivot,superFollowMetadata,unmentionInfo,editControl,article',
};

function buildHeaders(authToken, ct0) {
  return {
    'Accept': '*/*',
    'Referer': 'https://x.com/',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${BEARER_TOKEN}`,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-csrf-token': ct0,
    'x-twitter-client-language': 'en',
    'x-twitter-active-user': 'yes',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Cookie': `auth_token=${authToken}; ct0=${ct0}`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0',
  };
}

async function apiRequest(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (!res.ok) {
        const msg = json.errors?.[0]?.message || `HTTP ${res.status}`;
        throw new Error(`X API error: ${msg}`);
      }
      return json;
    } catch (parseErr) {
      if (parseErr.message.startsWith('X API error:')) throw parseErr;
      throw new Error(`X API returned non-JSON: ${text.substring(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(endpoint, extraParams = {}) {
  const base = API_ROOT + endpoint;
  const url = new URL(base);
  const allParams = { ...PARAMS, ...extraParams };
  for (const [k, v] of Object.entries(allParams)) {
    url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return url.toString();
}

function selectBestMp4(variants) {
  const mp4Variants = (variants || [])
    .filter(item => item?.content_type === 'video/mp4' && item.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return mp4Variants[0] || null;
}

function extractTweetResult(result) {
  if (!result) return null;
  if (result.__typename === 'TweetWithVisibilityResults') {
    result = result.tweet;
  }
  if (!result) return null;

  const userResult = result.core?.user_results?.result;
  const userCore = userResult?.core;
  const userLegacy = userResult?.legacy;
  const authorName = userCore?.name || userLegacy?.name || '';
  const authorHandle = userCore?.screen_name || userLegacy?.screen_name || '';

  const legacy = result.legacy;
  if (!legacy) return null;

  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  const videoMedia = media.find(item => item.type === 'video');
  if (!videoMedia) return null;

  const bestMp4 = selectBestMp4(videoMedia.video_info?.variants);

  return {
    tweet_id: legacy.id_str,
    author_name: authorName,
    author_handle: authorHandle,
    tweet_url: `https://x.com/${authorHandle || 'i'}/status/${legacy.id_str}`,
    thumbnail_url: videoMedia.media_url_https || videoMedia.media_url || null,
    media_url: bestMp4?.url || null,
    media_type: bestMp4 ? 'mp4' : 'hls',
    file_size: null,
    download_status: 'pending',
    last_error: bestMp4 ? null : 'No mp4 variant found',
    local_file: null,
    source_created_at: legacy.created_at,
  };
}

async function getUserIdByScreenName(authToken, ct0, screenName) {
  const headers = buildHeaders(authToken, ct0);
  const features = { ...FEATURES, subscriptions_verification_info_is_identity_verified_enabled: true, subscriptions_verification_info_verified_since_enabled: true };
  const params = {
    variables: JSON.stringify({ screen_name: screenName, withGrokTranslatedBio: false }),
    features: JSON.stringify(features),
    fieldToggles: JSON.stringify({ withAuxiliaryUserLabels: true }),
  };
  const url = buildUrl('/graphql/ck5KkZ8t5cOmoLssopN99Q/UserByScreenName', params);
  console.log(`[api] resolving user ID for @${screenName}`);
  const data = await apiRequest(url, headers);
  const user = data?.data?.user?.result;
  if (!user?.rest_id) throw new Error(`无法获取用户 @${screenName} 的 ID`);
  console.log(`[api] user @${screenName} -> rest_id=${user.rest_id}`);
  return user.rest_id;
}

export { getUserIdByScreenName };

export async function verifyCookies(authToken, ct0, screenName) {
  try {
    await getUserIdByScreenName(authToken, ct0, screenName);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

export async function fetchLikedVideos(authToken, ct0, screenName, knownTweetIds = new Set(), mode = 'incremental', onProgress = null) {
  const headers = buildHeaders(authToken, ct0);
  const userId = await getUserIdByScreenName(authToken, ct0, screenName);
  const allRows = [];
  const seenIds = new Set();
  let cursor = null;
  let page = 0;
  let totalDuplicates = 0;
  let consecutiveEmptyPages = 0;
  syncAborted = false;

  const isFull = mode === 'full';
  console.log(`[api] ${isFull ? 'full' : 'incremental'} sync, ${knownTweetIds.size} known tweets in DB`);

  while (!syncAborted) {
    page += 1;
    const variables = {
      userId,
      count: 50,
      includePromotedContent: false,
      withClientEventToken: false,
      withBirdwatchNotes: false,
      withVoice: true,
    };
    if (cursor) variables.cursor = cursor;

    const params = {
      variables: JSON.stringify(variables),
      features: JSON.stringify(FEATURES_PAGINATION),
      fieldToggles: JSON.stringify({ withArticlePlainText: false }),
    };

    const endpoint = '/graphql/TGEKkJG_meudeaFcqaxM-Q/Likes';
    const url = buildUrl(endpoint, params);
    console.log(`[api] fetching likes page ${page}${cursor ? ' (cursor=' + cursor.substring(0, 30) + '...)' : ''}`);

    const data = await apiRequest(url, headers);

    const instructions = data?.data?.user?.result?.timeline?.timeline?.instructions;
    if (!instructions) {
      console.log('[api] no instructions found in response, stopping');
      break;
    }

    let entries = [];
    let nextCursor = null;

    for (const instr of instructions) {
      if (instr.type === 'TimelineAddEntries') {
        entries = instr.entries || [];
      }
    }

    let pageHasVideoTweets = 0;
    let overlapCount = 0;

    for (const entry of entries) {
      const entryId = entry.entryId || '';

      if (entryId.startsWith('tweet-')) {
        const result = entry?.content?.itemContent?.tweet_results?.result;
        const row = extractTweetResult(result);
        if (!row) continue;

        if (knownTweetIds.has(row.tweet_id)) {
          overlapCount += 1;
          continue;
        }

        if (!seenIds.has(row.tweet_id)) {
          allRows.push(row);
          seenIds.add(row.tweet_id);
          pageHasVideoTweets += 1;
        }
      } else if (entryId.startsWith('cursor-bottom-')) {
        const content = entry.content;
        nextCursor = content.value || content.itemContent?.value || null;
      }
    }

    totalDuplicates += overlapCount;

    console.log(`[api] page ${page}: ${pageHasVideoTweets} new, ${overlapCount} dupes, total new=${allRows.length}, dupes=${totalDuplicates}`);

    if (onProgress) {
      onProgress({ page, count: allRows.length, duplicates: totalDuplicates });
    }

    if (syncAborted) {
      console.log('[api] sync aborted by user');
      break;
    }

    // Incremental: stop after 3 consecutive pages with no new video tweets
    if (!isFull) {
      if (pageHasVideoTweets === 0) {
        consecutiveEmptyPages++;
      } else {
        consecutiveEmptyPages = 0;
      }
      if (consecutiveEmptyPages >= 3) {
        console.log(`[api] incremental: ${consecutiveEmptyPages} consecutive empty pages, stopping`);
        break;
      }
    }

    if (!nextCursor || nextCursor.startsWith('cursor-bottom')) {
      console.log('[api] reached end of likes list');
      break;
    }

    if (nextCursor === cursor || (page > 1 && pageHasVideoTweets === 0 && overlapCount === 0)) {
      console.log('[api] cursor unchanged or no new content, stopping');
      break;
    }

    cursor = nextCursor;
  }

  console.log(`[api] finished: ${allRows.length} new, ${totalDuplicates} duplicates`);
  return { items: allRows, duplicates: totalDuplicates };
}
