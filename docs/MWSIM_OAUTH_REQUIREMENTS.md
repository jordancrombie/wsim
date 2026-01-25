# MWSIM OAuth Authorization Code Flow - Implementation Requirements

## Overview

This document describes the mobile app implementation requirements for handling OAuth Authorization Code flow approvals. This flow is used by browser-based AI platforms (ChatGPT Connectors, Claude MCP, Google Gemini) to connect to user wallets.

## How It Works

1. User initiates connection from AI platform (e.g., ChatGPT)
2. Browser redirects to WSIM OAuth authorize page
3. User enters their email on the consent page
4. WSIM sends push notification to user's mobile device
5. **User opens mwsim app and approves/rejects the request**
6. Browser receives authorization code and completes OAuth flow

## Push Notification

When an OAuth authorization request is created, the mobile app will receive a push notification.

### Notification Payload

```json
{
  "aps": {
    "alert": {
      "title": "Authorization Request",
      "body": "ChatGPT wants to connect to your wallet"
    },
    "sound": "default"
  },
  "type": "oauth.authorization",
  "screen": "OAuthAuthorization",
  "params": {
    "oauthAuthorizationId": "550e8400-e29b-41d4-a716-446655440000"
  },
  "clientName": "ChatGPT",
  "scope": "browse cart purchase"
}
```

### Deep Link Handling

- **Screen**: `OAuthAuthorization`
- **Parameter**: `oauthAuthorizationId` - UUID of the authorization request

When the user taps the notification, navigate to the OAuth authorization approval screen using the `oauthAuthorizationId`.

## API Endpoints

All endpoints require mobile JWT authentication (`Authorization: Bearer <mobile_access_token>`).

Base URL: `https://wsim-dev.banksim.ca/api/mobile/access-requests`

---

### 1. List Pending OAuth Authorizations

**Optional** - Use this to show pending authorizations in a list view.

```
GET /oauth-authorizations
```

#### Response

```json
{
  "authorizations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "client_id": "chatgpt",
      "client_name": "ChatGPT",
      "scope": "browse cart purchase",
      "created_at": "2026-01-25T10:00:00.000Z",
      "expires_at": "2026-01-25T10:10:00.000Z",
      "time_remaining_seconds": 547
    }
  ]
}
```

---

### 2. Get OAuth Authorization Details

Use this to display the approval screen.

```
GET /oauth-authorizations/:id
```

#### Response

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "client_id": "chatgpt",
  "client_name": "ChatGPT",
  "status": "pending_approval",
  "scope": "browse cart purchase",
  "scopes": [
    { "name": "browse", "description": "View products and prices" },
    { "name": "cart", "description": "Manage shopping cart" },
    { "name": "purchase", "description": "Make purchases on your behalf" }
  ],
  "created_at": "2026-01-25T10:00:00.000Z",
  "expires_at": "2026-01-25T10:10:00.000Z",
  "time_remaining_seconds": 547
}
```

#### Error Responses

- `403 Forbidden` - Authorization request does not belong to user
- `404 Not Found` - Authorization request not found

---

### 3. Approve OAuth Authorization

**Requires biometric authentication (Face ID/Touch ID) before calling.**

```
POST /oauth-authorizations/:id/approve
```

#### Request Body

None required.

#### Response

```json
{
  "status": "approved",
  "message": "Authorization approved. The application will now have access to your wallet."
}
```

#### Error Responses

- `400 Bad Request` - Authorization request has expired
- `403 Forbidden` - Authorization request does not belong to user
- `404 Not Found` - Authorization request not found
- `409 Conflict` - Authorization request already resolved

---

### 4. Reject OAuth Authorization

```
POST /oauth-authorizations/:id/reject
```

#### Request Body

None required.

#### Response

```json
{
  "status": "rejected",
  "message": "Authorization rejected."
}
```

#### Error Responses

- `403 Forbidden` - Authorization request does not belong to user
- `404 Not Found` - Authorization request not found
- `409 Conflict` - Authorization request already resolved

---

## UI Requirements

### Approval Screen

Display the following information:

1. **Client Name** - e.g., "ChatGPT", "Claude (MCP)", "Google Gemini"
2. **Requested Scopes** - List each scope with its description:
   - `browse` - "View products and prices"
   - `cart` - "Manage shopping cart"
   - `purchase` - "Make purchases on your behalf"
   - `history` - "View transaction history"
3. **Expiration Timer** - Show countdown using `time_remaining_seconds`
4. **Approve Button** - Requires biometric authentication
5. **Reject Button** - No biometric required

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Push Notification Received                    │
│              "ChatGPT wants to connect to your wallet"          │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      User Taps Notification                      │
│                                                                  │
│  Navigate to OAuthAuthorization screen with oauthAuthorizationId │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   GET /oauth-authorizations/:id                  │
│                                                                  │
│  Fetch authorization details for display                         │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OAuth Authorization Screen                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     🔗 Connect App                        │  │
│  │                                                           │  │
│  │  ChatGPT wants to connect to your wallet                  │  │
│  │                                                           │  │
│  │  This will allow ChatGPT to:                              │  │
│  │  ✓ View products and prices                               │  │
│  │  ✓ Manage shopping cart                                   │  │
│  │  ✓ Make purchases on your behalf                          │  │
│  │                                                           │  │
│  │  ⏱️ Expires in 9:23                                       │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              [Approve with Face ID]                 │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │                    [Reject]                         │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                     ┌───────────┴───────────┐
                     │                       │
                     ▼                       ▼
          [Approve Tapped]           [Reject Tapped]
                     │                       │
                     ▼                       ▼
        Biometric Authentication      POST /oauth-authorizations/:id/reject
                     │                       │
                     ▼                       ▼
    POST /oauth-authorizations/:id/approve    Show "Rejected" message
                     │
                     ▼
          Show "Connected" message
```

## Known OAuth Clients

| Client ID | Display Name | Description |
|-----------|--------------|-------------|
| `chatgpt` | ChatGPT | OpenAI's ChatGPT platform |
| `claude-mcp` | Claude (MCP) | Anthropic's Claude with MCP |
| `gemini` | Google Gemini | Google's Gemini AI |
| `wsim-test` | WSIM Test Client | Development testing |

## Status Values

| Status | Description |
|--------|-------------|
| `pending_identification` | Waiting for user to enter email on consent page |
| `pending_approval` | Email submitted, waiting for mobile app approval |
| `approved` | User approved, authorization code generated |
| `rejected` | User rejected the request |
| `expired` | Request expired (10 minute timeout) |
| `used` | Authorization code has been exchanged |

## Important Notes

1. **Biometric Required for Approve** - Always require Face ID/Touch ID before calling the approve endpoint
2. **Expiration** - Authorization requests expire after 10 minutes. Show a countdown timer.
3. **One-Time Use** - Once approved/rejected, the authorization cannot be changed
4. **Immediate Effect** - Upon approval, the browser waiting on the consent page will immediately receive the authorization code

## Testing

Use client_id `wsim-test` for development testing. Initiate an OAuth flow by visiting:

```
https://wsim-dev.banksim.ca/api/agent/v1/oauth/authorize?
  response_type=code&
  client_id=wsim-test&
  redirect_uri=http://localhost:3000/callback&
  code_challenge=YOUR_CHALLENGE&
  code_challenge_method=S256&
  scope=browse%20cart%20purchase&
  state=random123
```

Replace `YOUR_CHALLENGE` with a base64url-encoded SHA256 hash of your code_verifier.
