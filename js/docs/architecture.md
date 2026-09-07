# HollowBlades Architecture - Updated Documentation

## Overview

HollowBlades is a single-page application for managing a fantasy academy, characters, teams, tournaments, missions, social relationships, and academic scheduling. The architecture follows a strict layered design with clear ownership boundaries and single sources of truth.

## Architecture Principles

1. **Single Source of Truth** - Each concept has one authoritative owner
2. **Clear Dependency Direction** - Low-level utilities have no dependencies; higher-level modules depend on them
3. **No Domain Knowledge in Utilities** - Generic utilities don't know about HollowBlades concepts
4. **UI State is Ephemeral** - UI state is not persisted; domain data is persisted via IndexedDB
5. **Serialised Mutations** - All mutations are serialised to prevent rollback conflicts
6. **Explicit Bridges** - Infrastructure components communicate via explicit APIs, not magic events
7. **Mutation Pipeline** - All mutations flow through MutationPipeline for transaction/persistence/logging
8. **Candidate-Based Mutations** - All domain mutations build candidates before committing
9. **Defensive Copies** - All query getters return defensive copies to prevent accidental mutation

## Layer Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             DOMAIN MODULES                                 │
│                                                                             │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐│
│  │ Characters│  │  Teams    │  │Tournaments│  │  Missions │  │  Social   ││
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘│
│                                                                             │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐              │
│  │  Academy  │  │ Calendar  │  │ Curriculum│  │  Classes  │              │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           APPLICATION SERVICES                             │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────────────────────┐  │
│  │   MutationPipeline   │  │              TabManager                     │  │
│  │  (mutation           │  │  (navigation)                              │  │
│  │   orchestration)     │  │                                             │  │
│  └─────────────────────┘  └─────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────────────────────┐  │
│  │      Database        │  │              ActivityLog                   │  │
│  │  (persistence)       │  │  (activity history)                        │  │
│  └─────────────────────┘  └─────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────────────────────┐  │
│  │     DataLoader       │  │              State                         │  │
│  │  (readiness)         │  │  (UI state)                               │  │
│  └─────────────────────┘  └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UI UTILITIES                                  │
│                                                                             │
│  ┌─────────────┐  ┌───────────┐  ┌─────────────────────────────────────┐  │
│  │  DomUtils   │  │ FormUtils │  │              Modal                   │  │
│  │  (DOM ops)  │  │ (forms)   │  │  (modal lifecycle)                  │  │
│  └─────────────┘  └───────────┘  └─────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       NotificationSystem                            │    │
│  │                       (toast notifications)                         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CORE UTILITIES                                 │
│                                                                             │
│  ┌─────────────┐  ┌───────────┐  ┌─────────────────────────────────────┐  │
│  │  CoreUtils  │  │  IdUtils  │  │            ObjectUtils               │  │
│  │  (generic)  │  │  (IDs)    │  │   (cloning)                         │  │
│  └─────────────┘  └───────────┘  └─────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────┐  ┌───────────┐  ┌─────────────────────────────────────┐  │
│  │ FormatUtils │  │TimingUtils│  │          CalendarConstants          │  │
│  │ (formatting)│  │ (timing)  │  │  (calendar bounds, day names)      │  │
│  └─────────────┘  └───────────┘  └─────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────┐  ┌───────────┐  ┌─────────────────────────────────────┐  │
│  │CalendarVali-│  │Academy    │  │          CalendarScheduleCore       │  │
│  │ dation      │  │Constants  │  │  (schedule semantics)               │  │
│  └─────────────┘  └───────────┘  └─────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       Constants (global)                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER APIS                                  │
│                                                                             │
│                     DOM │ IndexedDB │ Crypto │ Timer                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Single Sources of Truth

| Responsibility | Owner | Accessor |
|----------------|-------|----------|
| ID Generation | `IdUtils` | `IdUtils.generateId()` |
| ID Normalisation | `IdUtils` | `IdUtils.normaliseId()` |
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
| Calendar Validation | `CalendarValidation` | `CalendarValidation.parseWeek()` |
| Calendar Constants | `CalendarConstants` | `CalendarConstants.MIN_WEEK` |
| Schedule Semantics | `CalendarScheduleCore` | `CalendarScheduleCore.findClassStartHour()` |
| Tournament Structure | `TournamentsSchema` | `TournamentsSchema.validateTournament()` |
| Tournament Lifecycle | `TournamentLifecycle` | `TournamentLifecycle.canEditTournament()` |
| Tournament Queries | `TournamentsQueries` | `TournamentsQueries.getTournaments()` |
| Mission Structure | `MissionsSchema` | `MissionsSchema.validateMission()` |
| Mission Rules | `MissionRules` | `MissionRules.calculateProgress()` |
| Mission Views | `MissionViews` | `MissionViews.getPriorityInfo()` |

## Module Descriptions

### Core Utilities (No Dependencies)

#### `core-utils.js`
Generic primitives with no domain knowledge.

**Functions:**
- Type checking: `isPlainObject`, `isSafeInteger`, `isPositiveInteger`, `isFiniteNumber`, `isNonNegativeNumber`
- Integer parsing: `parseOptionalInteger`, `parsePositiveInteger`, `parseStrictPositiveInteger`, `parseNonNegativeInteger`, `hasValue`, `getIntegerInfo`
- Array: `isNonEmptyArray`, `last`, `first`, `unique`
- String: `capitalize`, `titleCase`, `kebabCase`, `snakeCase`

**Dependencies:** None

---

#### `id-utils.js`
ID generation and normalisation - single source of truth.

**Functions:**
- `generateId(prefix)` - Uses crypto.randomUUID with fallback
- `normaliseId(value)` - Strict ID normalisation (strings only, rejects objects/numbers)

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
- `formatNumber(value, fallback)` - Number with commas
- `formatCurrency(value, currency, fallback)`
- `formatPercentage(value, decimals, fallback)`
- `getDayName(day, format)` - Day name lookup (Monday=1)
- `getDayName0(day, format)` - Day name lookup (Sunday=0)
- `getDayNumber(dayName)` - Day number from day name
- `formatHour(hour, includeMinutes)` - 12-hour with AM/PM
- `parseHour(timeStr)` - Parse time string to hour

**Dependencies:** CalendarConstants (optional, with fallbacks)

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

### Shared Constants

#### `constants.js`
Truly global application constants.

**Constants:**
- `CALENDAR_CONSTANTS` - Week, day, hour ranges
- `ID_CONSTANTS` - ID prefixes for all entity types
- `DATA_CONSTANTS` - Data version and migration constants
- `UI_CONSTANTS` - Breakpoints (minimal)

**Dependencies:** None

---

#### `shared/calendar-constants.js`
Single source of truth for calendar constants.

**Constants:**
- `MIN_WEEK`, `MAX_WEEK` - Week bounds
- `MIN_DAY`, `MAX_DAY`, `DAYS_IN_WEEK` - Day bounds
- `MIN_HOUR`, `MAX_HOUR`, `CALENDAR_START_HOUR`, `CALENDAR_END_HOUR` - Hour bounds
- `MIN_CLASS_DURATION`, `MAX_CLASS_DURATION` - Duration bounds
- `MIN_YEAR`, `MAX_YEAR` - Year bounds
- `WEEKS_PER_BLOCK` - Academic block size

**Functions:**
- `isValidWeek()`, `isValidDay()`, `isValidHour()`, `isValidDuration()`, `isValidYear()`
- `getDayName()`, `getDayName0()`, `getDayNumber()`
- `formatHour()`, `parseHour()`, `getHourOptions()`
- `getWeekBlock()`, `getAllWeekBlocks()`, `getWeekBlockNumber()`, `getBlockRange()`

**Dependencies:** None

---

#### `calendar-validation.js`
Canonical calendar validation - single source of truth for all calendar value validation.

**Functions:**
- Week: `parseWeek()`, `isWeekValid()`
- Day: `parseDay()`, `isDayValid()`
- Hour: `parseHour()`, `isHourValid()`, `parseCalendarHour()`, `isCalendarHourValid()`
- Duration: `parseDuration()`, `isDurationValid()`
- Year: `parseYear()`, `isYearValid()`
- Slot: `parseSlot()`, `isSlotValid()`
- Range: `parseInRange()`, `isInRange()`
- Bounds: `getWeekBounds()`, `getDayBounds()`, `getHourBounds()`, `getDurationBounds()`, `getYearBounds()`, `getCalendarHourBounds()`

**Dependencies:** CalendarConstants

---

#### `academy-constants.js`
Single source of truth for Academy-specific constants.

**Constants:**
- `ACADEMY_SUBTABS` - Sub-tab definitions: `{ id, label }`
- `VALID_SUB_TAB_IDS` - Array of valid sub-tab IDs
- `SUB_TAB_LABELS` - Map of ID to label
- `MAX_TEAM_SIZE` - Maximum students per team
- `MIN_SCORE`, `MAX_SCORE`, `PASSING_THRESHOLD` - Grade thresholds

**Dependencies:** None

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
- `confirm(message)` - Show confirmation dialog

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

**Dependencies:** None

---

#### `loader.js`
Data readiness adapter.

**Functions:**
- `whenReady(callback)` - Callback when data is ready
- `getData()` - Returns window.data or null
- `getStatus()` - 'ready' | 'failed' | 'waiting' | 'uninitialized'
- `getError()` - Error or null
- `reset()` - Reset loader state

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

**Dependencies:** DataLoader

---

#### `mutation-pipeline.js`
Mutation orchestration with transaction semantics.

**Pipeline:**
```
VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI COMMIT
```

**Functions:**
- `performMutation(config)` - Full mutation pipeline
- `simpleMutation(logMessage, successMessage, failureMessage, mutateFn, validateFn)` - Convenience wrapper
- `createSafeBackup(data)` - Creates backup via ObjectUtils
- `saveWithPromise(options)` - Wraps saveData()

**Dependencies:** Database, ActivityLog, NotificationSystem, ObjectUtils

---

#### `bootstrap.js`
Connects infrastructure components.

**Functions:**
- `bootstrap()` - Called automatically on DOM ready

**Dependencies:** DataLoader, TabManager

---

### Tournament Domain

#### `modules/tournaments/tournaments-schema.js`
Single source of truth for tournament structure and validation.

**Constants:**
- `VALID_STATUSES`, `VALID_MODES`, `VALID_MATCH_TYPES`, `VALID_MATCH_STATUSES`, `VALID_PARTICIPANT_TYPES`, `VALID_GROUP_EXAM_RESULTS`
- `LIFECYCLE_RULES` - Declarative lifecycle rules
- `MIN_WEEK`, `MAX_WEEK`

**Functions:**
- `normaliseId(value)` - ID normalisation (delegates to IdUtils)
- `cloneTournament()` - Exact defensive copy (preserves all properties)
- `normaliseTournament()` - Canonical structural representation
- `deriveAdvancing(match)` - Canonical advancing derivation
- `deriveLoser(participants, winner)` - Canonical loser derivation
- `validateTournament(tournament, options)` - Structural validation

**Dependencies:** CALENDAR_CONSTANTS, ObjectUtils, IdUtils

---

#### `modules/tournaments/tournament-lifecycle.js`
Single source of truth for tournament lifecycle rules.

**Functions:**
- `getLifecycleRules(status)` - Get lifecycle rules for a status
- `canEditTournament()` - Check if tournament can be edited
- `canModifyParticipants()` - Check if participants can be modified
- `canModifyEliminations()` - Check if eliminations can be modified
- `canModifyRounds()` - Check if rounds can be modified
- `canCompleteTournament()` - Check if tournament can be completed
- `canAddRound()` - Check if a round can be added
- `isStatusTerminal()` - Check if status is terminal
- `isStatusMutable()` - Check if any mutation is allowed
- `getLifecycleStatus(tournament)` - Complete lifecycle status

**Dependencies:** TournamentsSchema

---

#### `modules/tournaments/tournaments-core.js`
Canonical mutation API for tournaments.

**Functions:**
- `getTournament(id)` - Get tournament (defensive copy)
- `getTournaments()` - Get all tournaments (defensive copies)
- `createTournament(data)` - Create new tournament
- `updateTournament(id, updates)` - Update existing tournament
- `deleteTournament(id)` - Delete tournament
- `addParticipant(tournamentId, participant)` - Add participant
- `removeParticipant(tournamentId, participantId)` - Remove participant
- `addRound(tournamentId, roundData)` - Add round
- `removeRound(tournamentId, roundIndex)` - Remove round
- `completeTournament(tournamentId, force)` - Complete tournament

**Dependencies:** TournamentsSchema, TournamentLifecycle, CharacterQueries, TeamQueries, CalendarValidation, IdUtils, ObjectUtils

---

#### `modules/tournaments/tournaments-matches.js`
Canonical match mutation API for tournaments.

**Functions:**
- `addMatch()` - Add a match
- `removeMatch()` - Remove a match
- `updateMatch()` - Update a match
- `completeMatch()` - Complete a match
- `setGroupExamResult()` - Set group exam result
- `setMatchWinner()` - Set match winner
- `getRoundMatches()` - Get matches for a round (defensive copies)
- `getMatch()` - Get a match (defensive copy)

**Dependencies:** TournamentsSchema, TournamentLifecycle, TournamentsCore, ObjectUtils, IdUtils

---

#### `modules/tournaments/tournament-elimination-workflow.js`
Cross-domain elimination operations.

**Functions:**
- `markCharacterEliminated()` - Mark character eliminated
- `unmarkCharacterEliminated()` - Restore character
- `isCharacterEliminated()` - Check if eliminated
- `getCharacterEliminations()` - Get character eliminations

**Dependencies:** TournamentsCore, TournamentsSchema, TournamentLifecycle, CharacterQueries, CalendarValidation, IdUtils

---

#### `modules/tournaments/tournaments-queries.js`
PURE read-only tournament queries.

**Functions:**
- `getTournaments()` - Get all tournaments (defensive copies)
- `getTournament(id)` - Get tournament (defensive copy)
- `getParticipantRecord()` - Get participant record
- `getParticipantType()` - Get participant type
- `getParticipantName()` - Get participant name
- `getRoundParticipants()` - Get participants in a round
- `getParticipantRoundStatus()` - Get participant status
- `getRoundStatus()` - Get round status
- `getMatch()` - Get match (defensive copy)
- `getMatchAdvancing()` - Get advancing participants (derived)
- `getWinner()` - Get winner (defensive copy)
- `isTournamentComplete()` - Check if complete (query projection)

**Dependencies:** TournamentsSchema, CharacterQueries, TeamQueries, IdUtils

---

#### `modules/tournaments/tournaments-render.js`
PURE rendering functions for tournaments.

**Functions:**
- `renderList()` - Render tournament list
- `renderDetail()` - Render tournament detail
- `renderInfo()` - Render tournament info section
- `renderParticipants()` - Render participants section
- `renderRounds()` - Render rounds section
- `renderEliminations()` - Render eliminations section
- `renderWinner()` - Render winner section
- `renderForm()` - Render tournament form
- `renderMatchForm()` - Render match form

**Dependencies:** TournamentsQueries, CalendarConstants, CalendarValidation

---

#### `modules/tournaments/tournaments-ui.js`
Tournament UI controller.

**Functions:**
- `render()` - Render tournaments
- `viewTournament()` - View tournament
- `closeDetail()` - Close tournament detail
- `showForm()` - Show tournament form

**Dependencies:** TournamentsCore, TournamentsRender, TournamentsQueries, TournamentsMatches, NotificationSystem, Modal, TabManager, ClassesQueries

---

#### `modules/tournaments/tournaments-repair.js`
Explicit repair functions for legacy/malformed tournament data.

**Functions:**
- `repairTournament()` - Repair a single tournament
- `repairAllTournaments()` - Repair all tournaments (atomic in-memory)
- `validateTournament()` - Validate against schema
- `needsRepair()` - Check if repair is needed

**Dependencies:** TournamentsSchema, IdUtils, CalendarValidation, ObjectUtils

---

### Mission Domain

#### `modules/missions/missions-schema.js`
Single source of truth for mission structure and validation.

**Constants:**
- `VALID_STATUSES`, `VALID_PRIORITIES`, `VALID_DIFFICULTIES`, `VALID_BILLING_TYPES`, `VALID_ESCALATION_TIERS`
- `DIFFICULTY_CODES` - E, M, H, X
- `MISSION_TYPES` - Mission taxonomy (combat, recovery, investigation, etc.)

**Functions:**
- `validateMission(mission)` - Structural validation
- `canonicaliseMissionShape(input)` - Structural canonicalisation only (no business derivation)
- `getMissionType()`, `getMissionTypeLabel()` - Type helpers
- `getSubtypeLabel()`, `getEscalationLabel()`, `getBillingLabel()` - Label helpers
- `isValidStatus()`, `isValidPriority()`, `isValidDifficulty()` - Predicates (return booleans)

**Dependencies:** CalendarValidation, IdUtils

---

#### `modules/missions/mission-views.js`
Presentation metadata for missions.

**Functions:**
- `getPriorityLabel()`, `getPriorityColor()`, `getPriorityClass()`, `getPriorityInfo()`
- `getStatusLabel()`, `getStatusColor()`, `getStatusClass()`, `getStatusInfo()`
- `getDifficultyLabel()`, `getDifficultyCode()`
- `getEscalationLabel()`, `getBillingLabel()`
- `getMissionTypeLabel()`, `getMissionTypeIcon()`, `getMissionTypeColor()`, `getMissionTypeInfo()`
- `getSubtypeLabel()`
- `formatMissionId()`, `parseMissionId()`

**Dependencies:** MissionsSchema

---

#### `modules/missions/mission-rules.js`
Single source of truth for mission derivation and lifecycle rules.

**Functions:**
- `calculateProgress(objectives)` - Pure function
- `calculatePay(basePay, surchargePay)` - Pure function
- `deriveStatus(originalStatus, progress, objectives)` - Status derivation
- `deriveCompletedAt(originalStatus, proposedStatus, originalCompletedAt, progress, policy)` - Timestamp rules
- `canModifyObjectives(mission)` - Objective mutability check
- `shouldAutoComplete(mission)` - Auto-completion predicate
- `isTeamEligibleForMission(team)` - Team eligibility
- `filterEligibleTeams(teams)` - Filter eligible teams
- `recalculateMission(mission, completedAtPolicy)` - Complete recalculation

**Dependencies:** MissionsSchema

---

#### `modules/missions/mission-id.js`
Mission ID generation and parsing.

**Functions:**
- `generateMissionId(teamId, year, difficulty, existingIds)` - Generate next ID
- `generateMissionIdPreview(teamId, year, difficulty, sequence)` - Preview ID
- `parseMissionId(missionId)` - Parse into components
- `validateMissionIdFormat(missionId)` - Validate format
- `formatMissionId(missionId)` - Format for display
- `getMissionIdTeam()`, `getMissionIdYear()`, `getMissionIdDifficulty()` - Component extraction

**Dependencies:** TeamQueries, MissionsQueries, CalendarConstants, MissionsSchema

---

#### `modules/missions/missions-core.js`
Canonical mutation API for missions.

**Functions:**
- `createMission(data)` - Create new mission
- `updateMission(id, updates)` - Update existing mission
- `deleteMission(id)` - Delete mission
- `toggleObjective(missionId, objectiveIndex)` - Toggle objective
- `addObjective(missionId, text)` - Add objective
- `removeObjective(missionId, objectiveIndex)` - Remove objective
- `addLog(missionId, message)` - Add log entry
- `addSupportPersonnel(missionId, characterId)` - Add support personnel
- `removeSupportPersonnel(missionId, characterId)` - Remove support personnel
- `completeMission(missionId)` - Complete mission
- `cancelMission(missionId)` - Cancel mission
- `reactivateMission(missionId)` - Reactivate mission

**Dependencies:** MissionsSchema, MissionRules, MissionsQueries, CharacterQueries, TeamQueries, IdUtils, ObjectUtils

---

#### `modules/missions/missions-queries.js`
PURE read-only mission queries.

**Functions:**
- `getMission(id)` - Get mission (defensive copy)
- `getMissions(filter)` - Get missions (defensive copies)
- `getMissionsByType(typeId)` - Get missions by type
- `getMissionsByTeam(teamId, filter)` - Get missions by team
- `getMissionsByTag(tag, filter)` - Get missions by tag
- `getUniqueTags(filter)` - Get unique tags (normalised)
- `searchMissions(query, filter)` - Search missions
- `getSupportPersonnel(mission)` - Get support personnel (defensive copies)
- `getSupportPersonnelNames(mission)` - Get support personnel names
- `getMissionTypeCounts()` - Get type counts
- `getStatistics()` - Get mission statistics
- `getActiveCount()`, `getCompletedCount()`, `getCancelledCount()` - Count helpers
- `getEligibleTeams()` - Get eligible teams for mission assignment

**Dependencies:** MissionsSchema, MissionRules, CharacterQueries, TeamQueries, IdUtils, ObjectUtils

---

#### `modules/missions/missions-render.js`
PURE rendering functions for missions.

**Functions:**
- `renderList(missions)` - Render mission list
- `renderForm(formModel)` - Render mission form (receives complete model)
- `renderDetail(mission)` - Render mission detail
- `renderContainer()` - Render main container
- `renderModals()` - Render modal HTML
- `renderEmpty(message)` - Render empty state
- `renderLoading()` - Render loading state

**Dependencies:** MissionsQueries, MissionViews, DomUtils

---

#### `modules/missions/missions-ui.js`
Mission UI controller.

**Functions:**
- `render(container)` - Render missions
- `view(id)` - View mission
- `closeDetail()` - Close mission detail
- `showForm(editId)` - Show mission form
- `renderList(container)` - Render mission list
- `destroy()` - Destroy controller

**Dependencies:** MissionsCore, MissionsQueries, MissionsRender, MissionViews, NotificationSystem, Modal, TabManager, IdUtils

---

#### `modules/missions/index.js`
Mission module entry point.

**Functions:**
- `renderMissions(container)` - Mount the missions feature
- `destroyMissions()` - Destroy the missions feature
- `viewMission(id)` - View a mission
- `closeMissionDetail()` - Close mission detail
- `showMissionForm(editId)` - Show mission form

**Dependencies:** MissionsUI

---

### Academy Domain

#### `modules/academy/index.js`
Academy module entry point and lifecycle controller.

**Functions:**
- `mountAcademy(container)` - Mount the academy feature
- `destroyAcademy()` - Clean up and unmount
- `refresh()` - Refresh current view
- `getState()` - Get current UI state
- `selectClass()`, `selectWeek()`, `selectStudent()`, `selectInstructor()`, `switchSubTab()`, `clearSelections()` - State mutators

**Dependencies:** TabManager, AcademyState, AcademyViews, AcademyEvents, DomUtils, NotificationSystem

---

#### `modules/academy/academy-state.js`
Academy UI state management with persistence.

**Functions:**
- `getState()` - Get full state
- `selectClass(id)`, `selectWeek(week)`, `selectStudent(id)`, `selectInstructor(id)`, `switchSubTab(tab)` - State setters
- `setState(newState)` - Bulk state update
- `resetState()`, `clearSelections()` - State resets
- `isValidWeek()`, `isValidClass()`, `isValidStudent()`, `isValidInstructor()`, `isValidSubTabValue()` - Validation

**Dependencies:** CalendarValidation, AcademyConstants, ClassesQueries, CharacterQueries

---

#### `modules/academy/academy-views.js`
Academy shell and sub-tab rendering.

**Functions:**
- `renderAcademy(state)` - Complete Academy UI
- `renderAcademyShell(state)` - Header + tabs + placeholder
- `renderAcademyTabs(activeSubTab)` - Navigation tabs
- `renderActiveSubTab(state)` - Delegates to tab modules

**Dependencies:** AcademyConstants, ClassTab, StudentTab, FacultyTab, DomUtils

---

#### `modules/academy/academy-events.js`
Academy event binding (events only - no rendering).

**Functions:**
- `init(container)` - Bind all events
- `destroy()` - Remove all event listeners
- `addSafeEventListener()` - Tracked event binding

**Dependencies:** AcademyState, ClassTab, StudentTab, FacultyTab

---

#### `modules/academy/academy-queries.js`
Academy-specific composite read models.

**Functions:**
- Class queries: `getClasses()`, `getClass()`, `getClassStudents()`, `getClassStats()`
- Character queries: `getCharacterById()`, `getDisplayName()`, `getStudents()`, `getInstructors()`
- Academic team queries: `getAcademicTeams()`, `getAcademicTeamMembers()`
- Tournament queries: `getTournaments()`, `getTournament()`
- Discipline queries: `getDiscipline()`, `getDisciplines()`, `getAvailableDisciplines()`
- Location queries: `getLocation()`, `getLocations()`
- Auto-group queries: `getAllAutoGroups()`, `getAutoGroup()`

**Dependencies:** ClassesQueries, CharacterQueries, TeamQueries, TournamentQueries, DisciplineQueries, LocationQueries, AcademyGroups

---

#### `modules/academy/academy-core.js`
Academy domain core operations.

**Functions:**
- Class operations: `getClasses()`, `getClass()`, `createClass()`, `updateClass()`, `deleteClass()`, `addCharacterToClass()`, `removeCharacterFromClass()`
- Discipline operations: `getDisciplines()`, `getDiscipline()`, `getAvailableDisciplines()`, `createDiscipline()`, `updateDiscipline()`, `deleteDiscipline()`
- Location operations: `getLocations()`, `getLocation()`, `createLocation()`, `updateLocation()`, `deleteLocation()`
- Academy state: `getCurrentWeek()`, `setCurrentWeek()`

**Dependencies:** ObjectUtils, IdUtils, CharacterQueries, ClassesQueries, ClassesCore, CalendarValidation, CalendarConstants

---

#### `modules/academy/academy-grades.js`
Grade domain operations.

**Functions:**
- Queries: `getGrades()`, `getGrade()`, `hasGrade()`, `getWeekGrades()`
- Summary: `calculateSummary()`, `getClassSummary()`
- Mutations (candidate builders): `buildSaveGradesCandidate()`, `buildSaveGradeCandidate()`, `buildDeleteGradeCandidate()`, `buildDeleteWeekGradesCandidate()`, `buildDeleteStudentGradesCandidate()`, `buildSaveClassGradesCandidate()`
- Validation: `validateScore()`

**Dependencies:** ObjectUtils, CharacterQueries, ClassesQueries, DisciplineQueries, CalendarValidation, CalendarConstants

---

#### `modules/academy/academy-ranking.js`
Ranking domain operations.

**Functions:**
- Queries: `getRankings()`, `getStudentRank()`, `hasRankings()`, `getRankingCount()`, `getRankingsWithDetails()`, `getStudentRankingHistory()`
- Class ranking: `getClassRankings()`, `getClassRankingSummary()`
- Statistics: `getRankingStatistics()`, `getRankingDistribution()`, `getTopRankedStudents()`
- Mutations (candidate builders): `buildSetRankingsCandidate()`, `buildAutoGenerateCandidate()`, `buildSetStudentPositionCandidate()`, `buildRemoveStudentCandidate()`, `buildClearRankingsCandidate()`
- Validation: `validateRank()`

**Dependencies:** ObjectUtils, CharacterQueries, ClassesQueries, AcademyGrades, CalendarValidation, CalendarConstants

---

#### `modules/academy/academy-schedule.js`
Academy schedule policy and operations.

**Functions:**
- Queries: `getStudentSchedule()`, `getStudentRestDays()`, `getClassDetails()`, `getDayClasses()`
- Conflict detection: `hasConflict()`, `getConflicts()`
- Availability: `getAvailableSlots()`, `getFreeTime()`
- Weekly hour usage: `getWeeklyHourUsage()`, `getDisciplineHourUsage()`, `getRemainingWeeklyHours()`
- Summary: `getStudentScheduleSummary()`
- Mutations (candidate builders): `buildSetClassCandidate()`, `buildRemoveClassCandidate()`, `buildClearScheduleCandidate()`, `buildDuplicateScheduleCandidate()`, `buildSetRestDaysCandidate()`

**Dependencies:** CalendarCore, ObjectUtils, CharacterQueries, DisciplineQueries, CalendarValidation, CalendarConstants

---

#### `modules/academy/academy-groups.js`
Auto-group domain operations.

**Functions:**
- Queries: `getAllAutoGroups()`, `getAutoGroup()`, `getGroupsByDiscipline()`, `getGroupsByInstructor()`, `getGroupStudents()`, `getGroupSlots()`, `isStudentInGroup()`, `getGroupsForStudent()`, `getGroupsForWeek()`
- Summaries: `getGroupSummary()`, `getAllGroupSummaries()`, `getGroupDisplayName()`
- Mutations (candidate builders): `buildCreateGroupCandidate()`, `buildDeleteGroupCandidate()`, `buildAddStudentCandidate()`, `buildRemoveStudentCandidate()`, `buildAddSlotCandidate()`, `buildRemoveSlotCandidate()`, `buildAddStudentsCandidate()`, `buildRemoveStudentsCandidate()`

**Dependencies:** ObjectUtils, IdUtils, CharacterQueries, DisciplineQueries, CalendarValidation, CalendarConstants

---

#### `modules/academy/academy-distribute.js`
Cross-domain student distribution workflow.

**Functions:**
- `buildDistributionPlan(classId, week, maxTeamSize, teamIds, options)` - Build plan without mutation
- `executeDistributionPlan(plan, options)` - Execute plan via MutationPipeline

**Dependencies:** ClassesQueries, TeamQueries, TeamCore, CharacterQueries, DisciplineQueries, CalendarScheduleCore, CalendarValidation, CalendarConstants, ObjectUtils

---

#### `modules/academy/tabs/class-tab.js`
Class sub-tab UI.

**Functions:**
- `render(state)` - Render class tab
- `renderClassList(state)` - Class list
- `renderClassDetail(state, cls)` - Class detail with roster, teams, tournaments
- `bindEvents(container)` - Bind class tab events

**Dependencies:** ClassesCore, TeamCore, AcademyDistribute, AcademyQueries, CharacterQueries, CalendarConstants, NotificationSystem, DomUtils, Modal

---

#### `modules/academy/tabs/student-tab.js`
Student sub-tab UI.

**Functions:**
- `render(state)` - Render student tab
- `renderStudentDetail(state, student)` - Student detail with grades, ranking, schedule
- `renderGradesTab(state, student)` - Grade entry and summary
- `renderRankingTab(state, student)` - Ranking display
- `renderScheduleTab(state, student)` - Schedule grid with rest days
- `bindEvents(container)` - Bind student tab events

**Dependencies:** AcademyGrades, AcademyRanking, AcademySchedule, AcademyQueries, CharacterQueries, CharacterList, CalendarConstants, NotificationSystem, DomUtils, Modal

---

#### `modules/academy/tabs/faculty-tab.js`
Faculty sub-tab UI.

**Functions:**
- `render(state)` - Render faculty tab
- `renderInstructorsView(state, instructors)` - Instructor list and detail
- `renderInstructorDetail(state, instructor)` - Instructor schedule and blocks
- `renderLocationsView(state)` - Location schedule
- `renderAutoGroupsView(state)` - Auto-group management
- `renderDisciplinesView(state)` - Discipline/curriculum management
- `bindEvents(container)` - Bind faculty tab events

**Dependencies:** CalendarCore, AcademyGroups, AcademyQueries, CharacterQueries, CalendarConstants, NotificationSystem, DomUtils, Modal

---

### Calendar Domain

#### `modules/calendar/index.js`
Calendar module entry point.

**Functions:**
- `renderCalendar(container)` - Mount the calendar feature
- `destroyCalendar()` - Destroy calendar

**Dependencies:** CalendarUI, CalendarModes, CalendarUtils, CalendarRenderer, TabManager, CalendarConstants, CalendarValidation

---

#### `modules/calendar/calendar-ui.js`
Calendar UI controller.

**Functions:**
- `init(container, options, callbacks)` - Initialize calendar UI
- `render()` - Re-render current view
- `destroy()` - Clean up event listeners
- `getState()` / `setState()` - State management

**Dependencies:** CalendarModes, CalendarUtils, DomUtils, CalendarConstants, CalendarValidation

---

#### `modules/calendar/calendar-renderer.js`
Shared calendar grid renderer.

**Functions:**
- `renderGrid(container, state, data)` - Render calendar grid
- `bindEvents(container, state, callbacks)` - Bind calendar events
- `createAddClassModal(options)` - Create add class modal
- `createDetailsModal(options)` - Create details modal
- `createManageStudentsModal(options)` - Create manage students modal
- `buildOccupiedMap(schedule, getDuration)` - Build occupied hour map
- `hasOverlap(occupiedMap, day, startHour, duration)` - Check overlap

**Dependencies:** CalendarConstants, CalendarValidation, DomUtils

---

#### `modules/calendar/calendar-utils.js`
Calendar domain utilities.

**Functions:**
- `getWeekBlock(weekNum)`, `getAllWeekBlocks()`, `getWeekBlockNumber(weekNum)`, `getBlockRange(blockNum)`
- `getWeekNumber(date)`, `getAcademicWeek(date, startWeek)`, `getISOWeekNumber(date)`
- `getFirstDayOfWeek(date, firstDayOfWeek)`, `getLastDayOfWeek(date, firstDayOfWeek)`, `getWeekDateRange(weekNum, year, firstDayOfWeek)`

**Dependencies:** CalendarConstants, CalendarValidation

---

#### `modules/calendar/core/index.js`
Calendar core public API facade.

**Functions:**
- Delegates to StudentCore, InstructorCore, LocationCore, GridCore, MetadataCore

**Dependencies:** CalendarStudentCore, CalendarInstructorCore, CalendarLocationCore, CalendarGridCore, CalendarMetadataCore

---

#### `modules/calendar/core/schedule-core.js`
Shared schedule semantics - CANONICAL.

**Functions:**
- `getScheduleKey(studentId, week, day, hour)` - Generate schedule key
- `parseScheduleKey(key)` - Parse schedule key
- `hasConflict(schedule, day, hour, duration)` - Check conflict
- `hasDurationOverlap(entries, day, hour, duration)` - Check duration overlap
- `findClassStartHour(schedule, durations, studentId, week, day, hour)` - Find class start
- `validateOccupiedDuration(schedule, day, startHour, disciplineId)` - Validate duration
- `getValidClassDuration(durations, key)` - Get valid duration
- `getClassRange(schedule, durations, studentId, week, day, hour)` - Get class range
- `getAvailableStartHours(schedule, day, duration, startHour, endHour)` - Get available start hours
- `getNextAvailableStartHour(schedule, day, duration, fromHour)` - Get next available start hour

**Dependencies:** CalendarConstants, CalendarValidation

---

#### `modules/calendar/core/metadata-core.js`
Calendar metadata operations.

**Functions:**
- `getClassMetadata(curriculum, studentId, week, day, hour)` - Get class metadata
- `getValidClassDuration(curriculum, key)` - Get valid duration
- `buildCandidates(curriculum)` - Build metadata candidates
- `commitCandidates(curriculum, candidates)` - Commit metadata candidates
- `setClassMetadata(candidates, key, data)` - Set metadata
- `copyClassMetadata(candidates, sourceKey, targetKey)` - Copy metadata
- `deleteClassMetadata(candidates, key)` - Delete metadata
- `clearMetadataForPrefix(candidates, prefix)` - Clear metadata by prefix
- `hasClassMetadata(curriculum, key)` - Check if class has metadata
- `getKeysForStudentWeek(curriculum, studentId, week)` - Get metadata keys
- `getStore(curriculum, storeKey)` - Get metadata store

**Dependencies:** ObjectUtils, CalendarConstants, CalendarValidation, CalendarScheduleCore

---

#### `modules/calendar/core/student-core.js`
Student schedule operations.

**Functions:**
- `getStudentSchedule(studentId, week)` - Get student schedule
- `setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration)` - Set class
- `removeStudentScheduleClass(studentId, week, day, hour)` - Remove class
- `duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite)` - Duplicate schedule
- `clearStudentSchedule(studentId, week)` - Clear schedule
- `getStudentRestDays(studentId, week)` - Get rest days
- `setStudentRestDays(studentId, week, days)` - Set rest days

**Dependencies:** ObjectUtils, CalendarConstants, CalendarValidation, CalendarScheduleCore, CalendarMetadataCore, DisciplineQueries, CharacterQueries

---

#### `modules/calendar/core/instructor-core.js`
Instructor template and block operations.

**Functions:**
- `getInstructorTemplates(instructorId, week)` - Get templates
- `setInstructorTemplate(instructorId, week, day, hour, templateData)` - Set template
- `removeInstructorTemplate(instructorId, week, day, hour)` - Remove template
- `getInstructorBlocks(instructorId, week)` - Get blocks
- `setInstructorBlock(instructorId, week, day, hour, blockData)` - Set block
- `removeInstructorBlock(instructorId, week, day, hour)` - Remove block

**Dependencies:** ObjectUtils, CalendarConstants, CalendarValidation, CalendarScheduleCore, DisciplineQueries, CharacterQueries

---

#### `modules/calendar/core/location-core.js`
Location schedule operations.

**Functions:**
- `getLocationSchedule(locationId, week)` - Get location schedule
- `setLocationClass(locationId, week, day, hour, disciplineId)` - Assign class
- `removeLocationClass(locationId, week, day, hour)` - Remove class
- `clearLocationSchedule(locationId, week)` - Clear schedule
- `getClassLocation(studentId, week, day, hour)` - Get class location
- `setClassLocation(studentId, week, day, hour, locationId)` - Set class location

**Dependencies:** ObjectUtils, CalendarConstants, CalendarValidation, CalendarScheduleCore, CalendarMetadataCore, DisciplineQueries, LocationQueries

---

#### `modules/calendar/core/grid-core.js`
Calendar grid construction and occupancy helpers.

**Functions:**
- `buildGrid(schedule, options)` - Build calendar grid
- `getOccupiedHours(schedule, day)` - Get occupied hours
- `getAvailableHours(schedule, day, startHour, endHour)` - Get available hours
- `getAvailableStartHours(schedule, day, duration, startHour, endHour)` - Get available start hours
- `getContinuousOccupiedHours(schedule, day, hour)` - Get continuous occupied hours
- `hasOccupiedHours(schedule, day)` - Check if day has occupied hours
- `getOccupiedDays(schedule)` - Get occupied days
- `getTotalOccupiedHours(schedule)` - Get total occupied hours
- `getTotalAvailableHours(schedule, startHour, endHour)` - Get total available hours

**Dependencies:** CalendarScheduleCore, CalendarConstants, CalendarValidation

---

#### `modules/calendar/core/schedule-integrity.js`
Schedule integrity validation.

**Functions:**
- `validateScheduleIntegrity(schedule, metadata, studentId, week)` - Comprehensive validation
- `checkForOrphanMetadata(schedule, metadata, studentId, week)` - Check orphan metadata
- `checkForGaps(schedule, durations, studentId, week)` - Check gaps
- `checkForOverlaps(schedule, durations, studentId, week)` - Check overlaps
- `findOccupiedRuns(schedule)` - Find occupied runs

**Dependencies:** CalendarScheduleCore, CalendarConstants, CalendarValidation

---

#### `modules/calendar/modes/index.js`
Calendar modes registry.

**Functions:**
- `registerMode(name, mode)` - Register a mode
- `getMode(name)` - Get a mode
- `getModeNames()` - Get all mode names
- `getModeOptions()` - Get mode options for UI
- `hasMode(name)` - Check if mode exists
- `getModeCount()` - Get number of registered modes

**Dependencies:** None

---

#### `modules/calendar/modes/student.js`
Student calendar mode.

**Functions:**
- `render(container, state)` - Render student calendar
- `getEntities()` - Get students
- `getEntityDisplayName(entity)` - Get student display name
- `getData(state)` - Get student schedule data

**Dependencies:** CalendarUtils, CalendarRenderer, CalendarModes, CalendarConstants, CalendarValidation

---

#### `modules/calendar/modes/instructor.js`
Instructor calendar mode.

**Functions:**
- `render(container, state)` - Render instructor calendar
- `getEntities()` - Get instructors
- `getEntityDisplayName(entity)` - Get instructor display name
- `getData(state)` - Get instructor schedule data

**Dependencies:** InstructorQueries, InstructorView, CalendarRenderer, CalendarUtils, CalendarConstants, CalendarValidation, CalendarModes, CalendarInstructorCore, MutationUtils, CharacterQueries, DisciplineQueries

---

#### `modules/calendar/modes/location.js`
Location calendar mode.

**Functions:**
- `render(container, state)` - Render location calendar
- `getEntities()` - Get locations
- `getEntityDisplayName(entity)` - Get location display name
- `getData(state)` - Get location schedule data

**Dependencies:** LocationQueries, LocationView, CalendarRenderer, CalendarUtils, CalendarConstants, CalendarValidation, CalendarModes, CalendarLocationCore, MutationUtils, DisciplineQueries

---

#### `modules/calendar/views/instructor-view.js`
Instructor-specific rendering.

**Functions:**
- `renderInstructorSidebar(instructorId, week)` - Instructor sidebar
- `renderClassDetailsModal(data, callbacks)` - Class details modal
- `renderBlockDetailsModal(data, callbacks)` - Block details modal
- `renderManageStudentsModal(data, callbacks)` - Manage students modal
- `renderAddClassModal(data, callbacks)` - Add class modal
- `renderAvailableSlots(data, container)` - Available slots view

**Dependencies:** InstructorQueries, CharacterQueries, DisciplineQueries, CalendarRenderer, CalendarUtils, DomUtils, CalendarConstants, CalendarValidation

---

#### `modules/calendar/views/location-view.js`
Location-specific rendering.

**Functions:**
- `renderLocationSidebar(locationId, week)` - Location sidebar
- `renderLocationDetailsModal(data, callbacks)` - Location details modal
- `renderAddClassModal(data, callbacks)` - Add class modal
- `renderLocationStudentsModal(data, callbacks)` - Students at location modal
- `renderLocationUsageView(usage, container)` - Usage view
- `renderDisciplineAvailabilityView(disciplines, container)` - Discipline availability view

**Dependencies:** LocationQueries, CharacterQueries, DisciplineQueries, CalendarRenderer, CalendarUtils, DomUtils, CalendarConstants, CalendarValidation

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
<script src="js/constants.js"></script>
<script src="js/modules/shared/calendar-constants.js"></script>
<script src="js/modules/shared/character-constants.js"></script>
<script src="js/modules/shared/magic-constants.js"></script>
<script src="js/modules/shared/social-constants.js"></script>

<!-- 3. Core Validation (depends on constants) -->
<script src="js/utils/calendar-validation.js"></script>
<script src="js/modules/academy/academy-constants.js"></script>

<!-- 4. UI Utilities (depends on core-utils) -->
<script src="js/utils/dom-utils.js"></script>
<script src="js/utils/form-utils.js"></script>
<script src="js/utils/modal.js"></script>
<script src="js/utils/notification.js"></script>

<!-- 5. Core Services (depends on utils) -->
<script src="js/core/activity-log.js"></script>
<script src="js/core/database.js"></script>
<script src="js/core/loader.js"></script>
<script src="js/core/state.js"></script>

<!-- 6. Application Services (depends on core) -->
<script src="js/core/tab-manager.js"></script>
<script src="js/core/mutation-pipeline.js"></script>

<!-- 7. Bootstrap (connects everything) -->
<script src="js/core/bootstrap.js"></script>

<!-- 8. Character Domain -->
<script src="js/modules/characters/index.js"></script>
<script src="js/modules/characters/character-queries.js"></script>
<script src="js/modules/characters/character-crud.js"></script>
<script src="js/modules/characters/character-classes.js"></script>
<script src="js/modules/characters/character-eliminations.js"></script>
<script src="js/modules/characters/character-stats.js"></script>
<script src="js/modules/characters/character-stats-view.js"></script>
<script src="js/modules/characters/character-form.js"></script>
<script src="js/modules/characters/character-events.js"></script>
<script src="js/modules/characters/character-list.js"></script>
<script src="js/modules/characters/character-detail.js"></script>
<script src="js/modules/characters/character-detail-queries.js"></script>
<script src="js/modules/characters/character-class-view.js"></script>
<script src="js/modules/characters/character-elimination-view.js"></script>
<script src="js/modules/characters/character-generator.js"></script>

<!-- 9. Social Domain -->
<script src="js/modules/social/index.js"></script>
<script src="js/modules/social/social-queries.js"></script>
<script src="js/modules/social/social-core.js"></script>
<script src="js/modules/social/social-views.js"></script>
<script src="js/modules/social/social-graph.js"></script>
<script src="js/modules/social/social-events.js"></script>

<!-- 10. Calendar Core (depends on ObjectUtils, CalendarConstants, CalendarValidation) -->
<script src="js/modules/calendar/calendar-utils.js"></script>
<script src="js/modules/calendar/core/schedule-core.js"></script>
<script src="js/modules/calendar/core/metadata-core.js"></script>
<script src="js/modules/calendar/core/grid-core.js"></script>
<script src="js/modules/calendar/core/student-core.js"></script>
<script src="js/modules/calendar/core/instructor-core.js"></script>
<script src="js/modules/calendar/core/location-core.js"></script>
<script src="js/modules/calendar/core/schedule-integrity.js"></script>
<script src="js/modules/calendar/core/index.js"></script>

<!-- 11. Calendar Views and Modes -->
<script src="js/modules/calendar/views/instructor-view.js"></script>
<script src="js/modules/calendar/views/location-view.js"></script>
<script src="js/modules/calendar/modes/index.js"></script>
<script src="js/modules/calendar/modes/student.js"></script>
<script src="js/modules/calendar/modes/instructor.js"></script>
<script src="js/modules/calendar/modes/location.js"></script>
<script src="js/modules/calendar/calendar-renderer.js"></script>
<script src="js/modules/calendar/calendar-ui.js"></script>
<script src="js/modules/calendar/index.js"></script>

<!-- 12. Tournament Domain -->
<script src="js/modules/tournaments/tournaments-schema.js"></script>
<script src="js/modules/tournaments/tournament-lifecycle.js"></script>
<script src="js/modules/tournaments/tournaments-core.js"></script>
<script src="js/modules/tournaments/tournaments-matches.js"></script>
<script src="js/modules/tournaments/tournament-elimination-workflow.js"></script>
<script src="js/modules/tournaments/tournaments-queries.js"></script>
<script src="js/modules/tournaments/tournaments-render.js"></script>
<script src="js/modules/tournaments/tournaments-ui.js"></script>
<script src="js/modules/tournaments/tournaments-repair.js"></script>

<!-- 13. Mission Domain -->
<script src="js/modules/missions/missions-schema.js"></script>
<script src="js/modules/missions/mission-views.js"></script>
<script src="js/modules/missions/mission-rules.js"></script>
<script src="js/modules/missions/mission-id.js"></script>
<script src="js/modules/missions/missions-core.js"></script>
<script src="js/modules/missions/missions-queries.js"></script>
<script src="js/modules/missions/missions-render.js"></script>
<script src="js/modules/missions/missions-ui.js"></script>
<script src="js/modules/missions/index.js"></script>

<!-- 14. Academy Domain -->
<script src="js/modules/academy/academy-state.js"></script>
<script src="js/modules/academy/academy-queries.js"></script>
<script src="js/modules/academy/academy-grades.js"></script>
<script src="js/modules/academy/academy-ranking.js"></script>
<script src="js/modules/academy/academy-schedule.js"></script>
<script src="js/modules/academy/academy-groups.js"></script>
<script src="js/modules/academy/academy-distribute.js"></script>
<script src="js/modules/academy/academy-core.js"></script>

<!-- 15. Academy Tabs -->
<script src="js/modules/academy/tabs/class-tab.js"></script>
<script src="js/modules/academy/tabs/student-tab.js"></script>
<script src="js/modules/academy/tabs/faculty-tab.js"></script>

<!-- 16. Academy UI -->
<script src="js/modules/academy/academy-views.js"></script>
<script src="js/modules/academy/academy-events.js"></script>
<script src="js/modules/academy/index.js"></script>

<!-- 17. Domain Modules -->
<script src="js/modules/dashboard.js"></script>
<script src="js/modules/teams.js"></script>
```

## Module Summary

### Tournament Module Files

| File | Purpose |
|------|---------|
| `tournaments-schema.js` | Structural validation and canonical representation |
| `tournament-lifecycle.js` | Lifecycle rules and permissions |
| `tournaments-core.js` | Core mutation API |
| `tournaments-matches.js` | Match mutation API |
| `tournament-elimination-workflow.js` | Cross-domain elimination operations |
| `tournaments-queries.js` | Read-only queries |
| `tournaments-render.js` | Pure rendering |
| `tournaments-ui.js` | UI controller |
| `tournaments-repair.js` | Data repair functions |

### Mission Module Files

| File | Purpose |
|------|---------|
| `missions-schema.js` | Structural validation and canonical representation |
| `mission-views.js` | Presentation metadata |
| `mission-rules.js` | Derivation and lifecycle rules |
| `mission-id.js` | Mission ID generation and parsing |
| `missions-core.js` | Core mutation API |
| `missions-queries.js` | Read-only queries |
| `missions-render.js` | Pure rendering |
| `missions-ui.js` | UI controller |
| `index.js` | Entry point |

### Academy Module Files

| File | Purpose |
|------|---------|
| `academy/index.js` | Entry point and lifecycle controller |
| `academy/academy-state.js` | UI state management |
| `academy/academy-views.js` | Shell and sub-tab rendering |
| `academy/academy-events.js` | Event binding |
| `academy/academy-queries.js` | Composite read models |
| `academy/academy-core.js` | Domain core operations |
| `academy/academy-grades.js` | Grade domain |
| `academy/academy-ranking.js` | Ranking domain |
| `academy/academy-schedule.js` | Schedule policy |
| `academy/academy-groups.js` | Auto-group domain |
| `academy/academy-distribute.js` | Distribution workflow |
| `academy/tabs/class-tab.js` | Class sub-tab UI |
| `academy/tabs/student-tab.js` | Student sub-tab UI |
| `academy/tabs/faculty-tab.js` | Faculty sub-tab UI |

### Calendar Module Files

| File | Purpose |
|------|---------|
| `calendar/index.js` | Entry point |
| `calendar/calendar-ui.js` | UI controller |
| `calendar/calendar-renderer.js` | Shared grid renderer |
| `calendar/calendar-utils.js` | Calendar utilities |
| `calendar/core/index.js` | Core facade |
| `calendar/core/schedule-core.js` | Schedule semantics (CANONICAL) |
| `calendar/core/metadata-core.js` | Metadata operations |
| `calendar/core/student-core.js` | Student schedule operations |
| `calendar/core/instructor-core.js` | Instructor operations |
| `calendar/core/location-core.js` | Location operations |
| `calendar/core/grid-core.js` | Grid helpers |
| `calendar/core/schedule-integrity.js` | Integrity validation |
| `calendar/modes/index.js` | Modes registry |
| `calendar/modes/student.js` | Student mode |
| `calendar/modes/instructor.js` | Instructor mode |
| `calendar/modes/location.js` | Location mode |
| `calendar/views/instructor-view.js` | Instructor rendering |
| `calendar/views/location-view.js` | Location rendering |

### Core Utilities Added

| File | Purpose |
|------|---------|
| `utils/calendar-validation.js` | Canonical calendar validation |
| `modules/academy/academy-constants.js` | Academy constants |
| `modules/tournaments/tournaments-schema.js` | Tournament schema |
| `modules/tournaments/tournament-lifecycle.js` | Tournament lifecycle |
| `modules/missions/missions-schema.js` | Mission schema |
| `modules/missions/mission-views.js` | Mission views |
| `modules/missions/mission-rules.js` | Mission rules |
| `modules/missions/mission-id.js` | Mission ID |

### Files Removed

| File | Reason |
|------|--------|
| `modules/calendar/calendar-dependencies.js` | Obsolete - each mode validates its own dependencies |

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
| `AcademyQueries.validateWeek()` | `CalendarValidation.parseWeek()` |
| `AcademyGroups.validateWeek()` | `CalendarValidation.parseWeek()` |
| `AcademyRanking.validateWeek()` | `CalendarValidation.parseWeek()` |
| `AcademySchedule.validateWeek()` | `CalendarValidation.parseWeek()` |
| `AcademyGrades.validateWeek()` | `CalendarValidation.parseWeek()` |
| `AcademyDistribute.validateWeek()` | `CalendarValidation.parseWeek()` |
| `TournamentsCore.normaliseId()` | `IdUtils.normaliseId()` |
| `MissionsCore.normaliseId()` | `IdUtils.normaliseId()` |
| `MissionsCore.getMissions()` | `MissionsQueries.getMissions()` |
| `MissionsCore.getSupportPersonnel()` | `MissionsQueries.getSupportPersonnel()` |
| `MissionsQueries.getMissionTypeLabel()` | `MissionViews.getMissionTypeLabel()` |
| `MissionsQueries.getPriorityInfo()` | `MissionViews.getPriorityInfo()` |
| `MissionsQueries.getStatusInfo()` | `MissionViews.getStatusInfo()` |
| `MissionsQueries.formatMissionId()` | `MissionId.formatMissionId()` |
| `MissionsQueries.parseMissionId()` | `MissionId.parseMissionId()` |
| `MissionsQueries.normaliseId()` | `IdUtils.normaliseId()` |
| `MissionsQueries.getTeams()` | `TeamQueries.getActiveTeams()` |
| `MissionsQueries.getCharacters()` | `CharacterQueries.getActiveCharacters()` |
| `MissionsUI.persistOperation()` | `MutationUtils.performMutation()` |

### Removed Features
- `CoreUtils.set()` - Mutated its argument, removed
- `DomUtils.escapeUrl()` - Use `encodeUrlComponent()`
- `window.logActivity` - Use `ActivityLog.record()`
- `window.getDefaultMagicProficiencies` - Use `db.getDefaultMagicProficiencies()`
- `AcademyQueries.getDisciplineTypeLabel()` - Presentation logic, removed
- `AcademyQueries.getDisciplineTypeColor()` - Presentation logic, removed
- `AcademyQueries.getLocationTypeLabel()` - Presentation logic, removed
- `AcademyQueries.getLocationTypeIcon()` - Presentation logic, removed
- `AcademyQueries.getCurrentWeek()` - Use AcademyCore.getCurrentWeek()
- `AcademyQueries.getWeekRange()` - Use CalendarConstants
- `MissionsCore.recordActivity()` - Use MutationPipeline
- `MissionsUI._persistenceQueue` - Use MutationPipeline

## Testing Considerations

1. **Dependency Injection**: Modules use global `window` for dependencies. For testing, mock `window` dependencies.
2. **State Isolation**: `AppState` and `SessionState` are mutable. Reset between tests with `resetAllState()` and `resetSession()`.
3. **Database Mocking**: Mock `window.db` and `window.saveData()` for unit tests.
4. **DOM Utilities**: Use `jsdom` or similar for DOM testing.
5. **Event Listeners**: Use `TabManager.destroy()` to clean up between tests.
6. **Calendar State**: Use `CalendarUI.destroy()` and `CalendarUI.setState()` for testing calendar state.
7. **Academy State**: Use `AcademyState.resetState()` for testing academy UI state.
8. **Tournament State**: Use `TournamentsCore` getters with defensive copies for testing.
9. **Mission State**: Use `MissionsQueries` getters with defensive copies for testing.

## Performance Considerations

1. **Save Queue**: Database saves are coalesced to reduce IndexedDB writes
2. **Event Delegation**: Tab navigation and feature events use event delegation
3. **Notification Queue**: Notifications are queued to prevent DOM explosion
4. **State Setters**: State changes are synchronous; no re-render triggers
5. **Deep Cloning**: Used only for rollback snapshots and defensive copies; not for frequent operations
6. **Calendar Grid**: Uses shared renderer with virtual grid for large schedules
7. **Social Graph**: SVG rendering with zoom controls for performance
8. **Candidate Mutations**: All domain mutations use candidate-based copy-before-commit
9. **Tournament Queries**: Defensive copies prevent accidental mutation
10. **Mission Queries**: Defensive copies prevent accidental mutation

## Future Considerations

1. **Async Renderers**: If rendering becomes async, TabManager will need to handle async render functions
2. **Multiple Modals**: If stacked modals are needed, Modal will need a stack manager
3. **Data Versioning**: DATA_VERSION will increment with schema changes
4. **IndexedDB Structural Changes**: DB_VERSION will increment if object stores change
5. **PWA Support**: Service worker and offline support would be an extension of Database
6. **Calendar Export**: iCalendar export functionality
7. **Social Graph Layout**: Force-directed layout for better graph visualization
8. **Character Generation**: More sophisticated character generation with class balancing
9. **Bulk Operations**: Batch operations for schedule management
10. **Tournament Match Generation**: Automated match generation algorithms
11. **Elimination Workflow Enhancement**: More sophisticated elimination workflows
12. **Mission Generation**: Automated mission generation from templates
