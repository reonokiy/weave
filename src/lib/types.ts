export type Visibility = 'public' | 'unlisted' | 'private' | 'direct'
export interface Account {
  id: string
  username: string
  acct: string
  display_name: string
  avatar: string
  url: string
  note?: string
  locked?: boolean
  followers_count?: number
  following_count?: number
  statuses_count?: number
  emojis?: Emoji[]
  source?: { privacy?: Visibility; language?: string; status_content_type?: string; sensitive?: boolean; note?: string }
}
export interface Attachment {
  id: string
  type: string
  url: string | null
  preview_url: string | null
  description: string | null
}
export interface Status {
  id: string
  account: Account | null
  content: string
  created_at: string
  url: string | null
  visibility: Visibility
  sensitive: boolean
  spoiler_text: string
  media_attachments: Attachment[]
  reblog: Status | null
  replies_count: number
  favourites_count: number
  reblogs_count: number
  favourited?: boolean
  reblogged?: boolean
  bookmarked?: boolean
  language?: string | null
  emojis?: Emoji[]
  in_reply_to_id?: string | null
  local_only?: boolean
  mentions?: { id: string; acct: string }[]
  poll?: Poll | null
  interaction_policy?: Partial<InteractionPolicy>
  filtered?: { filter: { filter_action: string; title: string } }[]
}
export interface Instance {
  title: string
  version: string
  domain?: string
  uri?: string
  configuration?: {
    oidc_enabled?: boolean
    statuses?: { max_characters?: number; max_media_attachments?: number; characters_reserved_per_url?: number; supported_mime_types?: string[] }
    media_attachments?: { supported_mime_types?: string[]; image_size_limit?: number; video_size_limit?: number; description_limit?: number }
    polls?: { max_options?: number; max_characters_per_option?: number; min_expiration?: number; max_expiration?: number }
  }
}
export interface AppRegistration { client_id: string; client_secret: string }
export interface Session extends AppRegistration { origin: string; token: string; scopes?: string }
export interface Page<T> { items: T[]; next: string | null }
export interface ThreadContext { ancestors: Status[]; descendants: Status[] }
export interface Emoji { shortcode: string; url: string; static_url: string; visible_in_picker?: boolean }
export interface Poll { id: string; expired: boolean; multiple: boolean; voted?: boolean; own_votes?: number[]; expires_at: string | null; options: { title: string; votes_count?: number | null }[] }
export interface PolicyRules { automatic_approval: string[] | null; manual_approval: string[] | null }
export interface InteractionPolicy { can_reply: PolicyRules; can_favourite: PolicyRules; can_reblog: PolicyRules }
export interface Notification { id: string; type: string; created_at: string; account: Account; status?: Status }
export interface InteractionRequest { id: string; type: string; account: Account; status: Status; reply?: Status; accepted_at?: string; rejected_at?: string }
export interface Relationship { id: string; following: boolean; requested: boolean; followed_by: boolean; blocking: boolean; muting: boolean }
export interface SearchResults { accounts: Account[]; statuses: Status[]; hashtags: { name: string; url: string }[] }
export interface StatusSource { id: string; text: string; spoiler_text: string; content_type?: string }
export interface PostBody {
  status: string; spoiler_text: string; content_type: string; sensitive: boolean; language?: string
  visibility?: Visibility; local_only?: boolean; in_reply_to_id?: string; media_ids?: string[]
  media_attributes?: { id: string; description: string }[]
  poll?: { options: string[]; expires_in: number; multiple: boolean; hide_totals: boolean } | null
  interaction_policy?: InteractionPolicy
}
export interface ContentFilter { id: string; title: string; context: string[]; filter_action: string; keywords: { id: string; keyword: string; whole_word: boolean }[] }
