# API Code Examples

These examples demonstrate common workflows using the UCC-MCA Intelligence API. Ensure you replace `YOUR_ACCESS_TOKEN` with your valid JWT token.

## 1. Fetching High-Priority Prospects

Retrieve the top 50 prospects in California with a priority score above 80.

### cURL
```bash
curl -X GET "https://api.your-domain.com/api/prospects?state=CA&min_score=80&limit=50" \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "Content-Type: application/json"
```

### Node.js (JavaScript/TypeScript)
```javascript
const fetch = require('node-fetch');

async function getHighPriorityProspects() {
  const url = 'https://api.your-domain.com/api/prospects?state=CA&min_score=80&limit=50';
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer YOUR_ACCESS_TOKEN',
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  console.log(`Found ${data.pagination.total} prospects.`);
  console.log(data.prospects);
}

getHighPriorityProspects();
```

### Python
```python
import requests

url = "https://api.your-domain.com/api/prospects"
headers = {
    "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    "Content-Type": "application/json"
}
params = {
    "state": "CA",
    "min_score": 80,
    "limit": 50
}

response = requests.get(url, headers=headers, params=params)

if response.status_code == 200:
    data = response.json()
    print(f"Found {data['pagination']['total']} prospects.")
    for prospect in data['prospects']:
        print(f"{prospect['company_name']} - Score: {prospect['priority_score']}")
else:
    print(f"Error: {response.status_code} - {response.text}")
```

---

## 2. Triggering Batch Enrichment

Enrich a batch of specific prospects using their UUIDs.

### cURL
```bash
curl -X POST "https://api.your-domain.com/api/enrichment/batch" \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "prospect_ids": [
         "123e4567-e89b-12d3-a456-426614174000",
         "987f6543-e21b-34d5-c678-426614174011"
       ]
     }'
```

### Python
```python
import requests

url = "https://api.your-domain.com/api/enrichment/batch"
headers = {
    "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    "Content-Type": "application/json"
}
payload = {
    "prospect_ids": [
        "123e4567-e89b-12d3-a456-426614174000",
        "987f6543-e21b-34d5-c678-426614174011"
    ]
}

response = requests.post(url, headers=headers, json=payload)

if response.status_code == 200:
    print("Batch enrichment triggered successfully.")
    print(response.json())
else:
    print(f"Error: {response.status_code} - {response.text}")
```
