# iSchool Dashboard - System Testing Plan

## Test Environment
- **Server**: http://localhost:3000
- **Test Data**: sessions-from-folder.csv (15 real sessions)
- **Tutors**: 15 unique tutors (T-11450 through T-8811)

---

## Test Checklist

### Main Dashboard Tests

#### 1. CSV Upload ✓
- [ ] Drag and drop CSV file
- [ ] Click to browse and select CSV
- [ ] Verify file name displays
- [ ] Check upload success notification
- [ ] Confirm 15 sessions loaded

#### 2. Analytics Cards ✓
- [ ] Total Sessions count = 15
- [ ] Completed Sessions updates
- [ ] Audited Sessions = 0 initially
- [ ] Pending Sessions = 15 initially
- [ ] Numbers animate on update

#### 3. Charts Display ✓
- [ ] Charts section becomes visible after upload
- [ ] Status Distribution chart renders
- [ ] Tutor Performance chart renders
- [ ] Charts update with real data
- [ ] No scrolling issues

#### 4. Sessions Table ✓
- [ ] All 15 sessions display
- [ ] Tutor IDs correct
- [ ] Session IDs match
- [ ] Time slots show "Variable"
- [ ] Status shows "pending"
- [ ] Progress shows 0%

#### 5. Search & Filter ✓
- [ ] Search by tutor ID works
- [ ] Search by session ID works
- [ ] Status filter (All/Pending/Completed/Failed)
- [ ] Audit filter (All/Audited/Not Audited)
- [ ] Table updates in real-time

#### 6. Batch Operations ✓
- [ ] Select All checkbox works
- [ ] Individual checkboxes work
- [ ] Selected count updates
- [ ] Batch Actions bar appears
- [ ] Batch Approve works
- [ ] Batch Reject works
- [ ] Confirmation dialogs appear

#### 7. Video Player ✓
- [ ] Click "View" button
- [ ] Video modal opens
- [ ] Video title displays
- [ ] Video loads (file:// protocol)
- [ ] Controls work (play/pause/seek)
- [ ] Close button works
- [ ] Click outside closes modal

#### 8. Audit Modal ✓
- [ ] Click "Audit" button
- [ ] Modal opens with session info
- [ ] Tutor ID displays correctly
- [ ] Session ID displays correctly
- [ ] Time slot displays correctly
- [ ] Comment textarea works
- [ ] Approval checkbox works
- [ ] Save button saves data
- [ ] Cancel button closes modal
- [ ] Close X button works

#### 9. Delete Function ✓
- [ ] Delete button (🗑️) visible
- [ ] Click shows confirmation dialog
- [ ] Confirmation shows session details
- [ ] Cancel keeps session
- [ ] Confirm deletes session
- [ ] Table updates immediately
- [ ] Analytics update
- [ ] Charts update
- [ ] Success notification shows

#### 10. Export Data ✓
- [ ] Export button works
- [ ] CSV file downloads
- [ ] File contains all sessions
- [ ] Includes audit data
- [ ] Proper formatting

---

### BI Dashboard Tests

#### 11. Navigation ✓
- [ ] "📊 BI Dashboard" button visible
- [ ] Click navigates to BI page
- [ ] Page loads without errors
- [ ] "← Back to Sessions" button visible
- [ ] Back button returns to main dashboard

#### 12. Executive Summary KPIs ✓
- [ ] Total Tutors = 15
- [ ] Avg Performance Score calculated
- [ ] Critical Flags count
- [ ] Quality Rating (0-5 stars)
- [ ] Trend indicators display
- [ ] Cards have hover effects

#### 13. Performance Charts ✓
- [ ] Performance Distribution (Doughnut) renders
- [ ] Shows High/Medium/Low segments
- [ ] Performance Trend (Line) renders
- [ ] Shows 30-day data
- [ ] Smooth line with gradient
- [ ] Legend displays correctly

#### 14. Quality Flags Charts ✓
- [ ] Flag Distribution (Pie) renders
- [ ] Shows Red/Yellow/Green
- [ ] Flags by Category (Stacked Bar) renders
- [ ] Shows 4 categories
- [ ] Stacked correctly

#### 15. Tutor Rankings ✓
- [ ] Top Performers list shows 5 tutors
- [ ] Sorted by highest score
- [ ] Orange badges display
- [ ] Session counts shown
- [ ] Needs Improvement list shows 5 tutors
- [ ] Sorted by lowest score
- [ ] Red badges display
- [ ] Hover effects work

#### 16. Score Analysis Charts ✓
- [ ] Score Distribution (Bar) renders
- [ ] Shows 5 ranges (0-20, 21-40, etc.)
- [ ] Score Dimensions (Radar) renders
- [ ] Shows 5 dimensions
- [ ] Proper scaling (0-100)

#### 17. Tutor Comparison ✓
- [ ] Tutor 1 dropdown populated
- [ ] Tutor 2 dropdown populated
- [ ] Select two tutors
- [ ] Click "Compare" button
- [ ] Radar chart renders
- [ ] Two datasets overlay
- [ ] Different colors (Blue/Orange)
- [ ] Legend shows tutor IDs

#### 18. Time-Based Analysis ✓
- [ ] Time Slot Performance (Bar) renders
- [ ] Shows all time slots
- [ ] Average scores calculated
- [ ] Weekly Heatmap renders
- [ ] 7 days × 6 time blocks grid
- [ ] Color coding (Red/Yellow/Green)
- [ ] Hover shows performance

#### 19. Filtering System ✓
- [ ] Date Range dropdown works
- [ ] Tutor dropdown populated with all 15
- [ ] Performance dropdown works
- [ ] Apply Filters button updates all charts
- [ ] Reset button restores defaults
- [ ] All charts refresh correctly

#### 20. Export Report ✓
- [ ] Export Report button visible
- [ ] Click shows alert (placeholder)
- [ ] Future: PDF generation

---

## Bug Fixes Needed

### Critical
- [ ] None identified yet

### Medium
- [ ] None identified yet

### Low
- [ ] None identified yet

---

## Polish & Enhancements

### UI/UX Improvements
- [ ] Add loading spinners
- [ ] Smooth transitions
- [ ] Error handling
- [ ] Empty state messages
- [ ] Tooltips for buttons
- [ ] Keyboard shortcuts

### Performance
- [ ] Optimize chart rendering
- [ ] Debounce search input
- [ ] Lazy load charts
- [ ] Cache calculations

### Professional Touches
- [ ] Consistent spacing
- [ ] Proper error messages
- [ ] Success confirmations
- [ ] Accessibility (ARIA labels)
- [ ] Mobile responsiveness

---

## Test Results

### Session 1: Initial Load
- Date: 2026-01-06
- Status: PENDING
- Issues Found: TBD
- Notes: TBD

### Session 2: CSV Upload
- Date: 2026-01-06
- Status: PENDING
- Issues Found: TBD
- Notes: TBD

### Session 3: Feature Testing
- Date: 2026-01-06
- Status: PENDING
- Issues Found: TBD
- Notes: TBD

---

## Sign-off

- [ ] All critical features working
- [ ] No critical bugs
- [ ] UI polished and professional
- [ ] Ready for production use
