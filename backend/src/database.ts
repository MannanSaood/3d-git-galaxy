import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { RepoData } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Support both PostgreSQL (via DATABASE_URL) and SQLite (fallback)
const DATABASE_URL = process.env.DATABASE_URL;
const usePostgres = !!DATABASE_URL;

let sqliteDb: any = null;
let pgClient: any = null;
let dbInitialized = false;

// SQLite implementation (for local development)
async function initSqlite() {
    if (sqliteDb) return sqliteDb;
    
    const Database = (await import('better-sqlite3')).default;
    const DB_PATH = path.join(__dirname, '../data/repos.db');
    const DB_DIR = path.dirname(DB_PATH);
    
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }
    
    sqliteDb = new Database(DB_PATH);
    sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS repos (
            url TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
    `);
    
    return sqliteDb;
}

// PostgreSQL implementation (for Koyeb database service)
async function initPostgres() {
    if (pgClient) return pgClient;
    
    const pg = await import('pg');
    const { Client } = pg;
    pgClient = new Client({
        connectionString: DATABASE_URL,
        ssl: DATABASE_URL?.includes('koyeb.app') || DATABASE_URL?.includes('amazonaws.com') || DATABASE_URL?.includes('googleapis.com') || DATABASE_URL?.includes('render.com') || DATABASE_URL?.includes('supabase.co')
            ? { rejectUnauthorized: false } 
            : false
    });
    
    await pgClient.connect();
    
    // Create repos table if it doesn't exist
    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS repos (
            url TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            timestamp BIGINT NOT NULL,
            created_at BIGINT NOT NULL
        )
    `);
    
    return pgClient;
}

export async function initDb() {
    if (dbInitialized) {
        return usePostgres ? pgClient : sqliteDb;
    }
    
    if (usePostgres) {
        await initPostgres();
    } else {
        await initSqlite();
    }
    
    dbInitialized = true;
    return usePostgres ? pgClient : sqliteDb;
}

export async function getRepo(url: string): Promise<{ data: RepoData, authors: any[] } | null> {
    await initDb();
    
    if (usePostgres && pgClient) {
        const result = await pgClient.query('SELECT data, timestamp FROM repos WHERE url = $1', [url]);
        if (result.rows.length === 0) {
            return null;
        }
        
        const row = result.rows[0];
        const oneHour = 60 * 60 * 1000;
        if (Date.now() - parseInt(row.timestamp) > oneHour) {
            return null; // Stale
        }
        
        return JSON.parse(row.data);
    } else if (sqliteDb) {
        const row = sqliteDb.prepare('SELECT data, timestamp FROM repos WHERE url = ?').get(url) as any;
        
        if (!row) {
            return null;
        }
        
        const oneHour = 60 * 60 * 1000;
        if (Date.now() - row.timestamp > oneHour) {
            return null; // Stale
        }
        
        return JSON.parse(row.data);
    }
    
    return null;
}

export async function storeRepo(url: string, data: { repoData: RepoData, authors: any[] }) {
    await initDb();
    const now = Date.now();
    
    if (usePostgres && pgClient) {
        await pgClient.query(
            `INSERT INTO repos (url, data, timestamp, created_at) 
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (url) DO UPDATE SET data = $2, timestamp = $3`,
            [url, JSON.stringify(data), now, now]
        );
    } else if (sqliteDb) {
        sqliteDb.prepare(`
            INSERT OR REPLACE INTO repos (url, data, timestamp, created_at)
            VALUES (?, ?, ?, ?)
        `).run(url, JSON.stringify(data), now, now);
    }
}

export async function updateRepo(url: string, delta: RepoData) {
    await initDb();
    
    if (usePostgres && pgClient) {
        const result = await pgClient.query('SELECT data FROM repos WHERE url = $1', [url]);
        if (result.rows.length === 0) {
            return;
        }
        
        const existing = JSON.parse(result.rows[0].data);
        const updated = {
            repoData: { ...existing.repoData, ...delta },
            authors: existing.authors
        };
        
        await storeRepo(url, updated);
    } else if (sqliteDb) {
        const row = sqliteDb.prepare('SELECT data FROM repos WHERE url = ?').get(url) as any;
        
        if (!row) {
            return;
        }
        
        const existing = JSON.parse(row.data);
        const updated = {
            repoData: { ...existing.repoData, ...delta },
            authors: existing.authors
        };
        
        await storeRepo(url, updated);
    }
}
