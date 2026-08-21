This is a placeholder page that exists to test what happens when a post is suspended rather than deleted. If you are reading it on the live site, something in the suspension path has failed, and that is itself the useful signal — the whole point of a suspended state is that the content stays in the store, keeps its slug, and simply stops being served.

## Why suspension is not deletion

Deletion is destructive and final; suspension is a reversible visibility change, and the two failure modes are completely different. A deleted post that reappears is a data-integrity bug. A suspended post that reappears is an access-control bug, and access-control bugs are the ones that leak. I keep this page around precisely so that the suspension path has something to act on that carries no real content — if the guard breaks, the only thing exposed is this paragraph explaining that the guard broke.
