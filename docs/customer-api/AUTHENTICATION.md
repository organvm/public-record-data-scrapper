# API Authentication

The UCC-MCA Intelligence API uses JSON Web Tokens (JWT) to authenticate requests. All customer-facing endpoints require a valid token to be included in the `Authorization` header.

## Authentication Flow

To authenticate your requests, include the `Authorization` header with the `Bearer` scheme:

```http
Authorization: Bearer <your_jwt_token>
```

## Obtaining a Token

Depending on your subscription tier and setup, you may obtain tokens via your platform dashboard or an authentication endpoint provided during your onboarding.

## Token Expiration

* **Access tokens:** Typically expire in 1 hour.
* **Refresh tokens:** Last up to 7 days, allowing you to obtain new access tokens without requiring manual login.

Make sure your integration handles 401 Unauthorized responses to seamlessly refresh tokens or prompt for re-authentication.

## Example Request

**cURL**
```bash
curl -X GET "https://api.your-domain.com/api/prospects" \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "Content-Type: application/json"
```

## Security Best Practices

* **Always use HTTPS:** Never send your token over unencrypted HTTP.
* **Store tokens securely:** Keep tokens out of version control and public repositories. Use secure environment variables or a secrets manager.
* **Respect Token Lifetimes:** Build retry mechanisms that intercept 401 errors, refresh the token, and replay the original request.
