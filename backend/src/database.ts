import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { RepoData } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../data/repos.db');
const DB_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

let db: Database.Database | null = null;

export function initDb() {
    if (db) return db;
    
    db = new Database(DB_PATH);
    
    // Create repos table if it doesn't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS repos (
            url TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
    `);
    
    return db;
}

export function getRepo(url: string): { data: RepoData, authors: any[] } | null {
    const database = initDb();
    const row = database.prepare('SELECT data, timestamp FROM repos WHERE url = ?').get(url) as any;
    
    if (!row) {
        return null;
    }
    
    // Check if stale (older than 1 hour)
    const oneHour = 60 * 60 * 1000;
    if (Date.now() - row.timestamp > oneHour) {
        return null; // Consider stale
    }
    
    const parsed = JSON.parse(row.data);
    return parsed;
}

export function storeRepo(url: string, data: { repoData: RepoData, authors: any[] }) {
    const database = initDb();
    const now = Date.now();
    
    database.prepare(`
        INSERT OR REPLACE INTO repos (url, data, timestamp, created_at)
        VALUES (?, ?, ?, ?)
    `).run(url, JSON.stringify(data), now, now);
}

export function updateRepo(url: string, delta: RepoData) {
    const database = initDb();
    const row = database.prepare('SELECT data FROM repos WHERE url = ?').get(url) as any;
    
    if (!row) {
        return;
    }
    
    const existing = JSON.parse(row.data);
    const updated = {
        repoData: { ...existing.repoData, ...delta },
        authors: existing.authors // Keep authors, would need to recalculate
    };
    
    storeRepo(url, updated);
}

