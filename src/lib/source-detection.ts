export const SOURCE_TYPES = {
  TWITTER_HANDLE: "twitter_handle",
  YOUTUBE_CHANNEL: "youtube_channel",
  RSS: "rss",
  GITHUB_REPOSITORY: "github_repository",
  TWEET: "tweet",
  WEB_PAGE: "web_page",
  DOCUMENT: "document",
  LINK: "link",
} as const

export type SourceType = (typeof SOURCE_TYPES)[keyof typeof SOURCE_TYPES]

const twitterHandlePattern =
  /\b(?:twitter\.com|x\.com)\/(?:@)?([\w_]+)(?:$|\?[^/]*$)/
const youtubeRegex =
  /(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]+)/
const youtubeLiveRegex =
  /(https?:\/\/)?(www\.)?youtube\.com\/live\/([A-Za-z0-9_-]+)/
const youtubeShortRegex =
  /(https?:\/\/)?(www\.)?youtu\.be\/([A-Za-z0-9_-]+)/
const twitterSpaceRegex =
  /https:\/\/twitter\.com\/i\/spaces\/([A-Za-z0-9_-]+)/
const twitterBroadcastRegex =
  /https:\/\/twitter\.com\/i\/broadcasts\/([A-Za-z0-9_-]+)/
const tweetUrlRegex =
  /https:\/\/(twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/
const mp3Regex = /(https?:\/\/)?([A-Za-z0-9_-]+)\.mp3/
const rssRegex =
  /(https?:\/\/)?(.*\.)?.+\/(feed|rss|rss.xml|.*.rss|.*\?(feed|format)=rss)$/
const youtubeChannelPattern =
  /https?:\/\/(www\.)?youtube\.com\/(user\/)?(@)?([\w-]+)/
const githubRepoPattern = /https:\/\/github\.com\/[\w-]+\/[\w-]+/
const genericUrlRegex = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/

async function checkIfRSS(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" })
    const contentType = response.headers.get("Content-Type")
    return contentType?.includes("application/rss+xml") ?? false
  } catch {
    return false
  }
}

export async function detectSourceType(source: string): Promise<SourceType> {
  const linkPatterns = [
    youtubeLiveRegex,
    twitterBroadcastRegex,
    youtubeRegex,
    youtubeShortRegex,
    twitterSpaceRegex,
    mp3Regex,
  ]

  if (linkPatterns.some((p) => p.test(source))) return SOURCE_TYPES.LINK
  if (youtubeChannelPattern.test(source)) return SOURCE_TYPES.YOUTUBE_CHANNEL
  if (tweetUrlRegex.test(source)) return SOURCE_TYPES.TWEET
  if (twitterHandlePattern.test(source)) return SOURCE_TYPES.TWITTER_HANDLE
  if (rssRegex.test(source)) return SOURCE_TYPES.RSS
  if (githubRepoPattern.test(source)) return SOURCE_TYPES.GITHUB_REPOSITORY

  if (genericUrlRegex.test(source)) {
    const isRSS = await checkIfRSS(source)
    return isRSS ? SOURCE_TYPES.RSS : SOURCE_TYPES.WEB_PAGE
  }

  return SOURCE_TYPES.DOCUMENT
}

export function extractNameFromSource(source: string, type: SourceType): string {
  if (type === SOURCE_TYPES.TWITTER_HANDLE) {
    const match = twitterHandlePattern.exec(source)
    return match ? `@${match[1]}` : source
  }
  return source
}

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  [SOURCE_TYPES.TWITTER_HANDLE]: "Twitter Handle",
  [SOURCE_TYPES.YOUTUBE_CHANNEL]: "YouTube Channel",
  [SOURCE_TYPES.RSS]: "RSS Feed",
  [SOURCE_TYPES.GITHUB_REPOSITORY]: "GitHub Repo",
  [SOURCE_TYPES.TWEET]: "Tweet",
  [SOURCE_TYPES.WEB_PAGE]: "Web Page",
  [SOURCE_TYPES.DOCUMENT]: "Document",
  [SOURCE_TYPES.LINK]: "Link",
}

const SUBSCRIPTION_TYPES: string[] = [
  SOURCE_TYPES.TWITTER_HANDLE,
  SOURCE_TYPES.YOUTUBE_CHANNEL,
  SOURCE_TYPES.RSS,
  SOURCE_TYPES.GITHUB_REPOSITORY,
]

export function isSubscriptionSource(type: string): boolean {
  return SUBSCRIPTION_TYPES.includes(type)
}
