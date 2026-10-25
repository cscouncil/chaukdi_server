export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'CHECKER' | 'MODERATOR' | 'USER';
export type MessageStatus = 'SENT' | 'DELIVERED' | 'READ';
export type ChatType = 'DIRECT' | 'GROUP';
export type MediaType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOC';
export type CallType = 'AUDIO' | 'VIDEO';
export type CallStatus = 'MISSED' | 'COMPLETED' | 'DECLINED';

export interface User {
  id: string;
  phone_number: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  cover_photo_url?: string | null;
  about: string;
  category?: string;
  business_hours?: string;
  address?: string;
  website?: string;
  instagram?: string;
  facebook?: string;
  email?: string;
  upi_qr?: string;
  catalog?: string;
  role: UserRole;
  is_online: number; // 0 or 1
  last_seen: string;
  created_at: string;
}

export interface StatusItem {
  id: string;
  user_id: string;
  content: string;
  media_url: string | null;
  created_at: string;
  expires_at: string;
  user?: User;
}

export interface CallLog {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: CallType;
  status: CallStatus;
  duration_seconds: number;
  created_at: string;
  caller?: User;
  receiver?: User;
}

export interface Chat {
  id: string;
  type: ChatType;
  group_id: string | null;
  last_message_at: string;
  created_at: string;
  // Computed / joined fields
  name?: string;
  avatar_url?: string | null;
  last_message?: string | null;
  last_message_status?: MessageStatus | null;
  unread_count?: number;
  participants?: User[];
}

export interface Group {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  creator_id: string;
  created_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: 'ADMIN' | 'MEMBER';
  joined_at: string;
  user?: User;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  media_type: MediaType;
  media_url: string | null;
  status: MessageStatus;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  sender?: User;
}

export interface SendMessagePayload {
  chat_id: string;
  content: string;
  media_type?: MediaType;
  media_url?: string | null;
  temp_id?: string;
}
