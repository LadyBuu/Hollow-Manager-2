# Migration Notes

This file records the renames, removals, and contract changes that
landed across the Academy, Teams, and Tournaments refactors. It is
written for the version immediately following these changes and for
anyone reading the codebase later who finds an old habit that no
longer works.

Each entry has the shape:

    What changed
    Why
    What to do if you were using the old form

Nothing here is a suggestion. Every item is already in the code.

---

## 1. General contract changes

### Writes are Promise-based

All domain mutations across Academy, Teams, and Tournaments now
return `Promise<{ success, data?, message? }>`. Synchronous
mutations that returned `object | null | boolean` are gone.

**Why:** persistence, rollback, and activity logging live in
`MutationPipeline`. The pipeline is asynchronous. Anything that
mutates must await it.

**Migration:**

```js
// Old
var result = TeamCore.createTeam(data);
if (result) { ... }

// New
TeamCore.createTeam(data).then(function(result) {
    if (result && result.success) { ... }
});
