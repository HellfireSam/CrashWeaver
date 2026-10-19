# Reliability Playbook

Practical patterns for keeping services responsive during partial failures.

%%CW_CARD_START uid:CW-MOCK-006%%

## Retry Budget Guardrail

A retry budget limits amplification during outages by capping total retries per request family.
Use jitter and backoff so retries spread over time instead of forming synchronized spikes.

%%CW_CARD_END uid:CW-MOCK-006%%

%%CW_CARD_START uid:CW-MOCK-007%%

## Circuit Breaker States

Circuit breakers protect dependencies by stopping calls when failure rates cross thresholds.
A half-open probe window checks whether downstream health has recovered before closing again.

%%CW_CARD_END uid:CW-MOCK-007%%
