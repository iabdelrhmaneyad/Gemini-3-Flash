# Quick Start Guide - Enhanced Dashboard Admin Features

## Access the Dashboard

1. Open browser: http://localhost:5000
2. Login with admin credentials:
   - Email: `admin@ischool.com`
   - Password: `admin123`

## Admin Features Quick Access

### 1. User Management 👥
**Path:** Sidebar → Admin Panel → User Management Tab

**Quick Actions:**
- Click "Add User" to create new user
- Click "Edit" on any user card to modify
- Click "Delete" to remove user (with confirmation)
- Assign multiple roles: Admin, Manager, Reviewer

### 2. Audit Logs 📜
**Path:** Sidebar → Audit Logs

**Quick Actions:**
- Select action type from dropdown
- Set date range (From/To dates)
- Click "Apply Filters"
- View all system activities in table

### 3. Bulk Operations ⚡
**Path:** Sidebar → Admin Panel → Bulk Operations Tab

**Quick Actions:**
- Check multiple pending sessions
- Select reviewer from dropdown
- Click "Assign Selected Sessions"
- See success/failure counts

### 4. System Statistics 📊
**Path:** Sidebar → Admin Panel → System Stats Tab

**What You See:**
- Total users, sessions, reviews, audit logs
- 7-day activity line chart
- User activity leaderboard
- Last action timestamps

### 5. Data Export 💾
**Path:** Sidebar → Export Data

**Quick Actions:**
- Click any export card (Sessions/Tutors/Reviews JSON or CSV)
- CSV downloads automatically
- JSON opens in new window
- Quick CSV export button in top bar

## Common Tasks

### Create a New User
```
1. Admin Panel → User Management Tab
2. Click "Add User"
3. Fill form:
   - Full Name
   - Email
   - Username
   - Password
   - Check roles (Admin/Manager/Reviewer)
4. Click "Save User"
```

### Assign Multiple Sessions
```
1. Admin Panel → Bulk Operations Tab
2. Check sessions to assign
3. Select reviewer from dropdown
4. Click "Assign Selected Sessions"
5. View success count
```

### View System Activity
```
1. Audit Logs page
2. Filter by action (optional)
3. Set date range (optional)
4. Click "Apply Filters"
5. View detailed logs
```

### Export Sessions Data
```
Option 1 (From Export Page):
1. Sidebar → Export Data
2. Click "Sessions (CSV)" or "Sessions (JSON)"
3. File downloads automatically

Option 2 (Quick Export):
1. Go to Sessions page
2. Click "Export CSV" in top bar
3. CSV downloads
```

### Check System Health
```
1. Admin Panel → System Stats Tab
2. View metric cards
3. Check 7-day activity chart
4. Review user activity table
```

## API Testing (Optional)

### Login and Get Token
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ischool.com","password":"admin123"}'
```

### Get All Users
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:5000/api/admin/users
```

### Get Audit Logs
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:5000/api/admin/audit-logs
```

### Get System Stats
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:5000/api/admin/system-stats
```

### Export Data
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/api/admin/export?type=sessions&format=csv"
```

## Troubleshooting

### Can't see admin menu?
- Ensure you're logged in as admin
- Admin menu items only visible to users with "admin" role
- Logout and login again if needed

### Dashboard not loading?
```bash
pm2 list  # Check if enhanced-dashboard is online
pm2 restart enhanced-dashboard  # Restart if needed
pm2 logs enhanced-dashboard  # Check for errors
```

### Database errors?
```bash
cd /home/ai_quality/Desktop/TestVideo\ 22122025/enhanced-dashboard/data
ls -la  # Check if JSON files exist
cat users.json | jq .  # Validate JSON syntax
```

### Port 5000 already in use?
```bash
pm2 stop enhanced-dashboard
lsof -i :5000  # Find process using port
kill -9 PID  # Kill the process
pm2 start enhanced-dashboard
```

## User Roles Explained

| Role | Permissions |
|------|-------------|
| **Admin** | Full access: User management, audit logs, bulk operations, data export, all analytics |
| **Manager** | Assign sessions, view analytics, submit reviews |
| **Reviewer** | View sessions, submit quality reviews, view own stats |

## Security Notes

- **Passwords:** Always use strong passwords (min 8 characters)
- **Tokens:** JWT tokens expire after 24 hours
- **Audit:** All admin actions are automatically logged
- **Authorization:** Admin routes return 403 for non-admin users
- **Deletion:** Admins cannot delete themselves

## PM2 Commands

```bash
# Start dashboard
pm2 start server.js --name enhanced-dashboard

# Restart dashboard
pm2 restart enhanced-dashboard

# Stop dashboard
pm2 stop enhanced-dashboard

# View logs (live)
pm2 logs enhanced-dashboard

# View logs (last 100 lines)
pm2 logs enhanced-dashboard --lines 100

# View all processes
pm2 list

# Save PM2 config
pm2 save

# Startup on boot
pm2 startup
```

## File Locations

```
enhanced-dashboard/
├── server.js                    # Main server file
├── controllers/
│   ├── adminController.js       # Admin operations
│   └── ...other controllers
├── routes/
│   ├── admin.js                 # Admin API routes
│   └── ...other routes
├── middleware/
│   └── auth.js                  # Authentication & audit logging
├── public/
│   ├── index.html               # Main UI
│   ├── js/app.js                # Frontend logic
│   └── css/style.css            # Styling
└── data/
    ├── users.json               # User accounts
    ├── user_roles.json          # User-role mapping
    ├── sessions.json            # Session records
    ├── audit_logs.json          # System activity logs
    └── ...other data files
```

## Support

For issues:
1. Check PM2 logs: `pm2 logs enhanced-dashboard`
2. Verify database files in `/data/` directory
3. Test API endpoints with curl
4. Check browser console for JavaScript errors
5. Review [ADMIN_FEATURES.md](ADMIN_FEATURES.md) for detailed documentation

## Quick Test

Run the test script to verify all features:
```bash
cd /home/ai_quality/Desktop/TestVideo\ 22122025/enhanced-dashboard
bash test_admin.sh
```

Expected output:
```
✅ Login successful
✅ Found 3 users
✅ Found audit logs
✅ Total sessions: 86
✅ Export successful
✅ Correctly blocked unauthorized access (401)
```

---

**Dashboard URL:** http://localhost:5000
**Admin Email:** admin@ischool.com
**Admin Password:** admin123

🎉 **You're all set!**
