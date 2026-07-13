/**
 * conversation.ts — PostgreSQL-backed conversation persistence
 *
 * Stores chat conversations and messages for multi-user support.
 * Each conversation is scoped to a userId (from JWT).
 */

import { getPool, isPgAvailable } from "../db/data-lake.js";

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  threadId: string | null;
  agentType: string | null;
  lastMessage: string | null;
  isPinned: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentType: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Schema initialization (called once at startup)
// ─────────────────────────────────────────────────────────────

let _schemaInitialized = false;

export async function initConversationSchema(): Promise<void> {
  if (_schemaInitialized) return;
  if (!isPgAvailable()) {
    console.warn("[Conversation] PostgreSQL unavailable — conversation persistence disabled.");
    return;
  }
  const pool = getPool();

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        title VARCHAR(255),
        thread_id VARCHAR(255),
        agent_type VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_thread_id ON conversations(thread_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        agent_type VARCHAR(50),
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON conversation_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON conversation_messages(created_at);
    `);
    _schemaInitialized = true;
    console.log("[Conversation] Schema initialized successfully.");

    // Migration: add columns if missing
    const migrations = [
      `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS thread_id VARCHAR(255)`,
      `CREATE INDEX IF NOT EXISTS idx_conversations_thread_id ON conversations(thread_id)`,
      `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`,
    ];
    for (const sql of migrations) {
      try {
        await pool.query(sql);
      } catch (e) {
        console.warn("[Conversation] Migration step failed:", sql.slice(0, 60), (e as Error).message);
      }
    }
  } catch (err) {
    console.error("[Conversation] Schema initialization failed:", (err as Error).message);
  }
}

// ─────────────────────────────────────────────────────────────
// CRUD Operations
// ─────────────────────────────────────────────────────────────

export async function createConversation(
  userId: string,
  title?: string,
  agentType?: string,
  threadId?: string
): Promise<Conversation> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO conversations (user_id, title, agent_type, thread_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, title || null, agentType || null, threadId || null]
  );
  return mapConversation(result.rows[0]);
}

export async function getConversations(
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<Conversation[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT c.*,
       (SELECT content FROM conversation_messages m
        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message
     FROM conversations c
     WHERE c.user_id = $1
     ORDER BY c.is_pinned DESC, c.updated_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows.map(mapConversation);
}

export async function getConversationById(
  conversationId: string,
  userId: string
): Promise<Conversation | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  return result.rows.length > 0 ? mapConversation(result.rows[0]) : null;
}

export async function updateConversationTitle(
  conversationId: string,
  userId: string,
  title: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [title, conversationId, userId]
  );
}

export async function deleteConversation(
  conversationId: string,
  userId: string
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────
// Message Operations
// ─────────────────────────────────────────────────────────────

export async function addMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  agentType?: string,
  metadata?: Record<string, unknown>
): Promise<Message> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO conversation_messages (conversation_id, role, content, agent_type, metadata)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      conversationId,
      role,
      content,
      agentType || null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  // Update conversation's updated_at timestamp
  await pool.query(
    `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );

  return mapMessage(result.rows[0]);
}

export async function getMessages(
  conversationId: string,
  userId: string,
  limit: number = 100,
  offset: number = 0
): Promise<Message[]> {
  const pool = getPool();

  // Verify user owns the conversation
  const convResult = await pool.query(
    `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  if (convResult.rows.length === 0) return [];

  const result = await pool.query(
    `SELECT * FROM conversation_messages WHERE conversation_id = $1
     ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
    [conversationId, limit, offset]
  );
  return result.rows.map(mapMessage);
}

export async function getConversationByThreadId(
  threadId: string,
  userId: string
): Promise<Conversation | null> {
  if (!isPgAvailable()) return null;
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM conversations WHERE thread_id = $1 AND user_id = $2 LIMIT 1`,
      [threadId, userId]
    );
    return result.rows.length > 0 ? mapConversation(result.rows[0]) : null;
  } catch {
    return null;
  }
}

export async function getMessageCount(conversationId: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT COUNT(*)::int as count FROM conversation_messages WHERE conversation_id = $1`,
    [conversationId]
  );
  return result.rows[0]?.count ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Pin / Unpin
// ─────────────────────────────────────────────────────────────

export async function togglePinConversation(
  conversationId: string,
  userId: string
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE conversations SET is_pinned = NOT is_pinned, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING is_pinned`,
    [conversationId, userId]
  );
  return result.rows[0]?.is_pinned ?? false;
}

// ─────────────────────────────────────────────────────────────
// Merge Conversations
// ─────────────────────────────────────────────────────────────

export async function mergeConversations(
  sourceId: string,
  targetId: string,
  userId: string
): Promise<boolean> {
  const pool = getPool();
  // Verify ownership of both
  const check = await pool.query(
    `SELECT id FROM conversations WHERE id IN ($1, $2) AND user_id = $3`,
    [sourceId, targetId, userId]
  );
  if (check.rows.length !== 2) return false;

  // Move messages from source to target
  await pool.query(
    `UPDATE conversation_messages SET conversation_id = $1 WHERE conversation_id = $2`,
    [targetId, sourceId]
  );
  // Delete source conversation
  await pool.query(`DELETE FROM conversations WHERE id = $1`, [sourceId]);
  // Update target's updated_at
  await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [targetId]);
  return true;
}

// ─────────────────────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────────────────────

export async function setConversationTags(
  conversationId: string,
  userId: string,
  tags: string[]
): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE conversations SET tags = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3 RETURNING tags`,
    [tags, conversationId, userId]
  );
  return result.rows[0]?.tags ?? [];
}

export async function addConversationTag(
  conversationId: string,
  userId: string,
  tag: string
): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE conversations SET tags = array_append(
       (SELECT tags FROM conversations WHERE id = $2 AND user_id = $3), $1
     ), updated_at = NOW()
     WHERE id = $2 AND user_id = $3 RETURNING tags`,
    [tag, conversationId, userId]
  );
  return result.rows[0]?.tags ?? [];
}

export async function removeConversationTag(
  conversationId: string,
  userId: string,
  tag: string
): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE conversations SET tags = array_remove(
       (SELECT tags FROM conversations WHERE id = $2 AND user_id = $3), $1
     ), updated_at = NOW()
     WHERE id = $2 AND user_id = $3 RETURNING tags`,
    [tag, conversationId, userId]
  );
  return result.rows[0]?.tags ?? [];
}

export async function getAllUserTags(userId: string): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT DISTINCT unnest(tags) as tag FROM conversations
     WHERE user_id = $1 AND array_length(tags, 1) > 0 ORDER BY tag`,
    [userId]
  );
  return result.rows.map(r => r.tag as string);
}

// ─────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────

export async function searchConversations(
  userId: string,
  query: string,
  limit: number = 20
): Promise<Conversation[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT DISTINCT c.* FROM conversations c
     JOIN conversation_messages m ON m.conversation_id = c.id
     WHERE c.user_id = $1 AND m.content ILIKE $2
     ORDER BY c.updated_at DESC LIMIT $3`,
    [userId, `%${query}%`, limit]
  );
  return result.rows.map(mapConversation);
}

// ─────────────────────────────────────────────────────────────
// Mapping helpers
// ─────────────────────────────────────────────────────────────

function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string | null,
    threadId: row.thread_id as string | null,
    agentType: row.agent_type as string | null,
    lastMessage: (row.last_message as string | null) ?? null,
    isPinned: (row.is_pinned as boolean) ?? false,
    tags: (row.tags as string[]) ?? [],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as "user" | "assistant" | "system",
    content: row.content as string,
    agentType: row.agent_type as string | null,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    createdAt: new Date(row.created_at as string),
  };
}
