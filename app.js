(() => {
  "use strict";

  const STORAGE_KEY = "myRideMoney.data.v1";
  const CURRENCIES = new Set(["USD", "CAD", "GBP", "EUR", "AUD", "MXN", "INR", "JPY"]);
  const DEFAULT_STATE = Object.freeze({
    version: 1,
    settings: { profileName: "My driving", vehicleName: "", currency: "USD", weeklyGoalCents: 0 },
    activeShift: null,
    shifts: []
  });

  const $ = (selector) => document.querySelector(selector);
  const startCard = $("#start-card");
  const activeCard = $("#active-card");
  const startForm = $("#start-shift-form");
  const incomeForm = $("#income-form");
  const expenseForm = $("#expense-form");
  const endForm = $("#end-shift-form");
  const settingsForm = $("#settings-form");
  const historyList = $("#history-list");
  const historyEmpty = $("#history-empty");
  const clearHistoryButton = $("#clear-history");
  const shiftDialog = $("#shift-dialog");
  const shiftDialogBody = $("#shift-dialog-body");

  let state = sanitizeState(readStorage());
  let timerId = null;

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function id() {
    return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function readStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : cloneDefaults();
    } catch (_) {
      return cloneDefaults();
    }
  }

  function saveStorage() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (_) {
      return false;
    }
  }

  function sanitizeState(candidate) {
    const base = cloneDefaults();
    if (!candidate || typeof candidate !== "object") return base;
    const settings = candidate.settings && typeof candidate.settings === "object" ? candidate.settings : {};
    base.settings.profileName = typeof settings.profileName === "string" ? settings.profileName.slice(0, 40) : base.settings.profileName;
    base.settings.vehicleName = typeof settings.vehicleName === "string" ? settings.vehicleName.slice(0, 50) : "";
    base.settings.currency = CURRENCIES.has(settings.currency) ? settings.currency : "USD";
    base.settings.weeklyGoalCents = Number.isSafeInteger(settings.weeklyGoalCents) && settings.weeklyGoalCents >= 0 ? settings.weeklyGoalCents : 0;
    base.shifts = Array.isArray(candidate.shifts) ? candidate.shifts.filter(validShift).slice(0, 500) : [];
    base.activeShift = validShift(candidate.activeShift, true) ? candidate.activeShift : null;
    return base;
  }

  function validShift(shift, allowActive = false) {
    return Boolean(
      shift && typeof shift === "object" && typeof shift.id === "string" &&
      Number.isFinite(Date.parse(shift.startAt)) &&
      (allowActive || Number.isFinite(Date.parse(shift.endAt))) &&
      Array.isArray(shift.incomes) && Array.isArray(shift.expenses)
    );
  }

  function toLocalInput(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function parseDateInput(element) {
    const date = new Date(element.value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function parseMoneyCents(value, allowZero = false) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (!allowZero && number <= 0)) return null;
    const cents = Math.round(number * 100);
    return Number.isSafeInteger(cents) ? cents : null;
  }

  function parseOdometerTenths(value) {
    if (String(value).trim() === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return undefined;
    const tenths = Math.round(number * 10);
    return Number.isSafeInteger(tenths) ? tenths : undefined;
  }

  function money(cents, code = state.settings.currency) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: code === "JPY" ? 0 : 2,
      maximumFractionDigits: code === "JPY" ? 0 : 2
    }).format(cents / 100);
  }

  function currencySymbol(code = state.settings.currency) {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value || code;
  }

  function sumEntries(entries) {
    return entries.reduce((sum, entry) => sum + (Number.isSafeInteger(entry.amountCents) ? entry.amountCents : 0), 0);
  }

  function metrics(shift, live = false) {
    const grossCents = sumEntries(shift.incomes);
    const expenseCents = sumEntries(shift.expenses);
    const takeHomeCents = grossCents - expenseCents;
    const startMs = Date.parse(shift.startAt);
    const endMs = live ? Date.now() : Date.parse(shift.endAt);
    const durationSeconds = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? (endMs - startMs) / 1000 : null;
    const milesTenths = Number.isSafeInteger(shift.startOdometerTenths) && Number.isSafeInteger(shift.endOdometerTenths) && shift.endOdometerTenths >= shift.startOdometerTenths
      ? shift.endOdometerTenths - shift.startOdometerTenths : null;
    const hours = durationSeconds && durationSeconds > 0 ? durationSeconds / 3600 : null;
    const miles = milesTenths !== null && milesTenths > 0 ? milesTenths / 10 : null;
    return {
      grossCents,
      expenseCents,
      takeHomeCents,
      durationSeconds,
      milesTenths,
      takeHomePerHour: hours ? takeHomeCents / 100 / hours : null,
      takeHomePerMile: miles ? takeHomeCents / 100 / miles : null
    };
  }

  function duration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "Not available";
    const totalMinutes = Math.round(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  function timerDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00:00";
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function rate(value) {
    return Number.isFinite(value) ? money(Math.round(value * 100)) : "—";
  }

  function milesText(tenths) {
    return tenths === null ? "Not available" : (tenths / 10).toFixed(1);
  }

  function workTypeName(value) {
    return ({ rideshare: "Rideshare", delivery: "Delivery", mixed: "Mixed", personal: "Personal driving", other: "Other" })[value] || "Other";
  }

  function categoryName(value) {
    return ({ fare: "Fare", tip: "Tip", bonus: "Bonus", cash_ride: "Cash ride", cancellation_fee: "Cancellation fee", adjustment: "Adjustment", fuel: "Gas / fuel", toll: "Toll", parking: "Parking", food: "Food / lunch", car_wash: "Car wash", maintenance: "Vehicle maintenance", phone_supplies: "Phone / supplies", other: "Other" })[value] || "Other";
  }

  function weekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const start = new Date(now);
    start.setDate(now.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }

  function renderWeek() {
    const start = weekStart();
    const weekShifts = state.shifts.filter((shift) => Date.parse(shift.endAt) >= start);
    const totals = weekShifts.reduce((result, shift) => {
      const item = metrics(shift);
      result.gross += item.grossCents;
      result.expenses += item.expenseCents;
      result.takeHome += item.takeHomeCents;
      result.seconds += item.durationSeconds || 0;
      result.milesTenths += item.milesTenths || 0;
      return result;
    }, { gross: 0, expenses: 0, takeHome: 0, seconds: 0, milesTenths: 0 });

    $("#week-take-home").textContent = money(totals.takeHome);
    $("#week-gross").textContent = money(totals.gross);
    $("#week-expenses").textContent = money(totals.expenses);
    $("#week-hours").textContent = duration(totals.seconds);
    $("#week-miles").textContent = (totals.milesTenths / 10).toFixed(1);

    const goal = state.settings.weeklyGoalCents;
    const percent = goal > 0 ? Math.max(0, Math.min(100, Math.round(totals.takeHome / goal * 100))) : 0;
    $("#week-goal-copy").textContent = goal > 0 ? `${money(Math.max(0, totals.takeHome))} of ${money(goal)} goal` : "Set a weekly goal in Settings";
    $("#goal-fill").style.width = `${percent}%`;
    const track = $(".goal-track");
    track.setAttribute("aria-valuenow", String(percent));
    track.setAttribute("aria-valuetext", goal > 0 ? `${percent}% of ${money(goal)}` : "No goal set");
  }

  function renderActive() {
    const shift = state.activeShift;
    startCard.hidden = Boolean(shift);
    activeCard.hidden = !shift;
    if (!shift) {
      if (timerId) window.clearInterval(timerId);
      timerId = null;
      return;
    }

    const item = metrics(shift, true);
    $("#active-heading").textContent = `${workTypeName(shift.workType)} shift`;
    $("#active-meta").textContent = `Started ${new Date(shift.startAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}${shift.note ? ` · ${shift.note}` : ""}`;
    $("#active-take-home").textContent = money(item.takeHomeCents);
    $("#active-gross").textContent = money(item.grossCents);
    $("#active-expenses").textContent = money(item.expenseCents);
    $("#active-rate").textContent = rate(item.takeHomePerHour);
    $("#live-timer").textContent = timerDuration(item.durationSeconds);
    renderEntries();

    if (!timerId) {
      timerId = window.setInterval(() => {
        if (!state.activeShift) return;
        const liveMetrics = metrics(state.activeShift, true);
        $("#live-timer").textContent = timerDuration(liveMetrics.durationSeconds);
        $("#active-rate").textContent = rate(liveMetrics.takeHomePerHour);
      }, 1000);
    }
  }

  function renderEntries() {
    const feed = $("#active-entry-feed");
    feed.textContent = "";
    if (!state.activeShift) return;
    const entries = [
      ...state.activeShift.incomes.map((entry) => ({ ...entry, kind: "income" })),
      ...state.activeShift.expenses.map((entry) => ({ ...entry, kind: "expense" }))
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = `entry-row ${entry.kind}`;
      const label = document.createElement("span");
      label.textContent = `${categoryName(entry.category)}${entry.platform ? ` · ${entry.platform}` : ""}${entry.note ? ` · ${entry.note}` : ""}`;
      const amount = document.createElement("strong");
      amount.textContent = `${entry.kind === "expense" ? "−" : "+"}${money(entry.amountCents)}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${categoryName(entry.category)} ${money(entry.amountCents)}`);
      remove.dataset.removeEntry = entry.id;
      remove.dataset.kind = entry.kind;
      row.append(label, amount, remove);
      feed.append(row);
    });
  }

  function renderHistory() {
    historyList.textContent = "";
    historyEmpty.hidden = state.shifts.length > 0;
    clearHistoryButton.hidden = state.shifts.length === 0;
    state.shifts.slice(0, 50).forEach((shift) => {
      const item = metrics(shift);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-row";
      button.dataset.shiftId = shift.id;
      button.setAttribute("aria-label", `View ${workTypeName(shift.workType)} shift, take-home ${money(item.takeHomeCents)}`);
      const title = document.createElement("strong");
      title.textContent = workTypeName(shift.workType);
      const amount = document.createElement("strong");
      amount.className = "amount";
      amount.textContent = money(item.takeHomeCents);
      const date = document.createElement("small");
      date.textContent = new Date(shift.startAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const facts = document.createElement("small");
      facts.textContent = `${duration(item.durationSeconds)} · ${item.milesTenths === null ? "Miles N/A" : `${milesText(item.milesTenths)} mi`}`;
      button.append(title, amount, date, facts);
      historyList.append(button);
    });
  }

  function renderCurrency() {
    document.querySelectorAll(".currency-symbol").forEach((node) => { node.textContent = currencySymbol(); });
  }

  function renderAll() {
    renderCurrency();
    renderWeek();
    renderActive();
    renderHistory();
  }

  function syncSettingsForm() {
    $("#profile-name").value = state.settings.profileName;
    $("#vehicle-name").value = state.settings.vehicleName;
    $("#currency").value = state.settings.currency;
    $("#weekly-goal").value = (state.settings.weeklyGoalCents / 100).toFixed(state.settings.currency === "JPY" ? 0 : 2);
  }

  function setDefaultDates() {
    $("#start-time").value = toLocalInput();
    $("#end-time").value = toLocalInput();
  }

  function markError(element, message) {
    element.setAttribute("aria-invalid", message ? "true" : "false");
    return message;
  }

  startForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const start = parseDateInput($("#start-time"));
    const odometer = parseOdometerTenths($("#start-odometer").value);
    let error = "";
    if (!start) error = "Enter a valid start date and time.";
    else if (odometer === undefined) error = "Enter a valid starting odometer or leave it blank.";
    $("#start-error").textContent = markError($("#start-time"), error);
    if (error) return;

    state.activeShift = {
      id: id(),
      startAt: start.toISOString(),
      endAt: null,
      startOdometerTenths: odometer,
      endOdometerTenths: null,
      workType: $("#work-type").value,
      note: $("#shift-note").value.trim(),
      incomes: [],
      expenses: []
    };
    saveStorage();
    $("#end-time").value = toLocalInput();
    renderAll();
    activeCard.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  });

  incomeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.activeShift) return;
    const amountCents = parseMoneyCents($("#income-amount").value);
    const error = amountCents === null ? "Enter an earnings amount greater than zero." : "";
    $("#income-error").textContent = markError($("#income-amount"), error);
    if (error) return;
    state.activeShift.incomes.push({ id: id(), amountCents, category: $("#income-category").value, platform: $("#income-platform").value, note: $("#income-note").value.trim(), at: new Date().toISOString() });
    saveStorage();
    incomeForm.reset();
    $("#income-category").value = "fare";
    $("#income-panel").hidden = true;
    renderAll();
  });

  expenseForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.activeShift) return;
    const amountCents = parseMoneyCents($("#expense-amount").value);
    const error = amountCents === null ? "Enter an expense amount greater than zero." : "";
    $("#expense-error").textContent = markError($("#expense-amount"), error);
    if (error) return;
    state.activeShift.expenses.push({ id: id(), amountCents, category: $("#expense-category").value, note: $("#expense-note").value.trim(), at: new Date().toISOString() });
    saveStorage();
    expenseForm.reset();
    $("#expense-category").value = "fuel";
    $("#expense-panel").hidden = true;
    renderAll();
  });

  endForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.activeShift) return;
    const end = parseDateInput($("#end-time"));
    const endOdometer = parseOdometerTenths($("#end-odometer").value);
    const startMs = Date.parse(state.activeShift.startAt);
    let error = "";
    if (!end) error = "Enter a valid end date and time.";
    else if (end.getTime() < startMs) error = "End time must be after the shift start.";
    else if (endOdometer === undefined) error = "Enter a valid ending odometer or leave it blank.";
    else if (Number.isSafeInteger(state.activeShift.startOdometerTenths) && Number.isSafeInteger(endOdometer) && endOdometer < state.activeShift.startOdometerTenths) error = "Ending odometer cannot be lower than the starting odometer.";
    $("#end-error").textContent = markError($("#end-time"), error);
    if (error) return;

    const completed = { ...state.activeShift, endAt: end.toISOString(), endOdometerTenths: endOdometer };
    state.shifts.unshift(completed);
    state.shifts = state.shifts.slice(0, 500);
    state.activeShift = null;
    saveStorage();
    startForm.reset();
    setDefaultDates();
    $("#work-type").value = "rideshare";
    renderAll();
    $("#history").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  });

  activeCard.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      const panel = $(`#${toggle.dataset.toggle}`);
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.querySelector("input")?.focus();
      return;
    }
    const close = event.target.closest("[data-close]");
    if (close) { $(`#${close.dataset.close}`).hidden = true; return; }
    const remove = event.target.closest("[data-remove-entry]");
    if (remove && state.activeShift && window.confirm("Remove this entry from the active shift?")) {
      const list = remove.dataset.kind === "income" ? state.activeShift.incomes : state.activeShift.expenses;
      const index = list.findIndex((entry) => entry.id === remove.dataset.removeEntry);
      if (index >= 0) list.splice(index, 1);
      saveStorage();
      renderAll();
    }
  });

  settingsForm.addEventListener("input", () => {
    state.settings.profileName = $("#profile-name").value.trim().slice(0, 40) || "My driving";
    state.settings.vehicleName = $("#vehicle-name").value.trim().slice(0, 50);
    state.settings.currency = CURRENCIES.has($("#currency").value) ? $("#currency").value : "USD";
    state.settings.weeklyGoalCents = parseMoneyCents($("#weekly-goal").value, true) ?? 0;
    const stored = saveStorage();
    $("#settings-status").textContent = stored ? "Saved on this device." : "Settings apply now, but this browser blocked local storage.";
    renderAll();
  });

  historyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-shift-id]");
    if (button) showShift(button.dataset.shiftId);
  });

  function showShift(shiftId) {
    const shift = state.shifts.find((item) => item.id === shiftId);
    if (!shift) return;
    const item = metrics(shift);
    shiftDialogBody.textContent = "";
    const label = document.createElement("p"); label.className = "eyebrow"; label.textContent = "Completed shift";
    const heading = document.createElement("h2"); heading.textContent = workTypeName(shift.workType);
    const date = document.createElement("p"); date.textContent = `${new Date(shift.startAt).toLocaleString()} – ${new Date(shift.endAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    const hero = document.createElement("div"); hero.className = "detail-hero";
    const heroLabel = document.createElement("span"); heroLabel.textContent = "Take-home";
    const heroValue = document.createElement("strong"); heroValue.textContent = money(item.takeHomeCents);
    hero.append(heroLabel, heroValue);
    const grid = document.createElement("div"); grid.className = "detail-grid";
    [["Gross", money(item.grossCents)], ["Expenses", money(item.expenseCents)], ["Time", duration(item.durationSeconds)], ["Miles", milesText(item.milesTenths)], ["Per hour", rate(item.takeHomePerHour)], ["Per mile", rate(item.takeHomePerMile)]].forEach(([key, value]) => {
      const box = document.createElement("div"); const k = document.createElement("span"); const v = document.createElement("strong"); k.textContent = key; v.textContent = value; box.append(k, v); grid.append(box);
    });
    shiftDialogBody.append(label, heading, date, hero, grid);
    if (shift.note) { const note = document.createElement("p"); note.textContent = `Note: ${shift.note}`; shiftDialogBody.append(note); }
    const remove = document.createElement("button"); remove.className = "danger-button"; remove.type = "button"; remove.textContent = "Delete this shift"; remove.dataset.deleteShift = shift.id; shiftDialogBody.append(remove);
    if (typeof shiftDialog.showModal === "function") shiftDialog.showModal(); else shiftDialog.setAttribute("open", "");
  }

  $(".dialog-close").addEventListener("click", () => shiftDialog.close());
  shiftDialog.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete-shift]");
    if (remove && window.confirm("Delete this saved shift? This cannot be undone.")) {
      state.shifts = state.shifts.filter((shift) => shift.id !== remove.dataset.deleteShift);
      saveStorage();
      shiftDialog.close();
      renderAll();
    }
  });

  clearHistoryButton.addEventListener("click", () => {
    if (!window.confirm("Clear all completed shift history? This cannot be undone.")) return;
    state.shifts = [];
    saveStorage();
    renderAll();
  });

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function download(name, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $("#export-csv").addEventListener("click", () => {
    const header = ["Date", "Work Type", "Start", "End", "Gross", "Expenses", "Take Home", "Hours", "Miles", "Take Home Per Hour", "Take Home Per Mile", "Note"];
    const rows = state.shifts.map((shift) => {
      const item = metrics(shift);
      return [new Date(shift.startAt).toLocaleDateString(), workTypeName(shift.workType), shift.startAt, shift.endAt, (item.grossCents / 100).toFixed(2), (item.expenseCents / 100).toFixed(2), (item.takeHomeCents / 100).toFixed(2), item.durationSeconds === null ? "" : (item.durationSeconds / 3600).toFixed(2), item.milesTenths === null ? "" : (item.milesTenths / 10).toFixed(1), item.takeHomePerHour?.toFixed(2) ?? "", item.takeHomePerMile?.toFixed(2) ?? "", shift.note];
    });
    download(`my-ride-money-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  });

  $("#export-backup").addEventListener("click", () => {
    download(`my-ride-money-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2), "application/json");
  });

  $("#import-backup").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = sanitizeState(JSON.parse(await file.text()));
      if (!window.confirm(`Import ${imported.shifts.length} completed shifts and replace data on this device?`)) return;
      state = imported;
      saveStorage();
      syncSettingsForm();
      setDefaultDates();
      renderAll();
    } catch (_) {
      window.alert("That file is not a valid My Ride Money backup.");
    } finally {
      event.target.value = "";
    }
  });

  $("#delete-all").addEventListener("click", () => {
    if (!window.confirm("Delete the active shift, settings, and all saved history from this device? This cannot be undone.")) return;
    state = cloneDefaults();
    saveStorage();
    syncSettingsForm();
    setDefaultDates();
    renderAll();
  });

  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  syncSettingsForm();
  setDefaultDates();
  renderAll();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }
})();
