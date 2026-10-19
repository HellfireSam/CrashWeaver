# Concurrency Patterns

Notes for making parallel work predictable under load.

%%CW_CARD_START uid:CW-MOCK-008%%

## Bounded Worker Pool

A bounded pool prevents unbounded goroutines or threads from exhausting memory.
Queue depth and worker count should be tuned together based on latency and throughput targets.

%%CW_CARD_END uid:CW-MOCK-008%%

%%CW_CARD_START uid:CW-MOCK-009%%

## Idempotent Job Handler

A handler is idempotent when repeating the same operation produces the same end state.
Idempotency keys make retries safe when network acknowledgement is uncertain.

%%CW_CARD_END uid:CW-MOCK-009%%
