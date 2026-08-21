After four parts about batching, memory, and speculation, I want to end somewhere unglamorous: the health endpoint. The most important piece of a serving system is the boring one that tells the load balancer whether to send you traffic, and it is almost always wrong the first time.

The failure I have watched more than once is a server that returns `200 OK` on `/healthz` while the model is quietly broken — CUDA context lost, KV cache wedged, first token stuck at eight seconds. The process is alive, so the check passes, so the balancer keeps routing to it, so a fraction of every user's requests fall into a hole. Liveness is not readiness, and readiness is not "can I actually decode a token right now."

A health check I trust does the following, and nothing more clever than this:

- **Runs a real tiny generation**, not a ping — one prompt, one token, on the actual model, with a hard timeout.
- **Checks the KV allocator**, so a server with no free blocks reports unready instead of accepting work it will preempt.
- **Reports readiness separately from liveness**: liveness means "don't kill me," readiness means "send me traffic," and conflating them causes restart storms.
- **Fails fast and honestly**, returning non-200 the instant a decode probe blows its timeout, so the balancer drains you in seconds not minutes.

> The endpoint that decides whether you exist to the rest of the fleet deserves more care than the endpoint that does the work. Nobody's p99 survives a load balancer that can't tell a healthy replica from a hung one.

Everything upstream in this series — continuous batching, paged KV, speculative decode — is throughput you only get to keep if the fleet routes around the broken replica before users feel it. The boring endpoint is where all that cleverness either compounds or leaks away. Make it tell the truth.
