import { initDb } from './database.js';

console.log('Initializing database schema...');

try {
    const db = initDb();
    console.log('Database initialized successfully!');
    console.log('Schema created/verified.');
    
    // Verify the table exists
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repos'").get();
    if (tables) {
        console.log('✓ repos table exists');
    } else {
        console.log('✗ repos table not found');
    }
    
    process.exit(0);
} catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
}

