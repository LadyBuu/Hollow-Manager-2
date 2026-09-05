Here's a comprehensive `ARCHITECTURE.md` document for the HollowBlades project:

```markdown
# HollowBlades Architecture

## Overview

HollowBlades is a single-page application for managing a fantasy academy, characters, teams, tournaments, missions, and social relationships. The architecture follows a strict layered design with clear ownership boundaries and single sources of truth.

## Architecture Principles

1. **Single Source of Truth** - Each concept has one authoritative owner
2. **Clear Dependency Direction** - Low-level utilities have no dependencies; higher-level modules depend on them
3. **No Domain Knowledge in Utilities** - Generic utilities don't know about HollowBlades concepts
4. **UI State is Ephemeral** - UI state is not persisted; domain data is persisted via IndexedDB
5. **Serialised Mutations** - All mutations are serialised to prevent rollback conflicts
6. **Explicit Bridges** - Infrastructure components communicate via explicit APIs, not magic events

## Layer Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        DOMAIN MODULES                       │
│  Academy │ Characters │ Teams │ Tournaments │ Missions │ Social │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     APPLICATION SERVICES                    │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │  MutationPipeline │  │        TabManager              │  │
│  │  (mutation        │  │  (navigation)                 │  │
│  │   orchestration)   │  │                               │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │     Database      │  │        ActivityLog             │  │
│  │  (persistence)    │  │  (activity history)            │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │    DataLoader    │  │         State                   │  │
│  │  (readiness)     │  │  (UI state)                    │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         UI UTILITIES                        │
│                                                             │
│  ┌─────────────┐  ┌───────────┐  ┌─────────────────────┐   │
│  │  DomUtils   │  │ FormUtils │  │      Modal          │   │
│  │  (DOM ops)  │  │ (forms)   │  │  (modal lifecycle)  │   │
│  └─────────────┘  └───────────┘  └─────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              NotificationSystem                     │    │
│  │              (toast notifications)                  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       CORE UTILITIES                        │
│                                                             │
│  ┌─────────────┐  ┌───────────┐  ┌─────────────────────┐   │
│  │  CoreUtils  │  │  IdUtils  │  │   ObjectUtils       │   │
│  │  (generic)  │  │  (IDs)    │  │   (cloning)         │   │
│  └─────────────┘  └───────────┘  └─────────────────────┘   │
│                                                             │
│  ┌─────────────┐  ┌───────────┐  ┌─────────────────────┐   │
│  │ FormatUtils │  │TimingUtils│  │  ValidationUtils    │   │
│  │ (formatting)│  │ (timing)  │  │  (compatibility)    │   │
│  └─────────────┘  └───────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       BROWSER APIS                         │
│                                                             │
│           DOM │ IndexedDB │ Crypto │ Timer                 │
└─────────────────────────────────────────────────────────────┘
```

## Single Sources of Truth

| Responsibility | Owner | Accessor |
|----------------|-------|----------|
| ID Generation | `IdUtils` | `IdUtils.generateId()` |
| Deep Cloning | `ObjectUtils` | `ObjectUtils.deepClone()` |
| HTML Escaping | `DomUtils` | `DomUtils.escapeHtml()` |
| Notifications | `NotificationSystem` | `NotificationSystem.notify()` |
| Modal Lifecycle | `Modal` | `Modal.showModal()` / `Modal.closeModal()` |
| Application Data | `window.data` | Direct access |
| UI State | `AppState` | `getState()` / `setState()` |
| Session State | `SessionState` | `getSession()` / `setSession()` |
| Navigation | `TabManager` | `TabManager.getCurrentTab()` |
| Mutations | `MutationPipeline` | `MutationPipeline.performMutation()` |
| Activity Logging | `ActivityLog` | `ActivityLog.record()` |
| Data Persistence | `Database` | `window.saveData()` / `window.loadData()` |
| Data Readiness | `DataLoader` | `DataLoader.whenReady()` |

## Module Descriptions

### Core Utilities (No Dependencies)

#### `core-utils.js`
Generic primitives with no domain knowledge.

**Functions:**
- Type checking: `isPlainObject`, `isSafeInteger`, `isPositiveInteger`, `isFiniteNumber`, `isNonNegativeNumber`
- Integer parsing: `parseOptionalInteger`, `parsePositiveInteger`, `parseStrictPositiveInteger`, `parseNonNegativeInteger`, `hasValue`, `getIntegerInfo`
- ID generation: `generateId`
- Deep clone: `deepClone`
- Formatting: `formatDate`, `truncateString`
- Number: `clamp`
- Array: `isNonEmptyArray`, `last`, `first`, `unique`
- String: `capitalize`, `titleCase`, `kebabCase`, `snakeCase`

**Dependencies:** None

---

#### `id-utils.js`
ID generation - single source of truth.

**Functions:**
- `generateId(prefix)` - Uses crypto.randomUUID with fallback

**Dependencies:** None (uses browser crypto)

---

#### `object-utils.js`
Object manipulation - single source of truth for cloning.

**Functions:**
- `deepClone(value)` - Uses structuredClone with JSON fallback, throws on failure
- `isPlainObject(value)`
- `isJsonSerializable(value)`

**Dependencies:** None

---

#### `format-utils.js`
Pure formatting functions.

**Functions:**
- `formatDate(dateString, fallback)` - Localized date formatting with timezone awareness
- `truncateString(value, length)` - String truncation
- `truncateWithSuffix(value, length, suffix)`
- `formatNumber(value, fallback)` - Number with commas
- `formatCurrency(value, currency, fallback)`
- `formatPercentage(value, decimals, fallback)`

**Dependencies:** None

---

#### `timing-utils.js`
Function timing utilities.

**Functions:**
- `throttle(fn, limit)` - Leading-edge throttle
- `debounce(fn, wait)` - Trailing-edge debounce
- `once(fn)` - Run once, cache result

**Dependencies:** None

---

#### `validation-utils.js`
**DEPRECATED** - Delegates to CoreUtils. Kept for backward compatibility.

**Dependencies:** CoreUtils

---

### UI Utilities (Browser DOM)

#### `dom-utils.js`
Low-level DOM operations.

**Functions:**
- Escaping: `escapeHtml`, `escapeAttribute`, `encodeUrlComponent`, `sanitizeCssValue`
- Safe HTML: `safeHtml`, `safeAttr`, `safeAttrs`
- Element creation: `createElement`, `createDiv`, `createSpan`, `createButton`, `createLabel`, `createInput`, `createSelect`, `createOption`
- Traversal: `closest`, `findAll`, `findOne`, `getData`, `setData`, `removeData`, `matches`
- Events: `delegate`
- Manipulation: `empty`, `remove`, `prepend`, `insertAfter`, `insertBefore`, `replace`, `toggleClass`, `addClass`, `removeClass`, `hasClass`
- Scroll: `scrollIntoView`, `scrollToTop`
- Visibility: `isVisible`, `isFullyVisible`
- Style: `setStyles`, `getStyle`

**Dependencies:** None

---

#### `form-utils.js`
Form serialization and validation.

**Functions:**
- `getField(id)` - Get single field value
- `setField(id, value)` - Set single field value
- `getFormData(form)` - Get all form data
- `setFormData(form, data)` - Set all form data
- `resetForm(form)`
- `validateRequired(id)` - Field has value
- `validateNumber(id)` - Field is finite number
- `validateInteger(id)` - Field is finite integer
- `validateRange(id, min, max)` - Field is in range

**Semantics:**
- Single checkbox → boolean
- Multiple checkboxes → array of values
- Radio group → selected value
- Multi-select → array of values

**Dependencies:** None

---

#### `modal.js`
Modal lifecycle management.

**Functions:**
- `createModal(className)` - Create modal element
- `showModal(modal)` - Show with animation
- `hideModal(modal)` - Hide with animation (returns Promise)
- `closeModal(modal)` - Full cleanup and removal (returns Promise)
- `modalClickOutside(modal, onClose)` - Click outside to close
- `modalEscapeKey(modal, onClose)` - Escape key to close
- `modalSetup(modal, onClose)` - Both click-outside and escape

**Features:**
- Race-condition safe with generation tracking
- Focus management (save/restore)
- ARIA attributes for accessibility
- Prevents duplicate setup

**Dependencies:** DomUtils

---

#### `notification.js`
Toast notification system.

**Functions:**
- `notify(message, type, duration, onDismiss)` - Show notification
- `notifySuccess(message, duration, onDismiss)`
- `notifyError(message, duration, onDismiss)`
- `notifyWarning(message, duration, onDismiss)`
- `notifyInfo(message, duration, onDismiss)`
- `clearNotifications()` - Clear all
- `getNotificationCount()`
- `setMaxNotifications(max)`
- `getMaxNotifications()`

**Features:**
- Unique ID-based identity (not message text)
- Reliable onDismiss callbacks (called exactly once)
- Queue management
- Persistent notifications (duration 0)
- Auto-dismiss with configurable duration

**Dependencies:** IdUtils

---

### Core Services

#### `activity-log.js`
Application activity logging infrastructure.

**Functions:**
- `record(message, type)` - Record activity
- `getHistory()` - Get activity history
- `clearHistory()` - Clear all activities
- `getCount()` - Get activity count

**Behavior:**
- Non-fatal: logging failures don't propagate
- Trims to 100 entries (newest first)
- Does not create `window.data` if missing

**Dependencies:** IdUtils, window.data

---

#### `database.js`
IndexedDB persistence with migration.

**Functions:**
- `loadData()` - Load from IndexedDB (Promise)
- `saveData()` - Save to IndexedDB (Promise, coalesced)
- `autoLoadData()` - Load with event dispatch
- `getDatabaseStatus()` - 'uninitialized' | 'initializing' | 'ready' | 'failed'
- `isDatabaseReady()` - boolean
- `getLoadError()` - Error or null

**Features:**
- Coalescing save queue with frozen batches
- Versioned data migration (DATA_VERSION)
- Single source of truth (`_data` is authoritative, `window.data` is reference)
- Strict cloning (structuredClone required)
- DB_VERSION (structural) and DATA_VERSION (schema) are separate

**Dependencies:** None

---

#### `loader.js`
Data readiness adapter.

**Functions:**
- `whenReady(callback)` - Callback when data is ready (or null on failure)
- `getData()` - Returns window.data or null
- `getStatus()` - 'ready' | 'failed' | 'waiting' | 'uninitialized'
- `getError()` - Error or null
- `reset()` - Reset loader state

**Behavior:**
- Does NOT own data (window.data is the source)
- Can recover from failure (not terminal)
- Checks current state if event was missed

**Dependencies:** window.data, window.db

---

#### `state.js`
UI state management (ephemeral).

**Functions:**
- `getState(module, key)` - Get UI state value
- `setState(module, key, value)` - Set UI state value
- `updateState(module, updates)` - Batch update
- `getModuleState(module)` - Get entire module state
- `resetModuleState(module)` - Reset to defaults
- `resetAllState()` - Reset all UI state
- `getStateSnapshot(includeSession)` - For debugging
- `getStateDiff()` - For debugging

**State Categories:**
- `AppState` - UI state that survives view switches
- `SessionState` - Very ephemeral UI state (menu open, last tab)
- `window.data` - Persistent domain data

**Features:**
- Development warnings for unknown keys
- Input validation for week values
- Object identity preserved on reset

**Dependencies:** None

---

#### `tab-manager.js`
Tab navigation system.

**Functions:**
- `register(tabName, renderFn)` - Register tab
- `switchTo(tabName, updateHistory)` - Switch tab
- `forceRefresh(tabName)` - Force refresh
- `refreshCurrent()` - Refresh current tab
- `getCurrentTab()` - Get current tab
- `isTabActive(tabName)` - Check if active
- `getTabContainer(tabName)` - Get container
- `onDataReady()` - Called by bootstrap when data is ready
- `destroy()` - Clean up event listeners

**Features:**
- Event delegation for navigation clicks (no node cloning)
- URL hash synchronization
- Tab registration with late rendering
- Read-only state via getters
- tabChanged is informational only

**Dependencies:** DataLoader

---

#### `mutation-pipeline.js`
Mutation orchestration with transaction semantics.

**Functions:**
- `performMutation(config)` - Full mutation pipeline
- `simpleMutation(logMessage, successMessage, failureMessage, mutateFn, validateFn)` - Convenience wrapper
- `createSafeBackup(data)` - Creates backup via ObjectUtils
- `saveWithPromise(options)` - Wraps saveData()

**Pipeline:**
```
VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI COMMIT
```

**Features:**
- Serialised mutations (prevents rollback conflicts)
- Rollback on mutation or persistence failure
- Uses ActivityLog for logging
- Uses NotificationSystem for notifications
- Uses ObjectUtils for cloning

**Dependencies:** Database, ActivityLog, NotificationSystem, ObjectUtils

---

#### `bootstrap.js`
Connects infrastructure components.

**Functions:**
- `bootstrap()` - Called automatically on DOM ready

**Responsibility:**
- Bridges DataLoader → TabManager
- Explicit data readiness notification

**Dependencies:** DataLoader, TabManager

---

## Dependency Graph

```
                        ┌─────────────────────────────────────┐
                        │            DOMAIN MODULES           │
                        │  Academy │ Characters │ Teams │ etc. │
                        └─────────────────────────────────────┘
                                      │
                                      ▼
              ┌─────────────────────────────────────────────────────┐
              │                   Bootstrap                        │
              │        (connects DataLoader → TabManager)          │
              └─────────────────────────────────────────────────────┘
                                      │
                                      ▼
    ┌─────────────────┬───────────────┴───────────────┬─────────────────┐
    │                 │                               │                 │
    ▼                 ▼                               ▼                 ▼
┌─────────┐    ┌─────────────┐                ┌─────────────┐    ┌─────────┐
│ TabManager│    │MutationPipeline│                │  ActivityLog  │    │ Database │
└─────────┘    └─────────────┘                └─────────────┘    └─────────┘
    │                 │                               │                 │
    │                 │                               │                 │
    ▼                 ▼                               ▼                 ▼
┌─────────┐    ┌─────────────┐                ┌─────────────┐    ┌─────────┐
│ DataLoader│    │ Notification │                │   IdUtils   │    │ ObjectUtils│
└─────────┘    └─────────────┘                └─────────────┘    └─────────┘
    │                 │                               │                 │
    ▼                 ▼                               ▼                 │
┌─────────┐    ┌─────────────┐                                       │
│ Database │    │   DomUtils  │                                       │
└─────────┘    └─────────────┘                                       │
    │                 │                                               │
    ▼                 ▼                                               │
┌─────────┐    ┌─────────────┐                                       │
│ IndexedDB│    │  CoreUtils  │◄─────────────────────────────────────┘
└─────────┘    └─────────────┘
```

## Script Loading Order

```html
<!-- 1. Core Utilities (no dependencies) -->
<script src="js/core/core-utils.js"></script>
<script src="js/utils/id-utils.js"></script>
<script src="js/utils/object-utils.js"></script>
<script src="js/utils/format-utils.js"></script>
<script src="js/utils/timing-utils.js"></script>
<script src="js/utils/validation-utils.js"></script>

<!-- 2. UI Utilities (depends on core-utils) -->
<script src="js/utils/dom-utils.js"></script>
<script src="js/utils/form-utils.js"></script>
<script src="js/utils/modal.js"></script>
<script src="js/utils/notification.js"></script>

<!-- 3. Core Services (depends on utils) -->
<script src="js/core/activity-log.js"></script>
<script src="js/core/database.js"></script>
<script src="js/core/loader.js"></script>
<script src="js/core/state.js"></script>

<!-- 4. Application Services (depends on core) -->
<script src="js/core/tab-manager.js"></script>
<script src="js/core/mutation-pipeline.js"></script>

<!-- 5. Bootstrap (connects everything) -->
<script src="js/core/bootstrap.js"></script>

<!-- 6. Domain Modules -->
<script src="js/modules/dashboard.js"></script>
<script src="js/modules/characters.js"></script>
<script src="js/modules/teams.js"></script>
<script src="js/modules/tournaments.js"></script>
<script src="js/modules/curriculum.js"></script>
<script src="js/modules/missions.js"></script>
<script src="js/modules/social.js"></script>
```

## Migration Notes

### Deprecated APIs

| Old API | New API |
|---------|---------|
| `ValidationUtils.parseOptionalPeriod()` | `CoreUtils.parseOptionalInteger()` |
| `ValidationUtils.parsePositivePeriod()` | `CoreUtils.parsePositiveInteger()` |
| `ValidationUtils.parseStrictPositivePeriod()` | `CoreUtils.parseStrictPositiveInteger()` |
| `ValidationUtils.hasPeriodValue()` | `CoreUtils.hasValue()` |
| `ValidationUtils.getPeriodInfo()` | `CoreUtils.getIntegerInfo()` |
| `ValidationUtils.isObject()` | `CoreUtils.isPlainObject()` |
| `DomUtils.throttle()` | `TimingUtils.throttle()` |
| `DomUtils.debounce()` | `TimingUtils.debounce()` |
| `DomUtils.once()` | `TimingUtils.once()` |
| `DomUtils.getField()` | `FormUtils.getField()` |
| `DomUtils.setField()` | `FormUtils.setField()` |
| `DomUtils.getFormData()` | `FormUtils.getFormData()` |
| `DomUtils.setFormData()` | `FormUtils.setFormData()` |
| `DomUtils.resetForm()` | `FormUtils.resetForm()` |
| `DomUtils.validateRequired()` | `FormUtils.validateRequired()` |
| `DomUtils.validateNumber()` | `FormUtils.validateNumber()` |
| `DomUtils.validateInteger()` | `FormUtils.validateInteger()` |
| `DomUtils.validateRange()` | `FormUtils.validateRange()` |
| `DomUtils.createModal()` | `Modal.createModal()` |
| `DomUtils.showModal()` | `Modal.showModal()` |
| `DomUtils.hideModal()` | `Modal.hideModal()` |
| `DomUtils.closeModal()` | `Modal.closeModal()` |
| `DomUtils.modalClickOutside()` | `Modal.modalClickOutside()` |
| `DomUtils.modalEscapeKey()` | `Modal.modalEscapeKey()` |
| `DomUtils.modalSetup()` | `Modal.modalSetup()` |
| `DomUtils.notify()` | `NotificationSystem.notify()` |
| `DomUtils.notifySuccess()` | `NotificationSystem.notifySuccess()` |
| `DomUtils.notifyError()` | `NotificationSystem.notifyError()` |
| `DomUtils.notifyWarning()` | `NotificationSystem.notifyWarning()` |
| `DomUtils.notifyInfo()` | `NotificationSystem.notifyInfo()` |
| `SessionState.toast` | `NotificationSystem.notify()` |
| `MutationUtils` | `MutationPipeline` |

### Removed Features
- `CoreUtils.set()` - Mutated its argument, removed
- `DomUtils.escapeUrl()` - Use `encodeUrlComponent()`
- `window.logActivity` - Use `ActivityLog.record()`
- `window.getDefaultMagicProficiencies` - Use `db.getDefaultMagicProficiencies()`

## Testing Considerations

1. **Dependency Injection**: Modules use global `window` for dependencies. For testing, mock `window` dependencies.
2. **State Isolation**: `AppState` and `SessionState` are mutable. Reset between tests with `resetAllState()` and `resetSession()`.
3. **Database Mocking**: Mock `window.db` and `window.saveData()` for unit tests.
4. **DOM Utilities**: Use `jsdom` or similar for DOM testing.
5. **Event Listeners**: Use `TabManager.destroy()` to clean up between tests.

## Performance Considerations

1. **Save Queue**: Database saves are coalesced to reduce IndexedDB writes
2. **Event Delegation**: Tab navigation uses event delegation (one listener per container)
3. **Notification Queue**: Notifications are queued to prevent DOM explosion
4. **State Setters**: State changes are synchronous; no re-render triggers
5. **Deep Cloning**: Used only for rollback snapshots; not for frequent operations

## Future Considerations

1. **Async Renderers**: If rendering becomes async, TabManager will need to handle async render functions
2. **Multiple Modals**: If stacked modals are needed, Modal will need a stack manager
3. **Data Versioning**: DATA_VERSION will increment with schema changes
4. **IndexedDB Structural Changes**: DB_VERSION will increment if object stores change
5. **PWA Support**: Service worker and offline support would be an extension of Database
```