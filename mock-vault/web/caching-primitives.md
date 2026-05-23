# Caching Primitives

Reference concepts for HTTP and application-layer caching.

%%CW_CARD_START uid:CW-MOCK-010%%

## Cache Aside

Cache-aside reads from cache first and falls back to source on miss, then populates cache.
It is simple to adopt but may create stale reads unless invalidation policy is explicit.

%%CW_CARD_END uid:CW-MOCK-010%%

%%CW_CARD_START uid:CW-MOCK-011%%

## ETag Revalidation

ETag revalidation uses conditional requests so unchanged resources return lightweight 304 responses.
This reduces payload transfer while preserving freshness guarantees.

%%CW_CARD_END uid:CW-MOCK-011%%
