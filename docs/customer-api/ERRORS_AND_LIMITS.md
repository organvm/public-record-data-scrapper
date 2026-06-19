# Errors and Rate Limits

To ensure high availability and fair usage, the UCC-MCA Intelligence API uses standard HTTP status codes and enforces rate limiting.

---

## 1. Standard Error Responses

When an API request fails, the response will include a standardized JSON payload describing the error.

### Error Format
```json
{
  "error": {
    "message": "Human-readable error description.",
    "code": "ERROR_CODE",
    "statusCode": 400
  }
}
```

### Common Status Codes & Error Codes

| Status Code | Error Code            | Description                                                                 |
| ----------- | --------------------- | --------------------------------------------------------------------------- |
| `400`       | `BAD_REQUEST`         | The request was invalid or missing required parameters.                     |
| `401`       | `UNAUTHORIZED`        | No valid JWT token was provided, or the token has expired.                  |
| `403`       | `FORBIDDEN`           | The authenticated user lacks permission for the requested resource.         |
| `404`       | `NOT_FOUND`           | The requested resource (e.g., Prospect ID) does not exist.                  |
| `429`       | `RATE_LIMIT_EXCEEDED` | The API rate limit has been exceeded.                                       |
| `500`       | `INTERNAL_ERROR`      | An unexpected error occurred on the server. Retry using exponential backoff.|
| `503`       | `SERVICE_UNAVAILABLE` | The service is temporarily down for maintenance or overloaded.              |

---

## 2. Rate Limiting

The API rate limits are applied per authenticated user account, varying by subscription tier. When rate limits are exceeded, the API responds with a `429 Too Many Requests` status code.

### Rate Limit Headers

Every API response includes the following headers to help you manage your request volume:

* `X-RateLimit-Limit`: The maximum number of requests permitted in the current window.
* `X-RateLimit-Remaining`: The number of requests remaining in the current window.
* `X-RateLimit-Reset`: The time at which the current window resets (in ISO 8601 format or Unix epoch).

### Tier Limits

* **Free / Trial Tier:** 10 requests per minute
* **Starter Tier:** 30 requests per minute
* **Professional Tier:** 100 requests per minute
* **Enterprise Tier:** Unlimited or custom SLA

### Handling Rate Limits Gracefully

If your application receives a `429` status code:
1. Inspect the `X-RateLimit-Reset` header or the `Retry-After` header (if provided).
2. Pause subsequent requests until the reset time is reached.
3. Use **Exponential Backoff** when retrying failed requests.
