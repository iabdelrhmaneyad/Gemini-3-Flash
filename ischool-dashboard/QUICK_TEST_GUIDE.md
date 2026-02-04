# iSchool Dashboard - Quick Test Guide

## 🚀 Quick Start Testing

### Step 1: Access Main Dashboard
1. Open: http://localhost:3000
2. You should see the iSchool AI Quality System dashboard
3. Check that the "📊 BI Dashboard" button is visible in the header

### Step 2: Upload CSV File
1. Locate file: `ischool-dashboard/sessions-from-folder.csv`
2. **Option A**: Drag and drop the file onto the orange upload zone
3. **Option B**: Click the upload zone and select the file
4. Wait for "Successfully uploaded 15 sessions" notification
5. Verify charts section appears below

### Step 3: Test Main Dashboard Features

**Analytics Cards** (Top of page)
- Total Sessions: Should show 15
- Completed: Should show 0 (initially)
- Audited: Should show 0 (initially)
- Pending: Should show 15

**Charts** (Below analytics)
- Session Status Distribution (doughnut chart)
- Tutor Performance (bar chart)

**Sessions Table**
- Should display all 15 sessions
- Each row shows: Checkbox, Tutor ID, Session ID, Time slot, Status, Progress, Actions, Delete

**Search & Filter**
- Type a tutor ID (e.g., "T-7070") in search box
- Try status filter dropdown
- Try audit filter dropdown

**Video Player**
- Click "▶ View" on any session
- Video modal should open
- Video should load (requires browser permission for file:// protocol)
- Close with X or click outside

**Audit Feature**
- Click "Audit" on any session
- Add a comment
- Check "Approve this session"
- Click "Save Audit"
- Row should update to show "✓ Audited"

**Batch Operations**
- Check 2-3 sessions using checkboxes
- Batch Actions bar appears
- Click "Approve Selected" or "Reject Selected"
- Confirm in dialog

**Delete Function**
- Click 🗑️ button on any session
- Confirm deletion
- Session removed from table
- Analytics update

**Export Data**
- Click "Export Data" button in header
- CSV file downloads with all session data

### Step 4: Test BI Dashboard

**Navigate to BI**
- Click "📊 BI Dashboard" button in header
- BI Dashboard page loads

**Executive Summary**
- 4 KPI cards display at top
- Total Tutors, Avg Performance, Critical Flags, Quality Rating
- Trend indicators visible

**Performance Overview**
- Performance Distribution (doughnut chart)
- Performance Trend (line chart showing 30 days)

**Quality Flags**
- Flag Distribution (pie chart)
- Flags by Category (stacked bar chart)

**Tutor Rankings**
- Top Performers list (5 tutors)
- Needs Improvement list (5 tutors)

**Score Analysis**
- Score Distribution (bar chart)
- Score Dimensions (radar chart)

**Tutor Comparison**
- Select two tutors from dropdowns
- Click "Compare"
- Radar chart shows comparison

**Time-Based Analysis**
- Performance by Time Slot (bar chart)
- Weekly Performance Heatmap

**Filtering**
- Change Date Range filter
- Select specific Tutor
- Choose Performance threshold
- Click "Apply Filters"
- All charts update
- Click "Reset" to restore

**Navigation Back**
- Click "← Back to Sessions"
- Returns to main dashboard

---

## ✅ Expected Results

### Main Dashboard
- ✓ CSV uploads successfully
- ✓ 15 sessions display in table
- ✓ Charts render correctly
- ✓ Search and filters work
- ✓ Video player opens
- ✓ Audit saves correctly
- ✓ Batch operations work
- ✓ Delete removes sessions
- ✓ Export downloads CSV

### BI Dashboard
- ✓ All KPIs calculate correctly
- ✓ 9 charts render without errors
- ✓ Rankings show top/bottom 5
- ✓ Comparison tool works
- ✓ Filters update all charts
- ✓ Navigation works both ways

---

## 🐛 If You Find Issues

Common issues and solutions:

**Video won't play**
- Browser blocks file:// protocol
- Solution: Use Chrome with `--allow-file-access-from-files` flag

**Charts not showing**
- Chart.js not loaded
- Check browser console for errors

**CSV upload fails**
- Check file format
- Ensure server is running (npm start)

**BI Dashboard empty**
- Upload CSV on main dashboard first
- BI reads from same session data

---

## 📝 Test Checklist

- [ ] Main dashboard loads
- [ ] CSV uploads (15 sessions)
- [ ] Analytics cards update
- [ ] Charts display
- [ ] Table shows all sessions
- [ ] Search works
- [ ] Filters work
- [ ] Video player opens
- [ ] Audit modal works
- [ ] Batch operations work
- [ ] Delete works
- [ ] Export works
- [ ] BI dashboard loads
- [ ] All 9 BI charts render
- [ ] Rankings display
- [ ] Comparison works
- [ ] BI filters work
- [ ] Navigation works

---

## 🎉 Success Criteria

All features working smoothly and professionally!
