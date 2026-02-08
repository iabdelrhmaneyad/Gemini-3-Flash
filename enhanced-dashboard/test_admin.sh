#!/bin/bash

echo "==================================="
echo "Testing Enhanced Dashboard Admin Features"
echo "==================================="
echo ""

# Login as admin
echo "1. Testing Admin Login..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ischool.com","password":"admin123"}')

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | grep -o '[^"]*$')

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed"
  exit 1
fi
echo "✅ Login successful"
echo ""

# Test get all users
echo "2. Testing GET /api/admin/users..."
USERS_RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/admin/users)
USER_COUNT=$(echo $USERS_RESPONSE | grep -o '"total":[0-9]*' | grep -o '[0-9]*')
echo "✅ Found $USER_COUNT users"
echo ""

# Test audit logs
echo "3. Testing GET /api/admin/audit-logs..."
AUDIT_RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/admin/audit-logs)
AUDIT_COUNT=$(echo $AUDIT_RESPONSE | grep -o '"total":[0-9]*' | grep -o '[0-9]*')
echo "✅ Found $AUDIT_COUNT audit logs"
echo ""

# Test system stats
echo "4. Testing GET /api/admin/system-stats..."
STATS_RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/admin/system-stats)
TOTAL_SESSIONS=$(echo $STATS_RESPONSE | grep -o '"total_sessions":[0-9]*' | grep -o '[0-9]*')
echo "✅ Total sessions: $TOTAL_SESSIONS"
echo ""

# Test export
echo "5. Testing GET /api/admin/export (sessions JSON)..."
EXPORT_RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:5000/api/admin/export?type=sessions&format=json")
if [ ${#EXPORT_RESPONSE} -gt 100 ]; then
  echo "✅ Export successful ($(echo -n $EXPORT_RESPONSE | wc -c) bytes)"
else
  echo "❌ Export failed or empty"
fi
echo ""

# Test unauthorized access
echo "6. Testing unauthorized access (no token)..."
UNAUTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/admin/users)
if [ "$UNAUTH_RESPONSE" == "401" ]; then
  echo "✅ Correctly blocked unauthorized access (401)"
else
  echo "❌ Authorization not working properly (got $UNAUTH_RESPONSE)"
fi
echo ""

echo "==================================="
echo "All tests completed!"
echo "==================================="
