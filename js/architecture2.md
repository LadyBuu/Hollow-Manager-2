# HollowBlades Architecture

## Overview

HollowBlades is a single-page application for managing a fantasy academy, characters, teams, tournaments, missions, and social relationships. The architecture follows a strict layered design with clear ownership boundaries and single sources of truth.

---

## Architecture Principles

1. **Single Source of Truth** - Each concept has one authoritative owner
2. **Clear Dependency Direction** - Low-level utilities have no dependencies; higher-level modules depend on them
3. **No Domain Knowledge in Utilities** - Generic utilities don't know about HollowBlades concepts
4. **UI State is Ephemeral** - UI state is not persisted; domain data is persisted via IndexedDB
5. **Serialised Mutations** - All mutations are serialised to prevent rollback conflicts
6. **Explicit Bridges** - Infrastructure components communicate via explicit APIs, not magic events
7. **Render-Only Views** - Views render data, they do not mutate it
8. **Query Layer** - Read operations are separated from mutations

---

## Layer Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DOMAIN MODULES                                   │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │  Academy    │ │ Characters  │ │   Teams     │ │    Tournaments      │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘  │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │  Missions   │ │   Social    │ │  Calendar   │ │    Curriculum       │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         APPLICATION SERVICES                               │
│                                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────────────────────┐   │
│  │   MutationPipeline   │    │              TabManager                │   │
│  │   (mutation           │    │            (navigation)                │   │
│  │    orchestration)     │    │                                         │   │
│  └─────────────────────┘    └─────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────────────────────┐   │
│  │      Database       │    │            ActivityLog                 │   │
│  │    (persistence)    │    │         (activity history)              │   │
│  └─────────────────────┘    └─────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────────────────────┐   │
│  │     DataLoader      │    │              State                     │   │
│  │    (readiness)      │    │           (UI state)                   │   │
│  └─────────────────────┘    └─────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────────────────────┐   │
│  │     Bootstrap       │    │            CalendarUI                  │   │
│  │    (startup)        │    │        (calendar controller)           │   │
│  └─────────────────────┘    └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            QUERY LAYER                                     │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │ Character   │ │  Classes    │ │   Team      │ │    Social           │  │
│  │ Queries     │ │  Queries    │ │  Queries    │ │    Queries          │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘  │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │ Instructor  │ │  Location   │ │  Discipline │ │    Calendar         │  │
│  │ Queries     │ │  Queries    │ │  Queries    │ │    Queries          │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         UI UTILITIES                                       │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │  DomUtils   │ │  FormUtils  │ │    Modal    │ │   CalendarRenderer  │  │
│  │  (DOM ops)  │ │  (forms)    │ │  (modals)   │ │   (grid rendering)  │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    NotificationSystem                               │   │
│  │                 (toast notifications)                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CORE UTILITIES                                     │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │  CoreUtils  │ │   IdUtils   │ │ ObjectUtils │ │   FormatUtils       │  │
│  │  (generic)  │ │   (IDs)     │ │  (cloning)  │ │   (formatting)      │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘  │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │ TimingUtils │ │Validation   │ │ Calendar    │ │   Calendar          │  │
│  │  (timing)   │ │  Utils      │ │ Constants   │ │   Constants         │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BROWSER APIS                                       │
│                                                                             │
│              DOM │ IndexedDB │ Crypto │ Timer                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

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
| Calendar Constants | `CalendarConstants` | `window.CalendarConstants` |
| Schedule Keys | `ScheduleCore` | `ScheduleCore.getScheduleKey()` |
| Relationship Types | `SocialConstants` | `SocialConstants.getRelationshipTypes()` |
| Magic Constants | `MagicConstants` | `window.MagicConstants` |

---

## Character Module Architecture

### Overview

The Character module is a feature module that handles all character-related functionality, including CRUD operations, class management, eliminations, stats, special moves, and detail views.

### Module Structure

```
modules/characters/
├── index.js                    # Feature entry point
├── character-constants.js      # Character-specific constants
├── character-queries.js        # Read-only character queries
├── character-crud.js           # CRUD operations (uses MutationPipeline)
├── character-classes.js        # Class membership (uses MutationPipeline)
├── character-eliminations.js   # Elimination management (uses MutationPipeline)
├── character-stats.js          # Stats and magic domain logic
├── character-stats-view.js     # Stats UI rendering (no domain logic)
├── character-form.js           # Form rendering and data collection (no events)
├── character-events.js         # Event orchestration
├── character-list.js           # Character list rendering
├── character-detail.js         # Detail view (uses queries)
├── character-detail-queries.js # Detail view model composition
├── character-class-view.js     # Class UI rendering (no mutations)
├── character-elimination-view.js # Elimination UI rendering (no mutations)
├── character-views.js          # Academic/professional/social views
└── character-generator.js      # Random character generation (pure)
```

### Data Flow

```
User Action
    │
    ▼
CharacterEvents (orchestration)
    │
    ├── CharacterForm.collect() → DTO
    │
    ├── CharacterCRUD.save(dto) → MutationPipeline
    │
    ├── CharacterQueries (read)
    │
    └── CharacterClassView (render)
```

### Mutation Flow

```
CharacterEvents
    │
    ▼
CharacterCRUD.save(dto)
    │
    ▼
MutationPipeline.performMutation({
    validate: validateCharacter,
    mutate: function(data) { ... },
    logMessage: '...',
    successMessage: '...'
})
    │
    ▼
Database.saveData()
```

### Dependency Graph

```
Characters/index
    │
    ├── TabManager (registration)
    │
    ├── CharacterList (rendering)
    │       ├── CharacterQueries
    │       ├── ClassesQueries
    │       └── EliminationQueries
    │
    ├── CharacterForm (rendering)
    │       ├── CharacterQueries
    │       ├── CharacterCRUD
    │       ├── CharacterGenerator
    │       ├── CharacterConstants
    │       ├── ClassesQueries
    │       └── FormUtils
    │
    ├── CharacterEvents (orchestration)
    │       ├── CharacterQueries
    │       ├── CharacterCRUD
    │       ├── CharacterForm
    │       ├── CharacterClassView
    │       ├── CharacterEliminationView
    │       ├── CharacterGenerator
    │       ├── FormUtils
    │       └── NotificationSystem
    │
    ├── CharacterCRUD (mutations)
    │       ├── MutationPipeline
    │       ├── CharacterQueries
    │       ├── IdUtils
    │       └── CharacterConstants
    │
    ├── CharacterDetail (views)
    │       ├── CharacterDetailQueries
    │       ├── CharacterQueries
    │       ├── CharacterStats
    │       └── Modal
    │
    └── CharacterStats (domain)
            ├── MutationPipeline
            ├── CharacterQueries
            ├── CharacterConstants
            └── MagicConstants
```

---

## Calendar Module Architecture

### Overview

The Calendar module manages academic scheduling for students, instructors, and locations. It uses a registry pattern for modes, a query layer for read operations, and core modules for mutations.

### Module Structure

```
modules/calendar/
├── index.js                      # Feature entry point
├── calendar-ui.js                # UI controller
├── calendar-renderer.js          # Shared grid rendering
├── calendar-utils.js             # Calendar utilities
│
├── constants/
│   └── calendar-constants.js     # Shared with module
│
├── core/
│   ├── index.js                  # Public API facade
│   ├── schedule-core.js          # Schedule semantics
│   ├── schedule-integrity.js     # Schedule validation
│   ├── metadata-core.js          # Metadata operations
│   ├── student-core.js           # Student schedule mutations
│   ├── instructor-core.js        # Instructor mutations
│   └── location-core.js          # Location mutations
│
├── queries/
│   ├── instructor-queries.js     # Instructor read model
│   └── location-queries.js       # Location read model
│
├── views/
│   ├── instructor-view.js        # Instructor rendering
│   └── location-view.js          # Location rendering
│
└── modes/
    ├── index.js                  # Mode registry
    ├── instructor.js             # Instructor mode
    └── location.js               # Location mode
```

### Data Flow

```
CalendarUI
    │
    ├── CalendarModes (registry)
    │       ├── InstructorMode
    │       ├── LocationMode
    │       └── StudentMode
    │
    ├── Mode.render()
    │       │
    │       ├── Queries (read)
    │       │
    │       ├── View (render)
    │       │
    │       └── Core (mutations) → MutationPipeline → Database
    │
    └── CalendarRenderer (shared grid)
```

### Registry Pattern

```
CalendarModes
    │
    ├── registerMode(name, mode)
    ├── getMode(name)
    ├── getModeNames()
    ├── getModeOptions()
    ├── hasMode(name)
    └── getModeCount()

Mode Contract:
    {
        label: string,
        hint: string,
        render(container, state): void,
        getEntities(): array,
        getEntityDisplayName(entity): string,
        getData(state): object
    }
```

### Mutation Flow

```
Mode (UI)
    │
    ▼
MutationUtils.performMutation({
    validate: function() { ... },
    mutate: function() { ... },
    logMessage: '...',
    successMessage: '...'
})
    │
    ▼
CalendarCore (facade)
    │
    ▼
Specific Core (student/instructor/location)
    │
    ▼
Database.saveData()
```

### Dependency Graph

```
Calendar/index
    │
    ├── TabManager (registration)
    │
    ├── CalendarUI (controller)
    │       ├── CalendarModes (registry)
    │       ├── CalendarConstants
    │       ├── CalendarUtils
    │       └── DomUtils
    │
    ├── CalendarRenderer (grid rendering)
    │       ├── CalendarConstants
    │       └── DomUtils
    │
    ├── CalendarModes (registry)
    │
    ├── InstructorMode
    │       ├── InstructorQueries
    │       ├── InstructorView
    │       ├── InstructorCore
    │       ├── CalendarRenderer
    │       └── MutationUtils
    │
    ├── LocationMode
    │       ├── LocationQueries
    │       ├── LocationView
    │       ├── LocationCore
    │       ├── CalendarRenderer
    │       └── MutationUtils
    │
    └── CalendarCore (facade)
            ├── StudentCore
            ├── InstructorCore
            ├── LocationCore
            ├── GridCore
            └── MetadataCore
```

---

## Social Module Architecture

### Overview

The Social module manages relationships between characters with types, dates, and notes. It includes a graph visualization of the social network.

### Module Structure

```
modules/social/
├── index.js                  # Feature entry point
├── social-constants.js       # Relationship type definitions
├── social-queries.js         # Read-only social queries
├── social-core.js            # Relationship mutations (uses MutationPipeline)
├── social-views.js           # Rendering (no mutations)
├── social-graph.js           # Graph visualization (render-only)
└── social-events.js          # Event orchestration
```

### Data Flow

```
User Action
    │
    ▼
SocialEvents (orchestration)
    │
    ├── SocialViews.render()
    │
    ├── SocialGraph.render()
    │
    └── SocialCore.createRelationship()
            │
            ▼
    MutationPipeline.performMutation()
            │
            ▼
    Database.saveData()
```

### Relationship Semantics

- Multiple relationships between same characters allowed
- Each relationship has a single type
- Mentor relationships are directional: character1 → character2
- All other relationship types are undirected

### Dependency Graph

```
Social/index
    │
    ├── TabManager (registration)
    │
    ├── SocialEvents (orchestration)
    │       ├── SocialCore (mutations)
    │       ├── SocialViews (rendering)
    │       ├── SocialQueries (read)
    │       ├── SocialGraph (visualization)
    │       ├── Modal
    │       └── NotificationSystem
    │
    ├── SocialCore (mutations)
    │       ├── MutationPipeline
    │       ├── SocialQueries
    │       ├── SocialConstants
    │       └── CharacterQueries
    │
    ├── SocialViews (rendering)
    │       ├── SocialQueries
    │       ├── SocialConstants
    │       └── CharacterQueries
    │
    ├── SocialGraph (visualization)
    │       ├── SocialQueries
    │       └── CharacterQueries
    │
    └── SocialQueries (read)
            ├── SocialConstants
            └── CharacterQueries
```

---

## Core Modules Architecture

### Shared Constants

```
modules/shared/
├── calendar-constants.js     # Calendar constants
├── character-constants.js    # Character constants
├── magic-constants.js        # Magic constants
└── social-constants.js       # Social constants
```

### Core Utilities

```
core/
├── core-utils.js             # Generic utilities
├── id-utils.js               # ID generation
├── object-utils.js           # Deep cloning
├── format-utils.js           # Formatting
├── timing-utils.js           # Throttle/debounce/once
├── validation-utils.js       # Validation (delegates to CoreUtils)
├── activity-log.js           # Activity logging
├── database.js               # IndexedDB persistence
├── loader.js                 # Data readiness
├── state.js                  # UI state
├── tab-manager.js            # Navigation
├── mutation-pipeline.js      # Mutation orchestration
└── bootstrap.js              # Startup wiring
```

### UI Utilities

```
utils/
├── dom-utils.js              # DOM operations
├── form-utils.js             # Form serialization
├── modal.js                  # Modal lifecycle
└── notification.js           # Toast notifications
```

---

## Script Loading Order

```html
<!-- 1. Core Utilities (no dependencies) -->
<script src="js/core/core-utils.js"></script>
<script src="js/utils/id-utils.js"></script>
<script src="js/utils/object-utils.js"></script>
<script src="js/utils/format-utils.js"></script>
<script src="js/utils/timing-utils.js"></script>
<script src="js/utils/validation-utils.js"></script>

<!-- 2. Shared Constants -->
<script src="js/modules/shared/calendar-constants.js"></script>
<script src="js/modules/shared/character-constants.js"></script>
<script src="js/modules/shared/magic-constants.js"></script>
<script src="js/modules/shared/social-constants.js"></script>

<!-- 3. UI Utilities (depends on core-utils) -->
<script src="js/utils/dom-utils.js"></script>
<script src="js/utils/form-utils.js"></script>
<script src="js/utils/modal.js"></script>
<script src="js/utils/notification.js"></script>

<!-- 4. Core Services (depends on utils) -->
<script src="js/core/activity-log.js"></script>
<script src="js/core/database.js"></script>
<script src="js/core/loader.js"></script>
<script src="js/core/state.js"></script>

<!-- 5. Application Services (depends on core) -->
<script src="js/core/tab-manager.js"></script>
<script src="js/core/mutation-pipeline.js"></script>

<!-- 6. Bootstrap (connects everything) -->
<script src="js/core/bootstrap.js"></script>

<!-- 7. Query Modules -->
<script src="js/modules/characters/character-queries.js"></script>
<script src="js/modules/classes/classes-queries.js"></script>
<script src="js/modules/teams/team-queries.js"></script>
<script src="js/modules/social/social-queries.js"></script>

<!-- 8. Calendar Core -->
<script src="js/modules/calendar/core/schedule-core.js"></script>
<script src="js/modules/calendar/core/schedule-integrity.js"></script>
<script src="js/modules/calendar/core/metadata-core.js"></script>
<script src="js/modules/calendar/core/student-core.js"></script>
<script src="js/modules/calendar/core/instructor-core.js"></script>
<script src="js/modules/calendar/core/location-core.js"></script>
<script src="js/modules/calendar/core/grid-core.js"></script>
<script src="js/modules/calendar/core/index.js"></script>

<!-- 9. Calendar Queries & Views -->
<script src="js/modules/calendar/queries/instructor-queries.js"></script>
<script src="js/modules/calendar/queries/location-queries.js"></script>
<script src="js/modules/calendar/views/instructor-view.js"></script>
<script src="js/modules/calendar/views/location-view.js"></script>

<!-- 10. Calendar Modes & UI -->
<script src="js/modules/calendar/calendar-utils.js"></script>
<script src="js/modules/calendar/calendar-renderer.js"></script>
<script src="js/modules/calendar/modes/index.js"></script>
<script src="js/modules/calendar/modes/instructor.js"></script>
<script src="js/modules/calendar/modes/location.js"></script>
<script src="js/modules/calendar/calendar-ui.js"></script>
<script src="js/modules/calendar/index.js"></script>

<!-- 11. Character Module -->
<script src="js/modules/characters/character-constants.js"></script>
<script src="js/modules/characters/character-generator.js"></script>
<script src="js/modules/characters/character-crud.js"></script>
<script src="js/modules/characters/character-classes.js"></script>
<script src="js/modules/characters/character-eliminations.js"></script>
<script src="js/modules/characters/character-stats.js"></script>
<script src="js/modules/characters/character-stats-view.js"></script>
<script src="js/modules/characters/character-class-view.js"></script>
<script src="js/modules/characters/character-elimination-view.js"></script>
<script src="js/modules/characters/character-views.js"></script>
<script src="js/modules/characters/character-form.js"></script>
<script src="js/modules/characters/character-detail-queries.js"></script>
<script src="js/modules/characters/character-detail.js"></script>
<script src="js/modules/characters/character-list.js"></script>
<script src="js/modules/characters/character-events.js"></script>
<script src="js/modules/characters/index.js"></script>

<!-- 12. Social Module -->
<script src="js/modules/social/social-core.js"></script>
<script src="js/modules/social/social-views.js"></script>
<script src="js/modules/social/social-graph.js"></script>
<script src="js/modules/social/social-events.js"></script>
<script src="js/modules/social/index.js"></script>
```

---

## Deprecated APIs

### Removed or Deprecated Functions

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
| `CalendarUtils.getDayName()` | `FormatUtils.getDayName()` |
| `CalendarUtils.formatHour()` | `FormatUtils.formatHour()` |
| `CalendarUtils.parseHour()` | `FormatUtils.parseHour()` |
| `CalendarUtils.getHourOptions()` | `CalendarConstants.getHourOptions()` |
| `CalendarUtils.isValidWeek()` | `CalendarConstants.isValidWeek()` |
| `CalendarCore.validateWeek()` | `CalendarConstants.isValidWeek()` |
| `CalendarCore.validateDay()` | `CalendarConstants.isValidDay()` |
| `CalendarCore.validateHour()` | `CalendarConstants.isValidHour()` |
| `CalendarCore.validateDuration()` | `CalendarConstants.isValidDuration()` |
| `CalendarCore.getScheduleKey()` | `ScheduleCore.getScheduleKey()` |
| `GridCore.findClassStartHour()` | `ScheduleCore.findClassStartHour()` |
| `GridCore.validateScheduleIntegrity()` | `ScheduleIntegrity.validateScheduleIntegrity()` |
| `CharacterConstants.MAGIC_*` | `MagicConstants.*` |
| `CharacterConstants.CLASS_DEFINITIONS` | Academy domain |
| `constants.js.MAGIC_CONSTANTS` | `MagicConstants.*` |
| `constants.js.CLASS_DEFINITIONS` | Academy domain |

### Removed Features
- `CoreUtils.set()` - Mutated its argument, removed
- `DomUtils.escapeUrl()` - Use `encodeUrlComponent()`
- `window.logActivity` - Use `ActivityLog.record()`
- `window.getDefaultMagicProficiencies` - Use `db.getDefaultMagicProficiencies()`
- `window.CALENDAR_CONSTANTS` - Use `CalendarConstants.*`
- `window.MAGIC_CONSTANTS` - Use `MagicConstants.*`

---

## Testing Considerations

1. **Dependency Injection**: Modules use global `window` for dependencies. For testing, mock `window` dependencies.
2. **State Isolation**: `AppState` and `SessionState` are mutable. Reset between tests with `resetAllState()` and `resetSession()`.
3. **Database Mocking**: Mock `window.db` and `window.saveData()` for unit tests.
4. **DOM Utilities**: Use `jsdom` or similar for DOM testing.
5. **Event Listeners**: Use `TabManager.destroy()` to clean up between tests.
6. **Mutation Pipeline**: Mock `MutationUtils.performMutation()` for testing domain operations.

---

## Performance Considerations

1. **Save Queue**: Database saves are coalesced to reduce IndexedDB writes
2. **Event Delegation**: Tab navigation uses event delegation (one listener per container)
3. **Notification Queue**: Notifications are queued to prevent DOM explosion
4. **State Setters**: State changes are synchronous; no re-render triggers
5. **Deep Cloning**: Used only for rollback snapshots; not for frequent operations
6. **Query Caching**: Query modules read fresh from `window.data`; no caching
7. **Lazy Loading**: Calendar modes load only when selected

---

## Future Considerations

1. **Async Renderers**: If rendering becomes async, TabManager will need to handle async render functions
2. **Multiple Modals**: If stacked modals are needed, Modal will need a stack manager
3. **Data Versioning**: `DATA_VERSION` will increment with schema changes
4. **IndexedDB Structural Changes**: `DB_VERSION` will increment if object stores change
5. **PWA Support**: Service worker and offline support would be an extension of Database
6. **Multi-Tenant**: If multi-tenant support is needed, data isolation would be required
7. **WebSockets**: Real-time collaboration would require event synchronization