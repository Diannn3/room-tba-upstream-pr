<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import Footprints from "@lucide/svelte/icons/footprints";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Route from "@lucide/svelte/icons/route";
  import { fly } from "svelte/transition";
  import { MediaQuery } from "svelte/reactivity";
  import { formatDistance, formatDuration } from "@lib/campus-route";
  import { getAppData } from "@lib/context";
  import { trapFocus } from "@lib/focus-trap";
  import { fullScreenReveal } from "@lib/motion";
  import { presentClassTransfer } from "@lib/schedule-import/class-transfer-copy";
  import { WEEKDAYS } from "@lib/schedule-import/types";
  import {
    classTransferStore,
    locationStore,
    plannerStore,
    queryStore,
    scheduleRouteStore,
    sidebarStore,
    termStore,
  } from "@lib/store.svelte";
  import { buildAgenda } from "@lib/today-agenda";
  import { routableTodayWeekday, routeToday } from "@lib/today-route";
  import { formatTermDateRange, isDateWithinTerm } from "@lib/term-calendar";

  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
  const appData = getAppData();

  let screenEl = $state<HTMLDivElement | null>(null);

  // Read-only over the planner's saved plan for the active term (#774).
  const sections = $derived(plannerStore.activePlan?.sections ?? []);
  const hasPlan = $derived(sections.length > 0);
  const activeSections = $derived(offTermNote ? [] : sections);
  const days = $derived(buildAgenda(activeSections));

  // A plan for a term that is not in session would otherwise read as "you have
  // nothing all week"; say which window the term actually covers instead.
  const offTermNote = $derived.by(() => {
    const term = termStore.activeTerm;
    if (!term || isDateWithinTerm(term, new Date())) return null;
    const range = formatTermDateRange(term);
    return range ? `${term.label} runs ${range}.` : null;
  });

  function close() {
    sidebarStore.changeOpened("map");
  }

  // One-tap day route (#839): predicate + action shared with the status-bar
  // chip via today-route.ts, mapped onto the schedule-route weekday plumbing
  // the Map tools flyout already uses.
  const today = $derived(days[0] ?? null);
  const todayWeekday = $derived(
    today?.dayIndex == null ? null : (WEEKDAYS[today.dayIndex] ?? null),
  );
  const canRouteToday = $derived(routableTodayWeekday() !== null);
  const routeHint = $derived.by(() => {
    if (canRouteToday) return null;
    if (!hasPlan) return "Add classes in the Planner first.";
    if (todayWeekday === null) return "No classes on Sundays.";
    return "No classes to route today.";
  });
  const routedToday = $derived(
    todayWeekday !== null &&
      scheduleRouteStore.routedWeekday === todayWeekday &&
      locationStore.routeWaypoints !== null,
  );
  let routing = $state(false);

  async function routeMyDay() {
    if (routing) return;
    routing = true;
    try {
      // Leave the overlay only when a route actually drew; failures keep the
      // agenda visible with the store's toast explaining why.
      if (await routeToday()) close();
    } finally {
      routing = false;
    }
  }

  // Transfer estimates deliberately use a separate canonical walk-graph path.
  // The signature hides stale results as soon as the saved plan changes without
  // forcing Today to perform matching/network work merely by opening the screen.
  const transferPlanSignature = $derived(
    [
      String(termStore.activeTermId ?? "none"),
      ...sections.map((section) =>
        [
          section.courseCode,
          section.section,
          section.type,
          section.schedule.join(","),
          section.roomCode ?? "TBA",
          section.stale ? "stale" : "active",
        ].join("|"),
      ),
    ].join("||"),
  );
  const appLoaded = $derived(appData().loaded);
  const canCheckTransfers = $derived(
    appLoaded &&
      todayWeekday !== null &&
      !offTermNote &&
      (today?.entries.length ?? 0) >= 2,
  );
  const transferHint = $derived.by(() => {
    if (!hasPlan) return "Add at least two classes in the Planner first.";
    if (offTermNote) return "Transfer checks are available while the term is in session.";
    if (todayWeekday === null) return "No class transfers on Sundays.";
    if ((today?.entries.length ?? 0) < 2) return "At least two classes are needed for a transfer check.";
    if (!appLoaded) return "Loading campus data…";
    return null;
  });
  let checkingTransfers = $state(false);
  let checkedTransferSignature = $state<string | null>(null);
  const transferResultCurrent = $derived(
    checkedTransferSignature === transferPlanSignature &&
      classTransferStore.weekday === todayWeekday &&
      classTransferStore.phase !== "idle",
  );

  async function checkTransfers() {
    if (checkingTransfers || !canCheckTransfers || todayWeekday === null) return;
    const requestedWeekday = todayWeekday;
    const requestedSignature = transferPlanSignature;
    checkingTransfers = true;
    checkedTransferSignature = null;
    try {
      if (!(await scheduleRouteStore.importFromPlanner())) {
        classTransferStore.clear();
        return;
      }
      const currentAppData = appData();
      if (!currentAppData.loaded) {
        classTransferStore.clear();
        return;
      }
      await classTransferStore.refresh({
        matches: scheduleRouteStore.matches,
        weekday: requestedWeekday,
        buildings: currentAppData.buildings,
      });
      // A plan edit while the async check was running invalidates the result.
      if (requestedSignature === transferPlanSignature) {
        checkedTransferSignature = requestedSignature;
      }
    } finally {
      checkingTransfers = false;
    }
  }

  // /today?route=1 deep link (flag set by Entry.svelte before this mounts).
  // Consumed only once terms have loaded: the plan is keyed by the active
  // term, so at mount canRouteToday is still false and the flag would drop.
  $effect(() => {
    if (!scheduleRouteStore.pendingDayRoute || !termStore.loaded) return;
    scheduleRouteStore.pendingDayRoute = false;
    if (canRouteToday) void routeMyDay();
  });

  function openRoom(roomCode: string) {
    if (!roomCode) return;
    queryStore.updateQuery({
      type: "result",
      category: "room",
      value: roomCode,
    });
    queryStore.inputValue = roomCode;
    close();
  }

  $effect(() => {
    if (!screenEl) return;
    return trapFocus(screenEl, { onEscape: close });
  });
</script>

<div
  bind:this={screenEl}
  class="today-screen"
  role="dialog"
  aria-modal="true"
  aria-labelledby="today-screen-title"
  in:fly={fullScreenReveal(reducedMotion.current)}
>
  <header class="today-header">
    <button
      type="button"
      class="today-back"
      onclick={close}
      aria-label="Back to map"
      title="Back to map"
    >
      <ChevronLeft size={18} aria-hidden="true" />
      <span>Back to map</span>
    </button>
    <h1 class="today-title" id="today-screen-title">Today</h1>
  </header>

  {#if offTermNote}
    <p class="today-note" role="note">{offTermNote}</p>
  {/if}

  <div class="today-actions">
    <div class="today-route">
      <button
        type="button"
        class="today-route__button"
        disabled={!canRouteToday || routing}
        onclick={routeMyDay}
      >
        <Route size={16} aria-hidden="true" />
        {routing ? "Routing…" : "Route my day"}
      </button>
      {#if routeHint}
        <span class="today-route__hint">{routeHint}</span>
      {:else if routedToday && scheduleRouteStore.routeTotals}
        <span class="today-route__totals">
          {formatDuration(scheduleRouteStore.routeTotals.seconds)} walk ·
          {formatDistance(scheduleRouteStore.routeTotals.meters)}
        </span>
      {/if}
    </div>

    <div class="today-transfer-action">
      <button
        type="button"
        class="today-transfer-action__button"
        disabled={!canCheckTransfers || checkingTransfers}
        onclick={checkTransfers}
      >
        <Footprints size={16} aria-hidden="true" />
        {checkingTransfers ? "Checking…" : "Check transfers"}
      </button>
      {#if transferHint}
        <span class="today-transfer-action__hint">{transferHint}</span>
      {:else}
        <span class="today-transfer-action__hint">
          Outdoor estimates use mapped campus walkways; indoor routes are not modeled.
        </span>
      {/if}
    </div>
  </div>

  {#if transferResultCurrent}
    <section class="today-transfers" aria-labelledby="today-transfers-title" aria-live="polite">
      <h2 id="today-transfers-title">Today’s transfers</h2>
      {#if classTransferStore.phase === "unavailable"}
        <p class="today-transfers__status">
          Walking graph unavailable. No fallback transfer estimate was used.
        </p>
      {:else if classTransferStore.phase === "error"}
        <p class="today-transfers__status">
          Transfer estimates are unavailable right now. No fallback estimate was used.
        </p>
      {:else if classTransferStore.phase === "ready" && classTransferStore.evaluations.length === 0}
        <p class="today-transfers__status">No between-class transfer to check today.</p>
      {:else if classTransferStore.phase === "ready"}
        <ul class="today-transfer-list">
          {#each classTransferStore.evaluations as evaluation (`${evaluation.fromStopIndex}-${evaluation.toStopIndex}`)}
            {@const from = classTransferStore.stops[evaluation.fromStopIndex]}
            {@const to = classTransferStore.stops[evaluation.toStopIndex]}
            {#if from && to}
              {@const presentation = presentClassTransfer(evaluation, from, to)}
              <li class="today-transfer-card" data-tone={presentation.tone}>
                <span class="today-transfer-card__courses">
                  {from.courseCode} → {to.courseCode}
                </span>
                <strong class="today-transfer-card__headline">{presentation.headline}</strong>
                <span class="today-transfer-card__detail">{presentation.detail}</span>
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <div class="today-body">
    {#if !hasPlan}
      <p class="today-empty-plan">
        Add classes to see your day.
        <button type="button" onclick={() => sidebarStore.changeOpened("planner")}>
          Open the Planner
        </button>
      </p>
    {:else}
      {#each days as day (day.dateKey)}
        <section
          class="today-day"
          class:today-day--now={day.isToday}
          class:today-day--weekend={day.isWeekend}
          aria-label="{day.title}, {day.dateLabel}"
        >
          <h2 class="today-day__heading">
            <span class="today-day__title">{day.title}</span>
            <span class="today-day__date">{day.dateLabel}</span>
          </h2>
          {#if day.entries.length === 0}
            <p class="today-day__empty">{day.emptyLabel}</p>
          {:else}
            <ul class="today-entries">
              {#each day.entries as entry (entry.courseCode + entry.section + entry.type + entry.startMin)}
                <li class="today-entry">
                  <span class="today-entry__time">{entry.timeLabel}</span>
                  <span class="today-entry__main">
                    <span class="today-entry__course">
                      {entry.courseCode}
                      <span class="today-entry__type">{entry.type}</span>
                      <span class="today-entry__section">{entry.section}</span>
                    </span>
                    {#if entry.courseTitle}
                      <span class="today-entry__course-title">
                        {entry.courseTitle}
                      </span>
                    {/if}
                  </span>
                  {#if entry.roomCode}
                    <button
                      type="button"
                      class="today-entry__room"
                      onclick={() => openRoom(entry.roomCode ?? "")}
                      title="Open {entry.roomCode} on the map"
                    >
                      <MapPin size={14} aria-hidden="true" />
                      {entry.roomCode}
                    </button>
                  {:else}
                    <span class="today-entry__room today-entry__room--tba">
                      Room TBA
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    {/if}
  </div>
</div>

<style>
  .today-screen {
    z-index: 150;
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 1.25rem calc(1rem + env(safe-area-inset-bottom, 0px));
    background: hsl(0, 0%, 98%);
    pointer-events: auto;
    overflow: hidden;
  }

  .today-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .today-back {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: hsl(5, 53%, 32%);
    cursor: pointer;
  }

  .today-back:hover {
    background: hsl(5, 30%, 94%);
  }

  .today-back:focus-visible {
    outline: 2px solid hsl(5, 53%, 32%);
  }

  .today-title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    color: hsl(0, 0%, 12%);
  }

  .today-note {
    margin: 0;
    max-width: 52rem;
    font-size: 0.8125rem;
    color: hsl(0, 0%, 40%);
  }

  .today-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 52rem;
  }

  .today-route,
  .today-transfer-action {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .today-route__button,
  .today-transfer-action__button {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.4375rem 0.875rem;
    border: 1px solid hsl(5, 53%, 32%);
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 700;
    cursor: pointer;
  }

  .today-route__button {
    background: hsl(5, 53%, 32%);
    color: #fff;
  }

  .today-transfer-action__button {
    background: white;
    color: hsl(5, 53%, 32%);
  }

  .today-route__button:hover:not(:disabled) {
    background: hsl(5, 53%, 38%);
  }

  .today-transfer-action__button:hover:not(:disabled) {
    background: hsl(5, 53%, 96%);
  }

  .today-route__button:focus-visible,
  .today-transfer-action__button:focus-visible {
    outline: 2px solid hsl(5, 53%, 32%);
    outline-offset: 2px;
  }

  .today-route__button:disabled,
  .today-transfer-action__button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .today-route__hint,
  .today-route__totals,
  .today-transfer-action__hint {
    font-size: 0.8125rem;
    color: hsl(0, 0%, 40%);
  }

  .today-route__totals {
    font-weight: 600;
    color: hsl(5, 53%, 22%);
  }

  .today-transfers {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-width: 52rem;
    padding: 0.625rem;
    border: 1px solid hsl(0, 0%, 88%);
    border-radius: 0.75rem;
    background: white;
  }

  .today-transfers h2 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 800;
    color: hsl(0, 0%, 18%);
  }

  .today-transfers__status {
    margin: 0;
    font-size: 0.8125rem;
    color: hsl(0, 0%, 42%);
  }

  .today-transfer-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .today-transfer-card {
    display: grid;
    gap: 0.125rem;
    padding: 0.5rem 0.625rem;
    border-left: 3px solid hsl(0, 0%, 70%);
    border-radius: 0.375rem;
    background: hsl(0, 0%, 98%);
  }

  .today-transfer-card[data-tone="good"] {
    border-left-color: hsl(142, 45%, 38%);
  }

  .today-transfer-card[data-tone="caution"] {
    border-left-color: hsl(35, 75%, 45%);
  }

  .today-transfer-card[data-tone="risk"] {
    border-left-color: hsl(5, 60%, 45%);
  }

  .today-transfer-card__courses {
    font-size: 0.6875rem;
    font-weight: 700;
    color: hsl(0, 0%, 45%);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .today-transfer-card__headline {
    font-size: 0.8125rem;
    color: hsl(0, 0%, 18%);
  }

  .today-transfer-card__detail {
    font-size: 0.75rem;
    line-height: 1.35;
    color: hsl(0, 0%, 40%);
  }

  .today-body {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-bottom: 1rem;
  }

  .today-empty-plan {
    margin: 0;
    max-width: 52rem;
    font-size: 0.875rem;
    color: hsl(0, 0%, 35%);
  }

  .today-empty-plan button {
    all: unset;
    margin-left: 0.25rem;
    color: hsl(5, 53%, 32%);
    font-weight: 700;
    cursor: pointer;
    text-decoration: underline;
  }

  .today-empty-plan button:focus-visible {
    outline: 2px solid hsl(5, 53%, 32%);
  }

  .today-day {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-width: 52rem;
    min-width: 0;
  }

  .today-day__heading {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0;
    padding: 0.25rem 0;
    font-size: 0.9375rem;
    font-weight: 700;
    color: hsl(0, 0%, 20%);
  }

  .today-day--now .today-day__title {
    color: hsl(5, 53%, 32%);
  }

  .today-day__date {
    font-size: 0.8125rem;
    font-weight: 500;
    color: hsl(0, 0%, 45%);
  }

  .today-day__empty {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border: 1px dashed hsl(0, 0%, 82%);
    border-radius: 0.625rem;
    font-size: 0.8125rem;
    color: hsl(0, 0%, 45%);
  }

  /* Weekends read as a different kind of day, not just an empty weekday. */
  .today-day--weekend .today-day__heading {
    color: hsl(0, 0%, 45%);
  }

  .today-day--weekend .today-day__empty {
    background: hsl(0, 0%, 95%);
    border-style: solid;
    border-color: hsl(0, 0%, 88%);
  }

  .today-entries {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .today-entry {
    display: grid;
    grid-template-columns: 10rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid hsl(0, 0%, 90%);
    border-radius: 0.625rem;
    background: white;
  }

  .today-entry__time {
    font-size: 0.8125rem;
    font-weight: 700;
    color: hsl(0, 0%, 25%);
    font-variant-numeric: tabular-nums;
  }

  .today-entry__main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .today-entry__course {
    font-size: 0.875rem;
    font-weight: 700;
    color: hsl(0, 0%, 15%);
  }

  .today-entry__type,
  .today-entry__section {
    font-size: 0.75rem;
    font-weight: 600;
    color: hsl(0, 0%, 42%);
  }

  .today-entry__course-title {
    font-size: 0.75rem;
    color: hsl(0, 0%, 42%);
    overflow-wrap: anywhere;
  }

  .today-entry__room {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    justify-self: end;
    min-height: 2rem;
    padding: 0.25rem 0.625rem;
    border: 1px solid hsl(5, 53%, 82%);
    border-radius: 999px;
    color: hsl(5, 53%, 32%);
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }

  .today-entry__room:hover,
  .today-entry__room:focus-visible {
    background: hsl(5, 53%, 96%);
  }

  .today-entry__room:focus-visible {
    outline: 2px solid hsl(5, 53%, 32%);
    outline-offset: 1px;
  }

  .today-entry__room--tba {
    border-color: hsl(0, 0%, 85%);
    color: hsl(0, 0%, 45%);
    cursor: default;
  }

  .today-entry__room--tba:hover {
    background: transparent;
  }

  @media (max-width: 48rem) {
    .today-screen {
      padding: 0.75rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
    }

    /* Stack so a long course title never pushes the room chip off a 320px row. */
    .today-entry {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .today-entry__time {
      grid-column: 1 / -1;
    }
  }
</style>
