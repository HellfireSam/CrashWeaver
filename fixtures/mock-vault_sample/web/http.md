# HTTP Responses

Status codes should tell the client what happened and whether retrying makes sense.

%%CW_CARD_START uid:CW-MOCK-005%%

### 404 vs 500

A 404 means the server is reachable but the requested resource was not found.
A 500 means the server failed while trying to handle a valid request.
Clients should not retry a 404 without changing the URL, but may retry a 500 depending on idempotency and server guidance.

%%CW_CARD_END uid:CW-MOCK-005%%