# API Endpoints Reference

This reference covers the primary REST API endpoints available for paying customers.

**Note:** All requests require the `Authorization: Bearer <token>` header and `Content-Type: application/json`.

---

## 1. Prospects

Manage and retrieve MCA lead prospects generated from UCC filings.

### List Prospects
```http
GET /api/prospects
```
Retrieves a paginated list of prospects matching your criteria.

**Query Parameters:**
| Parameter    | Type    | Default          | Description                                                |
| ------------ | ------- | ---------------- | ---------------------------------------------------------- |
| `page`       | integer | 1                | Page number                                                |
| `limit`      | integer | 20               | Results per page                                           |
| `state`      | string  | -                | Filter by US state code (2 chars)                          |
| `industry`   | string  | -                | Filter by industry                                         |
| `min_score`  | integer | -                | Minimum priority score (0-100)                             |
| `max_score`  | integer | -                | Maximum priority score (0-100)                             |
| `status`     | string  | -                | Filter: `all`, `unclaimed`, `claimed`, `contacted`         |
| `sort_by`    | string  | `priority_score` | Sort field: `priority_score`, `created_at`, `company_name` |
| `sort_order` | string  | `desc`           | Sort direction: `asc`, `desc`                              |

**Response (200 OK):**
```json
{
  "prospects": [
    {
      "id": "uuid",
      "company_name": "Acme Corp",
      "state": "CA",
      "priority_score": 85,
      "health_grade": "A",
      "industry": "technology"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

### Get Prospect Details
```http
GET /api/prospects/:id
```
Returns comprehensive details for a specific prospect, including UCC filings, enrichment data, and growth signals.

---

## 2. Enrichment

Trigger data enrichment and scoring operations on prospects.

### Batch Enrich Prospects
```http
POST /api/enrichment/batch
```
Enriches up to 100 prospects in a single request. 

**Request Body:**
```json
{
  "prospect_ids": ["uuid-1", "uuid-2"]
}
```

**Response (200 OK):**
```json
{
  "total": 2,
  "successful": 2,
  "failed": 0,
  "results": [
    { "prospect_id": "uuid-1", "success": true },
    { "prospect_id": "uuid-2", "success": true }
  ]
}
```

### Get Enrichment Queue Status
```http
GET /api/enrichment/queue
```
Check the status of ongoing enrichment jobs.

---

## 3. Competitors

Analyze secured parties (competitors) issuing UCC filings.

### List Competitors
```http
GET /api/competitors
```
Returns a list of lenders/competitors ordered by filing volume.

**Query Parameters:**
| Parameter    | Type    | Default        | Description                                  |
| ------------ | ------- | -------------- | -------------------------------------------- |
| `page`       | integer | 1              | Page number                                  |
| `limit`      | integer | 20             | Results per page                             |
| `state`      | string  | -              | Filter by state                              |
| `sort_by`    | string  | `filing_count` | Sort: `filing_count`, `total_amount`, `name` |

---

## 4. Portfolio

Monitor the health of your funded portfolio companies.

### List Portfolio Companies
```http
GET /api/portfolio
```

**Query Parameters:**
| Parameter      | Type    | Default       | Description                                         |
| -------------- | ------- | ------------- | --------------------------------------------------- |
| `health_grade` | string  | -             | Filter: `A`, `B`, `C`, `D`, `F`                     |

**Response (200 OK):**
```json
{
  "companies": [
    {
      "id": "uuid",
      "company_name": "Tech Innovators LLC",
      "funded_date": "2024-01-10",
      "health_grade": "A"
    }
  ],
  "pagination": {
    "page": 1,
    "total": 25
  }
}
```

### Get Health History
```http
GET /api/portfolio/:id/health-history
```
Returns historical tracking of the portfolio company's health score and sentiment trend.
