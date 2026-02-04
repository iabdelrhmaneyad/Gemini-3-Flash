# iSchool AI Quality Dashboard - Quick Start

## 🚀 Dashboard is Running!

**URL:** http://localhost:3000

---

## 📊 Upload Real Session Data

### Step 1: Locate the CSV File

The CSV with your 15 real sessions is ready:
```
ischool-dashboard/sessions-from-folder.csv
```

### Step 2: Upload to Dashboard

1. Open http://localhost:3000 in your browser
2. Drag the `sessions-from-folder.csv` file to the orange upload zone
3. OR click the upload zone and select the file
4. Wait for upload confirmation
5. Sessions will appear in the table below

---

## ✅ UI Fixes Applied

### Fixed Issues:
- ✅ Chart scrolling problem resolved
- ✅ Chart containers now have fixed max-height (400px)
- ✅ Canvas elements locked to 250px height
- ✅ Charts maintain proper aspect ratio
- ✅ No more unwanted scrolling

### Changes Made:
- Added `max-height` to chart containers
- Added `!important` flags to canvas dimensions
- Set `maintainAspectRatio: false` in Chart.js config
- Improved chart section spacing

---

## 🎯 Features Available

### 1. Upload & View Sessions
- Drag-and-drop CSV upload
- Real-time progress tracking
- 15 real tutor sessions ready

### 2. Search & Filter
- Search by tutor ID, session ID, or time slot
- Filter by status (Pending/Completed/Failed)
- Filter by audit status

### 3. Video Playback
- Click "▶ View" on any session
- Watch session recordings
- Local file:// protocol supported

### 4. Audit Sessions
- Click "Audit" button
- Add comments
- Approve/reject sessions
- Track audit history

### 5. Batch Operations
- Select multiple sessions
- Bulk approve or reject
- Efficient workflow

### 6. Analytics & Charts
- Status distribution (doughnut chart)
- Tutor performance (bar chart)
- Real-time updates

### 7. Export Data
- Click "Export Data" button
- Download CSV with all session data
- Includes audit information

---

## 📁 Your Session Data

**15 Real Sessions Included:**
- T-11450, T-12119, T-12124, T-12233
- T-1406, T-1640, T-4079, T-4358
- T-4440, T-5020, T-7041, T-7070
- T-8409, T-8451, T-8811

Each session includes:
- Video file (.mp4)
- Transcript file (.vtt or .txt)
- Full path for local playback

---

## 🔧 Optional: Run RAG Analysis

To analyze session quality automatically:

```bash
python integrate_sessions_dashboard.py
```

Choose option 2 or 3 to run RAG analysis on sessions.

---

## 💡 Tips

1. **Refresh the page** if you see any old placeholder data
2. **Charts only appear** after uploading sessions
3. **Video playback** requires browser permission for local files
4. **Batch operations** are great for bulk approvals
5. **Export regularly** to backup audit data

---

## 🎨 Design

- Official iSchool branding
- Bright blue (#007bff) and orange (#f58220)
- Rounded corners (24px)
- Light, modern theme
- Responsive design

---

## ✨ Next Steps

1. **Upload CSV** → `sessions-from-folder.csv`
2. **Explore features** → Search, filter, view videos
3. **Audit sessions** → Add comments and approvals
4. **Export data** → Download results

**Dashboard is ready to use!** 🎉
