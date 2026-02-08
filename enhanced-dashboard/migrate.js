const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');

// Paths
const OLD_DASHBOARD_DATA = path.join(__dirname, '../ischool-dashboard/data/sessions.json');
const BACKEND_DATA_DIR = path.join(__dirname, '../backend-server-code/data');
const NEW_DATA_DIR = path.join(__dirname, 'data');

async function ensureDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function readJSON(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.log(`Could not read ${filePath}:`, error.message);
    return [];
  }
}

async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function migrate() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  iSchool Dashboard Data Migration');
  console.log('═══════════════════════════════════════════════════════\n');

  await ensureDir(NEW_DATA_DIR);

  // Load old dashboard data
  console.log('📂 Loading data from old dashboard...');
  const oldSessions = await readJSON(OLD_DASHBOARD_DATA);
  const backendSessions = await readJSON(path.join(BACKEND_DATA_DIR, 'sessions.json'));
  const backendTutors = await readJSON(path.join(BACKEND_DATA_DIR, 'tutors.json'));
  const backendReviews = await readJSON(path.join(BACKEND_DATA_DIR, 'reviews.json'));

  console.log(`   Found ${oldSessions.length} sessions in old dashboard`);
  console.log(`   Found ${backendSessions.length} sessions in backend`);
  console.log(`   Found ${backendTutors.length} tutors in backend`);
  console.log(`   Found ${backendReviews.length} reviews in backend\n`);

  // Create admin user
  console.log('👤 Creating admin user...');
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const adminId = '1770000000001';
  
  const users = [{
    id: adminId,
    email: 'admin@ischool.com',
    password_hash: adminPasswordHash,
    full_name: 'Admin User',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, {
    id: '1770000000002',
    email: 'reviewer@ischool.com',
    password_hash: await bcrypt.hash('reviewer123', 10),
    full_name: 'Quality Reviewer',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, {
    id: '1770000000003',
    email: 'manager@ischool.com',
    password_hash: await bcrypt.hash('manager123', 10),
    full_name: 'Quality Manager',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }];

  const userRoles = [
    { id: Date.now().toString(), user_id: adminId, app_role: 'admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: (Date.now() + 1).toString(), user_id: '1770000000002', app_role: 'reviewer', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: (Date.now() + 2).toString(), user_id: '1770000000003', app_role: 'manager', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  ];

  await writeJSON(path.join(NEW_DATA_DIR, 'users.json'), users);
  await writeJSON(path.join(NEW_DATA_DIR, 'user_roles.json'), userRoles);
  console.log(`   ✅ Created ${users.length} users with roles\n`);

  // Migrate tutors
  console.log('👨‍🏫 Migrating tutors...');
  const tutors = backendTutors.map(t => ({
    id: t.id,
    tutor_code: t.tutor_id,
    full_name: t.full_name,
    email: t.email,
    phone: t.phone,
    hire_date: t.hire_date,
    status: t.status,
    created_at: t.created_at || new Date().toISOString(),
    updated_at: t.updated_at || new Date().toISOString()
  }));
  
  await writeJSON(path.join(NEW_DATA_DIR, 'tutors.json'), tutors);
  console.log(`   ✅ Migrated ${tutors.length} tutors\n`);

  // Migrate sessions
  console.log('📹 Migrating sessions...');
  const sessions = backendSessions.map(s => ({
    id: s.id,
    tutor_id: tutors.find(t => t.tutor_code === s.tutor_id)?.id || s.tutor_id,
    session_date: s.date,
    time_slot: s.time_slot,
    video_url: s.video_url || null,
    transcript_url: s.transcript_url || null,
    session_type: 'mobile',
    subject: null,
    course: null,
    status: s.status,
    ai_score: s.aiScore,
    human_score: s.humanScore,
    assigned_reviewer: null,
    created_at: s.created_at || new Date().toISOString(),
    updated_at: s.updated_at || new Date().toISOString()
  }));

  await writeJSON(path.join(NEW_DATA_DIR, 'sessions.json'), sessions);
  console.log(`   ✅ Migrated ${sessions.length} sessions\n`);

  // Migrate AI analyses
  console.log('🤖 Migrating AI analyses...');
  const aiAnalyses = backendReviews
    .filter(r => r.review_type === 'ai')
    .map(r => ({
      id: r.id,
      session_id: r.session_id,
      overall_score: r.overall_score,
      scores: r.scores,
      confidence_score: 0.85,
      analysis_date: r.created_at,
      criteria_scores: r.scores,
      created_at: r.created_at,
      updated_at: r.updated_at
    }));

  await writeJSON(path.join(NEW_DATA_DIR, 'ai_analyses.json'), aiAnalyses);
  console.log(`   ✅ Migrated ${aiAnalyses.length} AI analyses\n`);

  // Migrate human reviews
  console.log('👥 Migrating human reviews...');
  const humanReviews = backendReviews
    .filter(r => r.review_type === 'human')
    .map(r => ({
      id: r.id,
      session_id: r.session_id,
      reviewer_id: adminId,
      review_type: 'human',
      overall_score: r.overall_score,
      scores: r.scores,
      comments: null,
      quality_notes: null,
      review_date: r.created_at,
      created_at: r.created_at,
      updated_at: r.updated_at
    }));

  await writeJSON(path.join(NEW_DATA_DIR, 'human_reviews.json'), humanReviews);
  console.log(`   ✅ Migrated ${humanReviews.length} human reviews\n`);

  // Initialize other collections
  console.log('📋 Initializing additional collections...');
  await writeJSON(path.join(NEW_DATA_DIR, 'tutor_presence.json'), []);
  await writeJSON(path.join(NEW_DATA_DIR, 'quality_criteria.json'), [
    {
      id: '1',
      name: 'Subject Knowledge',
      description: 'Tutor demonstrates strong understanding of the subject matter',
      weight: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '2',
      name: 'Presentation Skills',
      description: 'Clear and engaging presentation style',
      weight: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '3',
      name: 'Teaching Techniques',
      description: 'Effective use of teaching methods and strategies',
      weight: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '4',
      name: 'Communication',
      description: 'Clear communication and student interaction',
      weight: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: '5',
      name: 'Feedback Quality',
      description: 'Provides helpful and constructive feedback',
      weight: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]);
  await writeJSON(path.join(NEW_DATA_DIR, 'audit_logs.json'), []);
  console.log('   ✅ Created empty collections\n');

  // Summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Migration Complete! ✅');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📊 Summary:`);
  console.log(`   Users:         ${users.length}`);
  console.log(`   Tutors:        ${tutors.length}`);
  console.log(`   Sessions:      ${sessions.length}`);
  console.log(`   AI Analyses:   ${aiAnalyses.length}`);
  console.log(`   Human Reviews: ${humanReviews.length}`);
  console.log('');
  console.log('🔐 Login Credentials:');
  console.log('   Admin:    admin@ischool.com / admin123');
  console.log('   Reviewer: reviewer@ischool.com / reviewer123');
  console.log('   Manager:  manager@ischool.com / manager123');
  console.log('');
  console.log('🚀 Start server with: npm start');
  console.log('═══════════════════════════════════════════════════════\n');
}

// Run migration
migrate().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
