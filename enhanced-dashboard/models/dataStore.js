const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

// Read JSON file
async function readJSON(filename) {
  try {
    const filePath = path.join(DATA_DIR, filename);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// Write JSON file
async function writeJSON(filename, data) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Generic CRUD operations
class DataModel {
  constructor(filename) {
    this.filename = filename;
  }

  async findAll(filter = {}) {
    const data = await readJSON(this.filename);
    if (Object.keys(filter).length === 0) {
      return data;
    }
    return data.filter(item => {
      return Object.keys(filter).every(key => item[key] === filter[key]);
    });
  }

  async findById(id) {
    const data = await readJSON(this.filename);
    return data.find(item => item.id === id);
  }

  async findOne(filter) {
    const data = await readJSON(this.filename);
    return data.find(item => {
      return Object.keys(filter).every(key => item[key] === filter[key]);
    });
  }

  async create(item) {
    const data = await readJSON(this.filename);
    const newItem = {
      id: Date.now().toString(),
      ...item,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.push(newItem);
    await writeJSON(this.filename, data);
    return newItem;
  }

  async update(id, updates) {
    const data = await readJSON(this.filename);
    const index = data.findIndex(item => item.id === id);
    if (index === -1) return null;
    
    data[index] = {
      ...data[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    await writeJSON(this.filename, data);
    return data[index];
  }

  async delete(id) {
    const data = await readJSON(this.filename);
    const filtered = data.filter(item => item.id !== id);
    await writeJSON(this.filename, filtered);
    return filtered.length < data.length;
  }
}

// Model instances
const Users = new DataModel('users.json');
const UserRoles = new DataModel('user_roles.json');
const Tutors = new DataModel('tutors.json');
const TutorPresence = new DataModel('tutor_presence.json');
const Sessions = new DataModel('sessions.json');
const AIAnalyses = new DataModel('ai_analyses.json');
const HumanReviews = new DataModel('human_reviews.json');
const QualityCriteria = new DataModel('quality_criteria.json');
const AuditLogs = new DataModel('audit_logs.json');

module.exports = {
  Users,
  UserRoles,
  Tutors,
  TutorPresence,
  Sessions,
  AIAnalyses,
  HumanReviews,
  QualityCriteria,
  AuditLogs,
  readJSON,
  writeJSON
};
