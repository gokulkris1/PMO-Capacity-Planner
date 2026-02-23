#!/bin/bash
echo "Registering..."
RES=$(curl -s -X POST http://localhost:8888/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"limit_test15@example.com","password":"password","name":"Test Org"}')

TOKEN=$(echo $RES | node -pe "JSON.parse(require('fs').readFileSync(0, 'utf-8')).token")

if [ -z "$TOKEN" ] || [ "$TOKEN" == "undefined" ]; then
  echo "Registration failed: $RES"
  exit 1
fi

echo "Token received. Attempting to save 6 resources..."
curl -s -w "\nHTTP Status: %{http_code}\n" -X POST http://localhost:8888/api/workspace \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"resources": [{},{},{},{},{},{}], "projects": [], "allocations": []}'
