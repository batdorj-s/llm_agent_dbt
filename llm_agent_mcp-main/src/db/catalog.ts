/**
 * catalog.ts — Data lake catalog CRUD, uploaded files sync, and user auth DB operations.
 */

import { getPool, isPgAvailable, initDataLake, type DataLakeCatalogEntry } from "./pool.js";
import { hashPassword, verifyPassword } from "../auth.js";

// ── Catalog access ────────────────────────────────────────────

export function canAccessCatalogEntry(entry: Pick<DataLakeCatalogEntry, "owner_id" | "visibility">, userId: string): boolean {
  if (entry.visibility === "shared" || entry.owner_id === userId) return true;
  return false;
}

/**
 * Enhanced access check that also consults shared_resources for granular sharing.
 * Call this from routes that need the new granular sharing feature.
 */
export async function canAccessCatalogEntryEnhanced(
  entry: Pick<DataLakeCatalogEntry, "owner_id" | "visibility" | "table_name">,
  userId: string
): Promise<boolean> {
  if (entry.visibility === "shared" || entry.owner_id === userId) return true;
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT 1 FROM shared_resources
       WHERE resource_type = 'catalog' AND resource_id = $1
         AND (granted_to_user_id = $2
              OR granted_to_team_id IN (SELECT team_id FROM team_members WHERE user_id = $2))
       LIMIT 1`,
      [entry.table_name, userId]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

export async function getActiveCatalogEntry(userId: string): Promise<DataLakeCatalogEntry | null> {
  if (!isPgAvailable()) await initDataLake();
  if (!isPgAvailable()) return null;

  try {
    const uploadedResult = await getPool().query(`
      SELECT id, filename FROM uploaded_files WHERE type = 'dataset'
        AND (visibility = 'shared' OR owner_id = $1)
      ORDER BY created_at DESC LIMIT 1
    `, [userId]);
    const uploadedDataset = uploadedResult.rows[0] as { id?: string; filename?: string } | undefined;

    if (uploadedDataset?.id) {
      const tableName = uploadedDataset.id;
      const activeResult = await getPool().query(`
        SELECT * FROM data_lake_catalog WHERE table_name = $1
          AND (visibility = 'shared' OR owner_id = $2)
        ORDER BY created_at DESC, id DESC LIMIT 1
      `, [tableName, userId]);
      if (activeResult.rows[0]) return activeResult.rows[0] as DataLakeCatalogEntry;

      const allEntries = await getCatalog(userId);
      const match = allEntries.find(r => r.table_name.toLowerCase() === tableName.toLowerCase());
      if (match) return match;

      console.warn(`[Data Lake] Uploaded table '${tableName}' not found in catalog.`);
    }

    const catalog = await getCatalog(userId);
    if (catalog.length === 0) return null;

    return null;
  } catch {
    return null;
  }
}

export async function getCatalog(userId: string): Promise<DataLakeCatalogEntry[]> {
  await initDataLake();
  if (!isPgAvailable()) return [];
  try {
    const result = await getPool().query(
      `SELECT * FROM data_lake_catalog
       WHERE visibility = 'shared' OR owner_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1000`,
      [userId]
    );
    return result.rows as DataLakeCatalogEntry[];
  } catch {
    return [];
  }
}

export async function ensureUploadedFilesSynced(): Promise<void> {
  if (!isPgAvailable()) return;
  try {
    await getPool().query(`
      INSERT INTO uploaded_files (id, filename, type, description, semantic_groups, generated_at, owner_id, visibility)
      SELECT table_name, table_name, 'dataset', description, '{}'::jsonb, created_at, owner_id, visibility
      FROM data_lake_catalog
      WHERE owner_id IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    `);
    await getPool().query(`
      UPDATE uploaded_files uf
      SET owner_id = dlc.owner_id, visibility = dlc.visibility
      FROM data_lake_catalog dlc
      WHERE uf.id = dlc.table_name AND uf.type = 'dataset' AND dlc.owner_id IS NOT NULL
    `);
    await getPool().query(`
      DELETE FROM uploaded_files WHERE type = 'dataset' AND owner_id IS NULL
    `);
  } catch (err) {
    console.warn("[Data Lake] ensureUploadedFilesSynced failed:", (err as Error).message);
  }
}

// ── User authentication ───────────────────────────────────────

export async function authenticateUser(email: string, password: string): Promise<{ id: string; email: string; name: string; role: "viewer" | "analyst" | "admin" } | null> {
  await initDataLake();
  if (!isPgAvailable()) return null;
  const result = await getPool().query("SELECT id, email, name, password_hash, role FROM users WHERE email = $1", [email]);
  if (result.rows.length === 0) return null;
  const user = result.rows[0];
  if (!verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function createUser(email: string, password: string, name: string, role: "viewer" | "analyst" | "admin" = "viewer"): Promise<string | null> {
  await initDataLake();
  if (!isPgAvailable()) return null;
  const id = `user_${Date.now()}`;
  const hashedPwd = hashPassword(password);
  try {
    await getPool().query(
      `INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, email, name, hashedPwd, role]
    );
    return id;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === "23505") return null;
    throw err;
  }
}
