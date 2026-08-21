const fs = require('fs');
const path = require('path');
const Databse = require('better-sqlite3');

const databasePath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'challenge.db');

const databaseDictory = path.dirname(databasePath);

if (!fs.existsSync(databaseDictory)) {
    fs.mkdirSync(databaseDictory, { recursive: true });
}

const db = new Databse(databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeDatabase() {
    const initFile = path.join(__dirname, "init.sql");

    const schema = fs.readFileSync(initFile, 'utf-8');
    db.exec(schema);
    console.log('Database initialized successfully.');
}
initializeDatabase();

module.exports = db;