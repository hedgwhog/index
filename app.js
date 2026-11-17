'use strict';

const ui = {
  grip: document.getElementById('grip'),
  view: document.getElementById('view'),
  output: document.getElementById('out'),
  input: document.getElementById('cmd'),
  ghost: document.getElementById('ghost'),
  promptLabel: document.getElementById('ps'),
  chips: document.getElementById('chips'),
  status: document.getElementById('status'),
};

const state = {
  data: { categories: [], plans: [], exceptions: [], bucket: [], todos: [] },
  view: innerWidth < 600 ? 'd' : 'w',
  cursor: null,
  mode: APP.loggedIn ? 'command' : 'username',
  loginUsername: '',
  history: [],
  historyIndex: 0,
  pendingConfirm: null,
  undo: null,
  printTarget: null,
  answerStart: null,
  scrolledFor: '',
};

const IS_TOUCH_SCREEN = matchMedia('(pointer: coarse)').matches;
const promptText = () => `${APP.username || 'you'}@index:~$`;
const isListView = () => state.view === 'bucket' || state.view === 'todo';

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const FULL_DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const FULL_MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MINUTES_PER_DAY = 24 * 60;

const twoDigits = number => String(number).padStart(2, '0');

const toDateString = date => `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
function toDateObject(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const today = () => toDateString(new Date());

function addDays(dateString, days) {
  const date = toDateObject(dateString);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

function addMonths(dateString, months) {
  const date = toDateObject(dateString);
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return toDateString(date);
}

const yearOf = dateString => +dateString.slice(0, 4);
const monthOf = dateString => +dateString.slice(5, 7);
const dayOfMonth = dateString => +dateString.slice(8, 10);
const daysInMonth = dateString => new Date(yearOf(dateString), monthOf(dateString), 0).getDate();
const weekdayIndex = dateString => (toDateObject(dateString).getDay() + 6) % 7;
const mondayOf = dateString => addDays(dateString, -weekdayIndex(dateString));

const nextWeekday = (from, weekday) => addDays(from, (weekday - weekdayIndex(from) + 7) % 7);

function isoWeek(dateString) {
  const thursday = toDateObject(addDays(dateString, 3 - weekdayIndex(dateString)));
  const january4 = new Date(thursday.getFullYear(), 0, 4);
  const daysBetween = (thursday - january4) / 86400000;
  return 1 + Math.round((daysBetween - 3 + (january4.getDay() + 6) % 7) / 7);
}

const toMinutes = time => +time.slice(0, 2) * 60 + +time.slice(3, 5);
const toTime = minutes => `${twoDigits(Math.floor(minutes / 60))}:${twoDigits(minutes % 60)}`;
function currentTime() {
  const now = new Date();
  return `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`;
}

const shortDate = dateString => `${dayOfMonth(dateString)} ${MONTH_NAMES[monthOf(dateString) - 1]}`;
const fullDate = dateString => `${DAY_NAMES[weekdayIndex(dateString)]} ${shortDate(dateString)} ${yearOf(dateString)}`;
function typedDate(dateString) {
  const dayMonth = `${dateString.slice(8)}-${dateString.slice(5, 7)}`;
  return yearOf(dateString) === yearOf(today()) ? dayMonth : `${dayMonth}-${yearOf(dateString)}`;
}

function realDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  const exists = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return exists ? toDateString(date) : null;
}

const ordinal = number => number + ([, 'st', 'nd', 'rd'][number % 100 >> 3 ^ 1 && number % 10] || 'th');

function parseDate(word) {
  const text = word.toLowerCase();
  const now = today();
  if (text === 'today') return now;
  if (text === 'tomorrow' || text === 'tmr') return addDays(now, 1);
  if (text === 'yesterday') return addDays(now, -1);

  if (text.length >= 3) {
    const weekday = FULL_DAY_NAMES.findIndex(name => name.startsWith(text));
    if (weekday >= 0) return nextWeekday(now, weekday);
  }

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return realDate(+match[1], +match[2], +match[3]);

  match = text.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2}|\d{4}))?$/);
  if (!match) return null;
  const [, day, month, typedYear] = match;
  if (typedYear) return realDate(typedYear.length === 2 ? 2000 + +typedYear : +typedYear, +month, +day);

  const thisYear = yearOf(now);
  const date = realDate(thisYear, +month, +day);
  return date && date < addDays(now, -180) ? realDate(thisYear + 1, +month, +day) : date;
}

function parseTime(word) {
  const asTime = (hours, minutes = '00') => {
    const valid = (+hours < 24 || (+hours === 24 && minutes === '00')) && +minutes < 60;
    return valid ? `${twoDigits(+hours)}:${minutes}` : null;
  };

  let match = word.match(/^(\d{1,2}):(\d{2})-(\d{1,2})(?::(\d{2}))?$/);
  if (match) {
    const start = asTime(match[1], match[2]);
    const end = asTime(match[3], match[4]);
    return start && end ? [start, end] : null;
  }

  match = word.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const start = asTime(match[1], match[2]);
  if (!start || start === '24:00') return null;
  const end = Math.min(toMinutes(start) + 60, MINUTES_PER_DAY);
  return [start, end === MINUTES_PER_DAY ? '24:00' : toTime(end)];
}

function parseEvery(word) {
  if (word === 'year' || word === 'yearly') return 'year';
  if (word === 'week' || word === 'weekly') return 'week';
  if (word === 'month' || word === 'monthly') return 'month';
  if (word === 'day' || word === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  const weekdays = word.split(',').filter(Boolean)
    .map(name => name.length >= 3 ? FULL_DAY_NAMES.findIndex(full => full.startsWith(name)) : -1);
  return weekdays.length && !weekdays.includes(-1) ? [...new Set(weekdays)] : null;
}

function parseDuration(word) {
  const text = String(word || '').toLowerCase();
  let match = text.match(/^(\d{1,3})(?:m|min|mins)?$/);
  if (match) return +match[1];
  match = text.match(/^(\d{1,2})h(?:(\d{1,2})(?:m|min)?)?$/) || text.match(/^(\d{1,2}):(\d{2})$/);
  if (match) return +match[1] * 60 + +(match[2] || 0);
  return null;
}

const leaveAt = (start, travelMinutes) => toTime(Math.max(0, toMinutes(start) - travelMinutes));
function travelText(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

function parseParts(text) {
  const parts = { title: [], dates: [], times: [], tag: null, location: null, every: null, notes: null, travel: null, travelUnclear: false };

  const notesStart = text.search(/(^|\s)--(\s|$)/);
  if (notesStart >= 0) {
    parts.notes = text.slice(notesStart).replace(/^\s*--\s*/, '').trim();
    text = text.slice(0, notesStart);
  }

  const words = text.match(/"[^"]*"?|\S+/g) || [];
  let locationWords = null;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const lower = word.toLowerCase();
    let value;

    if (word.startsWith('"')) { (locationWords || parts.title).push(word.replace(/"/g, '')); continue; }
    if (lower === 'every') { locationWords = null; parts.every = (words[++index] || '').toLowerCase(); continue; }
    if (lower === 'travel') {
      locationWords = null;
      const minutes = parseDuration(words[index + 1]);
      if (minutes === null) { parts.travelUnclear = true; continue; }
      parts.travel = minutes;
      index++;
      continue;
    }
    if (/^\[.+\]$/.test(word)) { locationWords = null; parts.tag = word.slice(1, -1); continue; }
    if ((value = parseTime(word))) { locationWords = null; parts.times.push(value); continue; }
    if ((value = parseDate(word))) { locationWords = null; parts.dates.push(value); continue; }
    if (word.startsWith('@')) { locationWords = [word.slice(1)]; parts.location = ''; continue; }

    (locationWords || parts.title).push(word);
    if (locationWords) parts.location = locationWords.filter(Boolean).join(' ');
  }
  if (locationWords) parts.location = locationWords.filter(Boolean).join(' ');
  parts.title = parts.title.filter(Boolean).join(' ');
  return parts;
}

function parseCommandParts(text) {
  const parts = parseParts(text);
  if (parts.travelUnclear) throw new Error('how long is the travel? e.g. travel 30 (minutes) or travel 1h15');
  return parts;
}

const BOX_CHARACTERS = {
  solid:  ['┌', '┐', '└', '┘', '─', '│'],
  dashed: ['┌', '┐', '└', '┘', '╌', '╎'],
  dotted: ['┌', '┐', '└', '┘', '┄', '┆'],
  double: ['╔', '╗', '╚', '╝', '═', '║'],
  thick:  ['┏', '┓', '┗', '┛', '━', '┃'],
};
const BORDER_STYLES = Object.keys(BOX_CHARACTERS);
const REPEAT_WORDS = { daily: 'every day', weekly: 'every week', monthly: 'every month', yearly: 'every year' };
const BUCKET_BOXES = { open: '[ ]', completed: '[✓]', failed: '[X]' };

const categoryById = id => state.data.categories.find(category => category.id == id);
const categoryByTag = tag => state.data.categories.find(category => category.tag.toLowerCase() === String(tag).toLowerCase());
const planById = id => state.data.plans.find(plan => plan.id == id);
const exceptionsOf = plan => state.data.exceptions.filter(exception => exception.plan_id == plan.id);
const tagText = category => category ? `[${category.tag}] ` : '';
const dueText = deadline => deadline ? `due ${fullDate(deadline)}` : 'no deadline';
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function occursOn(plan, date) {
  if (date < plan.date || (plan.until_date && date > plan.until_date)) return false;
  switch (plan.repeat_type) {
    case 'weekly':  return weekdayIndex(date) === weekdayIndex(plan.date);
    case 'monthly': return dayOfMonth(date) === Math.min(dayOfMonth(plan.date), daysInMonth(date));
    case 'yearly':  return date.slice(5) === plan.date.slice(5);
    default:        return date === plan.date;
  }
}

function occurrences(fromDate, toDate) {
  const found = [];
  for (const plan of state.data.plans) {
    const exceptions = exceptionsOf(plan);
    for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
      const changedThatDay = exceptions.some(exception => exception.date === date);
      if (occursOn(plan, date) && !changedThatDay) found.push({ plan, date, start: plan.start_time, end: plan.end_time });
    }
    for (const exception of exceptions) {
      if (exception.new_date && exception.new_date >= fromDate && exception.new_date <= toDate) {
        found.push({ plan, date: exception.new_date, start: exception.new_start, end: exception.new_end, movedFrom: exception.date });
      }
    }
  }
  return found.sort((first, second) => (first.date + first.start).localeCompare(second.date + second.start));
}

function upcomingDates(plan, count = 5) {
  const dates = [];
  const exceptions = exceptionsOf(plan);
  for (let date = today(), daysChecked = 0; dates.length < count && daysChecked < 800; date = addDays(date, 1), daysChecked++) {
    if (occursOn(plan, date) && !exceptions.some(exception => exception.date === date)) dates.push(date);
  }
  return dates;
}

function describeWhen(plan) {
  const time = `${plan.start_time}–${plan.end_time}`;
  const until = plan.until_date ? ` until ${fullDate(plan.until_date)}` : '';
  switch (plan.repeat_type) {
    case 'weekly':  return `every ${DAY_NAMES[weekdayIndex(plan.date)]} from ${fullDate(plan.date)}${until}, ${time}`;
    case 'monthly': return `every month on the ${ordinal(dayOfMonth(plan.date))} from ${fullDate(plan.date)}${until}, ${time}`;
    case 'yearly':  return `every year on ${shortDate(plan.date)} from ${yearOf(plan.date)}${until}, ${time}`;
    default:        return `${fullDate(plan.date)}, ${time}`;
  }
}

function frequentTimes() {
  const timesUsed = {};
  for (const plan of state.data.plans) {
    const time = `${plan.start_time}-${plan.end_time}`;
    timesUsed[time] = (timesUsed[time] || 0) + 1;
  }
  const mostUsed = Object.keys(timesUsed).sort((first, second) => timesUsed[second] - timesUsed[first]).slice(0, 3);
  for (const common of ['09:00-10:00', '12:00-13:00', '19:00-20:00']) {
    if (mostUsed.length < 3 && !mostUsed.includes(common)) mostUsed.push(common);
  }
  return mostUsed;
}

async function callServer(action, payload = {}) {
  let answer;
  try {
    const response = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF': APP.csrf },
      body: JSON.stringify({ action, ...payload }),
    });
    answer = await response.json();
  } catch {
    throw new Error('could not reach the server, check your connection');
  }
  if (answer.error) throw new Error(answer.error);
  if (answer.state) {
    state.data = answer.state;
    render();
  }
  return answer;
}

function print(text, style = '') {
  const line = document.createElement('div');
  line.className = 'line ' + style;
  line.textContent = text;
  (state.printTarget || ui.output).appendChild(line);
  while (ui.output.children.length > 200) ui.output.firstChild.remove();
  ui.output.scrollTop = ui.output.scrollHeight;
  return line;
}
const printSuccess = text => print('✓ ' + text, 'ok');
const printError = text => print('✗ ' + text, 'err');

function confirmThen(previewLines, onYes) {
  [].concat(previewLines).forEach(line => print(line, 'preview'));
  state.pendingConfirm = onYes;
  refreshPrompt();
}

function rememberUndo(label, whatItDoes, takeBack) {
  state.undo = { label, what: whatItDoes, run: takeBack };
}

function markAnswerStart() {
  state.answerStart = ui.output.lastElementChild;
}
function scrollToAnswer() {
  const firstLine = state.answerStart ? state.answerStart.nextElementSibling : ui.output.firstElementChild;
  if (!firstLine) return;
  const lastLine = ui.output.lastElementChild;
  const answerHeight = lastLine.offsetTop + lastLine.offsetHeight - firstLine.offsetTop;
  if (answerHeight > ui.output.clientHeight) ui.output.scrollTop = firstLine.offsetTop - 4;
}

const outputLineHeight = () => parseFloat(getComputedStyle(ui.output).lineHeight) || 20;

function setOutputHeight(pixels, save = true) {
  const tallest = innerHeight * 0.75;
  pixels = Math.round(Math.max(0, Math.min(pixels, tallest)));
  ui.output.style.height = pixels + 'px';
  ui.grip.setAttribute('aria-valuenow', pixels);
  if (save) {
    try { localStorage.setItem('outHeight', pixels); } catch {  }
  }
}

function resetOutputHeight() {
  ui.output.style.height = '';
  try { localStorage.removeItem('outHeight'); } catch {  }
}

ui.grip.addEventListener('pointerdown', downEvent => {
  downEvent.preventDefault();
  ui.grip.setPointerCapture(downEvent.pointerId);
  ui.grip.classList.add('active');
  const startY = downEvent.clientY;
  const startHeight = ui.output.offsetHeight;

  const onMove = moveEvent => setOutputHeight(startHeight + (startY - moveEvent.clientY), false);
  const onRelease = () => {
    ui.grip.removeEventListener('pointermove', onMove);
    ui.grip.removeEventListener('pointerup', onRelease);
    ui.grip.removeEventListener('pointercancel', onRelease);
    ui.grip.classList.remove('active');
    setOutputHeight(ui.output.offsetHeight);
    ui.output.scrollTop = ui.output.scrollHeight;
  };
  ui.grip.addEventListener('pointermove', onMove);
  ui.grip.addEventListener('pointerup', onRelease);
  ui.grip.addEventListener('pointercancel', onRelease);
});

ui.grip.addEventListener('dblclick', resetOutputHeight);

ui.grip.addEventListener('keydown', event => {
  if (event.key === 'ArrowUp') { event.preventDefault(); setOutputHeight(ui.output.offsetHeight + outputLineHeight()); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); setOutputHeight(ui.output.offsetHeight - outputLineHeight()); }
  else if (event.key === 'Home') { event.preventDefault(); resetOutputHeight(); }
});

try {
  const savedHeight = localStorage.getItem('outHeight');
  if (savedHeight !== null) setOutputHeight(+savedHeight, false);
} catch {  }

function planIdFrom(word) {
  const id = parseInt(String(word || '').replace('#', ''), 10);
  if (!planById(id)) {
    throw new Error(word ? `there is no plan #${String(word).replace('#', '')}` : 'which plan? give its number, e.g. 12');
  }
  return id;
}

function requireCategoryTag(tag) {
  if (tag === null) return null;
  const category = categoryByTag(tag);
  if (!category) throw new Error(`unknown category [${tag}]. see them with cat ls, or create it with cat add`);
  return category.tag;
}

const COMMANDS = {};

COMMANDS.add = {
  group: 'agenda', desc: 'add a plan', ex: 'add Gym tue 19:00-20:00 [S]',
  usage: 'add <title> <day> <time> [tag] every <day> @<place> -- <notes>',
  details: [
    'day:    today, tomorrow, tue, 18-11, 18-11-2027 (default: today)',
    'time:   19:00-20:00, or 19:00 for one hour (required)',
    'tag:    a category tag in brackets, like [W]',
    'repeat: every tue, every sat,sun (one series per day), every day, every month, every year',
    'place:  @ followed by the place, like @Main St 4',
    'travel: travel 30 (minutes), travel 1h15. shown above the plan and in its box, with the time to leave',
    'notes:  everything after --',
    'put a title in "quotes" if it contains a day name: add "Sunday lunch" sun 13:00',
  ],
  run(args) {
    const parts = parseCommandParts(args);
    if (!parts.title) throw new Error('add needs a title, e.g. add Gym tue 19:00-20:00');
    if (!parts.times.length) throw new Error('add needs a time, e.g. 19:00-20:00 (or 19:00 for one hour)');
    if (parts.times.length > 1 || parts.dates.length > 1) throw new Error('add takes one day and one time');
    const tag = requireCategoryTag(parts.tag);
    const date = parts.dates[0] || today();

    let newPlans = [{ date, repeat_type: 'none' }];
    if (parts.every !== null) {
      const every = parseEvery(parts.every);
      if (!every) throw new Error(`"every ${parts.every}" is unclear. try every tue, every sat,sun, every day, every month or every year`);
      if (every === 'year') newPlans = [{ date, repeat_type: 'yearly' }];
      else if (every === 'month') newPlans = [{ date, repeat_type: 'monthly' }];
      else {
        const weekdays = every === 'week' ? [weekdayIndex(date)] : every;
        newPlans = weekdays.map(weekday => ({ date: nextWeekday(date, weekday), repeat_type: 'weekly' }));
      }
    }
    newPlans = newPlans.map(plan => ({
      ...plan,
      title: parts.title,
      tag,
      location: parts.location || '',
      notes: parts.notes || '',
      start_time: parts.times[0][0],
      end_time: parts.times[0][1],
      travel_minutes: parts.travel || 0,
    }));

    const preview = newPlans.map(plan => {
      const place = plan.location ? ' @' + plan.location : '';
      const travel = plan.travel_minutes ? `, ${travelText(plan.travel_minutes)} travel (leave at ${leaveAt(plan.start_time, plan.travel_minutes)})` : '';
      const notes = plan.notes ? ' -- ' + plan.notes : '';
      return `add ${tagText(tag && categoryByTag(tag))}${plan.title}, ${describeWhen(plan)}${place}${travel}${notes}`;
    });

    confirmThen([...preview, 'save? (y/n)'], async () => {
      const newIds = [];
      for (const plan of newPlans) newIds.push((await callServer('plan_add', plan)).id);
      rememberUndo(`add ${parts.title}`, `removes ${parts.title} again`, async () => {
        for (const id of newIds) await callServer('plan_rm', { id });
      });
      if (newPlans.length === 1) {
        state.cursor = newPlans[0].date;
        render();
      }
      printSuccess(newPlans.length > 1 ? `added ${newPlans.length} series, one per day` : `added ${parts.title}`);
    });
  },
};

COMMANDS.show = {
  group: 'agenda', desc: 'show everything about a plan', ex: 'show 12', usage: 'show <number>',
  run(args) {
    const plan = planById(planIdFrom(args));
    const category = categoryById(plan.category_id);
    const travel = +plan.travel_minutes;

    const block = document.createElement('div');
    block.className = 'block';
    block.dataset.show = plan.id;
    ui.output.appendChild(block);
    state.printTarget = block;

    print(`#${plan.id} ${tagText(category)}${plan.title}`, 'strong');
    print(`  when   ${describeWhen(plan)}`);
    if (category) print(`  type   ${category.name}`);
    if (plan.location) print(`  where  ${plan.location}`);
    if (travel) print(`  travel ${travelText(travel)}, leave at ${leaveAt(plan.start_time, travel)}`);
    if (plan.notes) print(`  notes  ${plan.notes}`);
    for (const exception of exceptionsOf(plan)) {
      print(exception.new_date
        ? `  moved  ${fullDate(exception.date)} to ${fullDate(exception.new_date)}, ${exception.new_start}–${exception.new_end}`
        : `  skip   ${fullDate(exception.date)}`);
    }
    state.printTarget = null;
  },
};

COMMANDS.edit = {
  group: 'agenda', desc: 'change part of a plan', ex: 'edit 12 11:00-12:00',
  usage: 'edit <number> <title / day / time / [tag] / @place / -- notes>',
  details: [
    'uses the same shorthand as add. only what you type changes.',
    'on a repeating plan this changes every date of the series.',
    'travel 0 removes the travel time.',
  ],
  run(args) {
    const [idWord, ...rest] = args.split(/\s+/);
    const plan = planById(planIdFrom(idWord));
    const parts = parseCommandParts(rest.join(' '));
    const changes = {};
    const described = [];

    if (parts.title) { changes.title = parts.title; described.push(`title: ${parts.title}`); }
    if (parts.dates.length) { changes.date = parts.dates[0]; described.push(`date: ${fullDate(parts.dates[0])}`); }
    if (parts.times.length) { [changes.start_time, changes.end_time] = parts.times[0]; described.push(`time: ${parts.times[0].join('–')}`); }
    if (parts.tag !== null) { changes.tag = requireCategoryTag(parts.tag); described.push(`category: [${changes.tag}]`); }
    if (parts.location !== null) { changes.location = parts.location; described.push(`place: ${parts.location || '(none)'}`); }
    if (parts.notes !== null) { changes.notes = parts.notes; described.push(`notes: ${parts.notes || '(none)'}`); }
    if (parts.travel !== null) { changes.travel_minutes = parts.travel; described.push(parts.travel ? `travel: ${travelText(parts.travel)}` : 'no travel'); }
    if (parts.every !== null) throw new Error('edit cannot change how a plan repeats. use stop to end it, then add a new one');
    if (!described.length) throw new Error('nothing to change, e.g. edit 12 11:00-12:00');

    confirmThen([`edit #${plan.id} ${plan.title}: ${described.join(', ')}`, 'save? (y/n)'], async () => {
      const oldCategory = categoryById(plan.category_id);
      const before = {
        title: plan.title, tag: oldCategory ? oldCategory.tag : null, location: plan.location, notes: plan.notes,
        date: plan.date, start_time: plan.start_time, end_time: plan.end_time, travel_minutes: +plan.travel_minutes || 0,
      };
      await callServer('plan_edit', { id: plan.id, fields: changes });
      rememberUndo(`edit #${plan.id}`, `puts #${plan.id} back as it was`, () => callServer('plan_edit', { id: plan.id, fields: before }));
      printSuccess(`changed #${plan.id}`);
    });
  },
};

COMMANDS.rm = {
  group: 'agenda', desc: 'remove a plan', ex: 'rm 12', usage: 'rm <number> [day]',
  details: ['rm 12 removes the plan (a whole series if it repeats).', 'rm 12 21-11 removes only that date of a series (same as skip).'],
  run(args) {
    const [idWord, dateWord] = args.split(/\s+/);
    if (dateWord) return COMMANDS.skip.run(args);
    const plan = planById(planIdFrom(idWord));
    const question = plan.repeat_type === 'none'
      ? `remove #${plan.id} ${plan.title} on ${fullDate(plan.date)}? (y/n)`
      : `remove the whole series #${plan.id} ${plan.title}, past dates too? (y/n)\n  tip: skip removes one date, stop ends the series and keeps the past`;

    confirmThen(question, async () => {
      const removedPlan = { ...plan };
      const removedExceptions = exceptionsOf(plan).map(exception => ({ ...exception }));
      await callServer('plan_rm', { id: plan.id });
      rememberUndo(`rm #${plan.id}`, `brings back #${plan.id} ${plan.title}`,
        () => callServer('plan_restore', { plan: removedPlan, exceptions: removedExceptions }));
      printSuccess(`removed #${plan.id} ${plan.title}`);
    });
  },
};

COMMANDS.skip = {
  group: 'agenda', desc: 'skip one date of a series', ex: 'skip 12 21-11', usage: 'skip <number> <day>',
  run(args) {
    const [idWord, dateWord] = args.split(/\s+/);
    const plan = planById(planIdFrom(idWord));
    if (plan.repeat_type === 'none') throw new Error(`#${plan.id} doesn't repeat, use rm ${plan.id} instead`);
    const date = dateWord && parseDate(dateWord);
    if (!date) throw new Error(`which date? e.g. skip ${plan.id} ${typedDate(upcomingDates(plan, 1)[0] || today())}`);
    if (!occursOn(plan, date)) throw new Error(`#${plan.id} doesn't happen on ${fullDate(date)}`);

    confirmThen(`skip #${plan.id} ${plan.title} on ${fullDate(date)}? (y/n)`, async () => {
      const previous = exceptionsOf(plan).find(exception => exception.date === date) || null;
      await callServer('skip', { id: plan.id, date });
      rememberUndo(`skip #${plan.id} ${typedDate(date)}`, `puts ${fullDate(date)} back`,
        () => callServer('exception_restore', { id: plan.id, date, previous }));
      printSuccess(`skipped ${fullDate(date)}`);
    });
  },
};

COMMANDS.move = {
  group: 'agenda', desc: 'move one date of a series', ex: 'move 12 21-11 22-11 10:00-11:00',
  usage: 'move <number> <from day> <to day> [time]',
  details: ['without a time the plan keeps its usual time.', 'to move a plan that does not repeat, use edit.'],
  run(args) {
    const [idWord, ...rest] = args.split(/\s+/);
    const plan = planById(planIdFrom(idWord));
    if (plan.repeat_type === 'none') throw new Error(`#${plan.id} doesn't repeat, use edit ${plan.id} <day> <time> instead`);
    const parts = parseCommandParts(rest.join(' '));
    if (parts.dates.length < 2) throw new Error(`give the old and the new date, e.g. move ${plan.id} 21-11 22-11`);
    const [fromDate, toDate] = parts.dates;
    if (!occursOn(plan, fromDate)) throw new Error(`#${plan.id} doesn't happen on ${fullDate(fromDate)}`);
    const [start, end] = parts.times[0] || [plan.start_time, plan.end_time];

    confirmThen(`move #${plan.id} ${plan.title} from ${fullDate(fromDate)} to ${fullDate(toDate)}, ${start}–${end}? (y/n)`, async () => {
      const previous = exceptionsOf(plan).find(exception => exception.date === fromDate) || null;
      await callServer('move', { id: plan.id, date: fromDate, new_date: toDate, new_start: start, new_end: end });
      rememberUndo(`move #${plan.id}`, `puts ${fullDate(fromDate)} back`,
        () => callServer('exception_restore', { id: plan.id, date: fromDate, previous }));
      state.cursor = toDate;
      render();
      printSuccess(`moved to ${fullDate(toDate)}`);
    });
  },
};

COMMANDS.stop = {
  group: 'agenda', desc: 'end a repeating series', ex: 'stop 12', usage: 'stop <number> [last day]',
  details: ['the series ends after the last day (default: today). past dates stay visible.'],
  run(args) {
    const [idWord, dateWord] = args.split(/\s+/);
    const plan = planById(planIdFrom(idWord));
    if (plan.repeat_type === 'none') throw new Error(`#${plan.id} doesn't repeat`);
    const lastDate = dateWord ? parseDate(dateWord) : today();
    if (!lastDate) throw new Error(`"${dateWord}" is not a date`);

    confirmThen(`end #${plan.id} ${plan.title} after ${fullDate(lastDate)}? later dates disappear, earlier ones stay. (y/n)`, async () => {
      const previousEnd = plan.until_date || null;
      await callServer('stop', { id: plan.id, until: lastDate });
      rememberUndo(`stop #${plan.id}`, `lets #${plan.id} continue again`,
        () => callServer('plan_edit', { id: plan.id, fields: { until_date: previousEnd } }));
      printSuccess(`#${plan.id} ends after ${fullDate(lastDate)}`);
    });
  },
};

COMMANDS.view = {
  group: 'view', desc: 'switch view: d, 3, w or m', ex: 'view w', usage: 'view d | 3 | w | m',
  details: ['d = day, 3 = three days, w = week, m = month', 'you can also just type d, 3, w or m'],
  run(args) {
    const view = args.trim().toLowerCase();
    if (!['d', '3', 'w', 'm'].includes(view)) throw new Error('view takes d (day), 3 (three days), w (week) or m (month)');
    state.view = view;
    render();
  },
};

COMMANDS.today = {
  group: 'view', desc: 'jump to today', ex: 'today', usage: 'today',
  run() {
    state.cursor = today();
    if (isListView()) state.view = 'w';
    render();
  },
};

COMMANDS.next = { group: 'view', desc: 'go forward', ex: 'next', usage: 'next', run() { moveInTime(1); } };
COMMANDS.prev = { group: 'view', desc: 'go back', ex: 'prev', usage: 'prev', run() { moveInTime(-1); } };

function moveInTime(direction) {
  if (isListView()) state.view = 'w';
  if (state.view === 'm') state.cursor = addMonths(state.cursor, direction);
  else state.cursor = addDays(state.cursor, direction * { d: 1, 3: 3, w: 7 }[state.view]);
  render();
}

COMMANDS.goto = {
  group: 'view', desc: 'jump to a day, week or month', ex: 'goto week 48',
  usage: 'goto <day> | goto week <n> [year] | goto <month> [year]',
  details: [
    'a day opens the day view:     goto 24-12, goto fri, goto 2027-01-05',
    'a week opens the week view:   goto week 48, goto wk 2 2027, goto w48',
    'a month opens the month view: goto dec, goto december 2027, goto 12-2027',
    'a year opens january:         goto 2027',
  ],
  run(args) {
    const text = args.trim().toLowerCase();
    const thisYear = yearOf(today());

    let match = text.match(/^(?:week|wk|w)\s*(\d{1,2})(?:\s+(\d{4}))?$/);
    if (match) {
      const week = +match[1];
      const year = match[2] ? +match[2] : thisYear;
      const monday = addDays(mondayOf(`${year}-01-04`), (week - 1) * 7);
      if (week < 1 || isoWeek(monday) !== week) throw new Error(`${year} has no week ${week}`);
      state.cursor = monday;
      state.view = 'w';
      render();
      const sunday = addDays(monday, 6);
      return printSuccess(`week ${week}, ${shortDate(monday)} – ${shortDate(sunday)} ${yearOf(sunday)}`);
    }

    let month = null;
    let year = null;
    if ((match = text.match(/^([a-z]{3,})(?:\s+(\d{4}))?$/))) {
      const monthIndex = FULL_MONTH_NAMES.findIndex(name => name.startsWith(match[1]));
      if (monthIndex >= 0) { month = monthIndex + 1; year = match[2] ? +match[2] : null; }
    }
    else if ((match = text.match(/^(\d{1,2})[-/](\d{4})$/))) { month = +match[1]; year = +match[2]; }
    else if ((match = text.match(/^(\d{4})[-/](\d{1,2})$/))) { month = +match[2]; year = +match[1]; }
    else if ((match = text.match(/^(\d{4})$/))) { month = 1; year = +match[1]; }

    if (month !== null) {
      if (month < 1 || month > 12) throw new Error(`${month} is not a month`);
      if (year === null) {
        year = thisYear;
        if (`${year}-${twoDigits(month)}` < addMonths(today(), -6).slice(0, 7)) year++;
      }
      state.cursor = `${year}-${twoDigits(month)}-01`;
      state.view = 'm';
      render();
      return printSuccess(`${FULL_MONTH_NAMES[month - 1]} ${year}`);
    }

    const date = parseDate(text);
    if (!date) throw new Error(`"${args.trim()}" isn't a day, week or month. try goto 24-12, goto week 48 or goto dec`);
    state.cursor = date;
    state.view = 'd';
    render();
  },
};

COMMANDS.cat = {
  group: 'categories', desc: 'categories: add, ls, rm', ex: 'cat ls',
  usage: 'cat add <name> <tag> <border> | cat ls | cat rm <tag>',
  details: [
    'cat add Work W dashed  makes a category shown as [W] with a dashed border',
    'borders: solid, dashed, dotted, double, thick',
    'removing a category keeps its plans; they just have no category anymore',
  ],
  sub: {
    add: { desc: 'new category', ex: 'cat add Work W dashed' },
    ls: { desc: 'list categories', ex: 'cat ls' },
    rm: { desc: 'remove a category', ex: 'cat rm W' },
  },
  run(args) {
    const [subCommand, ...rest] = args.split(/\s+/).filter(Boolean);
    const plansIn = category => state.data.plans.filter(plan => plan.category_id == category.id);

    if (subCommand === 'ls' || !subCommand) {
      if (!state.data.categories.length) return print('no categories yet. make one: cat add Work W dashed', 'dim');
      for (const category of state.data.categories) {
        const side = BOX_CHARACTERS[category.border][5];
        print(`${side}[${category.tag}]${side} ${category.name.padEnd(16)} ${category.border.padEnd(7)} ${plural(plansIn(category).length, 'plan')}`);
      }
      return;
    }

    if (subCommand === 'add') {
      if (rest.length < 3) throw new Error('cat add needs a name, a tag and a border, e.g. cat add Work W dashed');
      const border = rest.pop().toLowerCase();
      const tag = rest.pop().replace(/[[\]]/g, '');
      const name = rest.join(' ');
      if (!BORDER_STYLES.includes(border)) throw new Error('border must be solid, dashed, dotted, double or thick');
      confirmThen(`add category ${name} as [${tag}] with a ${border} border? (y/n)`, async () => {
        await callServer('cat_add', { name, tag, border });
        rememberUndo(`cat add ${tag}`, `removes [${tag}] again`, () => callServer('cat_rm', { tag }));
        printSuccess(`added [${tag}] ${name}`);
      });
      return;
    }

    if (subCommand === 'rm') {
      const category = categoryByTag((rest[0] || '').replace(/[[\]]/g, ''));
      if (!category) throw new Error('which category? e.g. cat rm W');
      const usedBy = plansIn(category).length;
      const note = usedBy ? ` ${plural(usedBy, 'plan')} will have no category.` : '';
      confirmThen(`remove category [${category.tag}] ${category.name}?${note} (y/n)`, async () => {
        const removedCategory = { ...category };
        const planIds = plansIn(category).map(plan => plan.id);
        await callServer('cat_rm', { tag: category.tag });
        rememberUndo(`cat rm ${category.tag}`, `brings back [${category.tag}] ${category.name} on its plans`,
          () => callServer('cat_restore', { category: removedCategory, plan_ids: planIds }));
        printSuccess(`removed [${category.tag}]`);
      });
      return;
    }

    throw new Error('cat takes add, ls or rm. see help cat');
  },
};

function todoById(word) {
  const todo = state.data.todos.find(item => item.id == String(word).replace('#', ''));
  if (!todo) throw new Error(`there is no to do #${String(word || '?').replace('#', '')}. see the numbers with todo`);
  return todo;
}

function todoRepeatFrom(everyWord) {
  if (everyWord === null) return undefined;
  if (everyWord === 'none' || everyWord === 'never') return 'none';
  const repeats = { day: 'daily', daily: 'daily', week: 'weekly', weekly: 'weekly', month: 'monthly', monthly: 'monthly', year: 'yearly', yearly: 'yearly' };
  if (!repeats[everyWord]) throw new Error('a to do can repeat every day, week, month or year');
  return repeats[everyWord];
}

const todoRepeatText = todo => todo.repeat_type && todo.repeat_type !== 'none' ? `, ${REPEAT_WORDS[todo.repeat_type]}` : '';

function takeOutNoDeadline(text) {
  const beforeNotes = text.split(/(^|\s)--(\s|$)/)[0];
  const phrase = /(^|\s)no\s+deadline(?=\s|$)/i;
  const found = phrase.test(beforeNotes);
  return { found, text: found ? text.replace(phrase, ' ').trim() : text };
}

COMMANDS.todo = {
  group: 'to do', desc: 'open the to do list', ex: 'todo',
  usage: 'todo | todo add <title> <deadline> [every month] -- <notes> | todo edit <n> ... | todo done <n> | todo plan <n> <day> <time>',
  details: [
    'deadline: today, tomorrow, fri, 18-11, 18-11-2027, or type: no deadline',
    'repeat:   every day, every week, every month, every year (optional)',
    'to dos show up in the agenda on their deadline day.',
    'edit uses the same shorthand: todo edit 3 fri every month -- new notes (every none stops repeating, no deadline removes it)',
    'done removes the to do. a repeating one moves on to its next deadline instead.',
    'plan books time for it in the agenda: todo plan 3 fri 14:00-16:00 [W]. the to do stays until done.',
    'undo brings back what you last did, including a done to do.',
  ],
  sub: {
    add: { desc: 'add a to do with a deadline', ex: 'todo add Pay rent 01-12 every month' },
    edit: { desc: 'change title, deadline, repeat, notes', ex: 'todo edit 3 mon' },
    done: { desc: 'finish (removes it)', ex: 'todo done 3' },
    plan: { desc: 'book time for it in the agenda', ex: 'todo plan 3 fri 14:00-16:00' },
  },
  run(args) {
    const subCommand = args.split(/\s+/)[0].toLowerCase();
    const rest = args.slice(subCommand.length).trim();

    if (!subCommand) { state.view = 'todo'; render(); return; }
    if (subCommand === 'add') return this.add(rest);
    if (subCommand === 'edit') return this.edit(rest);
    if (subCommand === 'done') return this.done(rest);
    if (subCommand === 'plan') return this.plan(rest);
    if (subCommand === 'undo') return COMMANDS.undo.run('');
    throw new Error('todo takes add, edit, done or plan. see help todo');
  },

  add(text) {
    const noDeadline = takeOutNoDeadline(text);
    const parts = parseCommandParts(noDeadline.text);
    if (!parts.title) throw new Error('todo add needs a title and a deadline, e.g. todo add Pay rent fri');
    if (noDeadline.found && parts.dates.length) throw new Error('give a deadline or type no deadline, not both');
    if (!noDeadline.found && parts.dates.length !== 1) {
      throw new Error(`when is it due? e.g. todo add ${parts.title} fri. without a date, type: todo add ${parts.title} no deadline`);
    }
    if (noDeadline.found && parts.every !== null) throw new Error('a repeating to do needs a deadline');
    if (parts.times.length || parts.tag !== null || parts.location !== null || parts.travel !== null) {
      throw new Error('a to do has a title, a deadline, a repeat and notes. to book a time, use todo plan');
    }

    const todo = {
      title: parts.title,
      deadline: noDeadline.found ? null : parts.dates[0],
      notes: parts.notes || '',
      repeat_type: todoRepeatFrom(parts.every) || 'none',
    };
    const notes = todo.notes ? ' -- ' + todo.notes : '';
    confirmThen([`todo ${todo.title}, ${dueText(todo.deadline)}${todoRepeatText(todo)}${notes}`, 'save? (y/n)'], async () => {
      const { id } = await callServer('todo_add', todo);
      rememberUndo(`todo add ${todo.title}`, `removes ${todo.title} again`, () => callServer('todo_rm', { id }));
      printSuccess(`added to do: ${todo.title}`);
    });
  },

  edit(text) {
    const [idWord, ...rest] = text.split(/\s+/);
    const todo = todoById(idWord);
    const noDeadline = takeOutNoDeadline(rest.join(' '));
    const parts = parseCommandParts(noDeadline.text);
    if (noDeadline.found && parts.dates.length) throw new Error('give a deadline or type no deadline, not both');

    const changes = {};
    const described = [];
    if (parts.title) { changes.title = parts.title; described.push(`title: ${parts.title}`); }
    if (parts.dates.length) { changes.deadline = parts.dates[0]; described.push(`due: ${fullDate(parts.dates[0])}`); }
    if (noDeadline.found) { changes.deadline = null; described.push('no deadline'); }
    const repeat = todoRepeatFrom(parts.every);
    if (repeat) { changes.repeat_type = repeat; described.push(repeat === 'none' ? 'no longer repeats' : `repeats ${REPEAT_WORDS[repeat]}`); }
    if (parts.notes !== null) { changes.notes = parts.notes; described.push(`notes: ${parts.notes || '(none)'}`); }
    if (!described.length) throw new Error(`nothing to change, e.g. todo edit ${todo.id} fri`);

    confirmThen([`edit to do #${todo.id} ${todo.title}: ${described.join(', ')}`, 'save? (y/n)'], async () => {
      const before = { ...todo };
      await callServer('todo_edit', { id: todo.id, fields: changes });
      rememberUndo(`todo edit ${todo.id}`, `puts to do #${todo.id} back as it was`, () => callServer('todo_restore', { todo: before }));
      printSuccess(`changed to do #${todo.id}`);
    });
  },

  async done(text) {
    const todo = todoById(text);
    const before = { ...todo };
    const answer = await callServer('todo_done', { id: todo.id });
    rememberUndo(`todo done ${todo.id}`, `puts ${todo.title} back on the list`, () => callServer('todo_restore', { todo: before }));
    printSuccess(answer.next
      ? `done: ${todo.title}. next one is due ${fullDate(answer.next)}`
      : `done: ${todo.title}. (undo brings it back)`);
  },

  plan(text) {
    const [idWord, ...rest] = text.split(/\s+/);
    const todo = todoById(idWord);
    const parts = parseCommandParts(rest.join(' '));
    const suggestedDate = !todo.deadline || todo.deadline < today() ? today() : todo.deadline;
    if (!parts.times.length) throw new Error(`when do you want to work on it? e.g. todo plan ${todo.id} ${typedDate(suggestedDate)} 14:00-16:00`);
    if (parts.every !== null) throw new Error('todo plan books one time. for repeating time, use add');
    const tag = requireCategoryTag(parts.tag);

    const newPlan = {
      title: todo.title, tag, date: parts.dates[0] || suggestedDate, repeat_type: 'none',
      start_time: parts.times[0][0], end_time: parts.times[0][1], location: parts.location || '', notes: todo.notes,
      travel_minutes: parts.travel || 0,
    };
    const late = todo.deadline && newPlan.date > todo.deadline ? ` (after the deadline, ${fullDate(todo.deadline)})` : '';

    confirmThen([
      `book ${tagText(tag && categoryByTag(tag))}${todo.title}, ${describeWhen(newPlan)}${late}`,
      'the to do stays on the list until you mark it done. save? (y/n)',
    ], async () => {
      const { id } = await callServer('plan_add', newPlan);
      rememberUndo(`todo plan ${todo.id}`, `removes the booked time again`, () => callServer('plan_rm', { id }));
      state.cursor = newPlan.date;
      if (isListView()) state.view = 'w';
      render();
      printSuccess(`booked #${id} ${todo.title} on ${fullDate(newPlan.date)}`);
    });
  },
};

COMMANDS.bucket = {
  group: 'bucket list', desc: 'open the bucket list', ex: 'bucket',
  usage: 'bucket | bucket add <title> -- <notes> | bucket done <n> | bucket fail <n>',
  details: ['items are permanent: they cannot be edited or removed.', 'done and fail are final.', 'go back to the agenda with view w (or d, 3, m)'],
  sub: {
    add: { desc: 'add an item (permanent!)', ex: 'bucket add Learn to sail' },
    done: { desc: 'mark completed (final)', ex: 'bucket done 2' },
    fail: { desc: 'mark failed (final)', ex: 'bucket fail 3' },
  },
  run(args) {
    const subCommand = args.split(/\s+/)[0].toLowerCase();
    const rest = args.slice(subCommand.length).trim();
    if (!subCommand) { state.view = 'bucket'; render(); return; }

    if (subCommand === 'add') {
      const notesStart = rest.search(/(^|\s)--(\s|$)/);
      const title = (notesStart >= 0 ? rest.slice(0, notesStart) : rest).trim();
      const notes = notesStart >= 0 ? rest.slice(notesStart).replace(/^\s*--\s*/, '').trim() : '';
      if (!title) throw new Error('bucket add needs a title, e.g. bucket add Learn to sail -- since I was a kid');
      const nextNumber = state.data.bucket.length + 1;
      confirmThen([
        `#${nextNumber} ${title}${notes ? '\n    ' + notes : ''}`,
        'this is permanent: it can never be edited or removed. add it? (y/n)',
      ], async () => {
        await callServer('bucket_add', { title, notes });
        state.undo = { label: `bucket add ${title}`, permanent: true };
        state.view = 'bucket';
        render();
        printSuccess(`added #${state.data.bucket.length} ${title}`);
      });
      return;
    }

    if (subCommand === 'done' || subCommand === 'fail') {
      const number = parseInt(rest.replace('#', ''), 10);
      const item = state.data.bucket.find(bucketItem => bucketItem.id == number);
      if (!item) throw new Error(`there is no bucket item #${rest || '?'}. see the numbers with bucket`);
      if (item.status !== 'open') throw new Error(`#${number} is already ${item.status}, that is final`);
      const status = subCommand === 'done' ? 'completed' : 'failed';
      confirmThen(`mark #${number} ${item.title} as ${status}? this is final. (y/n)`, async () => {
        await callServer('bucket_set', { id: number, status });
        state.undo = { label: `bucket ${subCommand} ${number}`, permanent: true };
        state.view = 'bucket';
        render();
        printSuccess(`#${number} ${status}`);
      });
      return;
    }

    throw new Error('bucket takes add, done or fail. see help bucket');
  },
};

COMMANDS.find = {
  group: 'other', desc: 'search plans, to dos and the bucket list', ex: 'find dentist', usage: 'find <text>',
  details: ['looks in titles, places, notes and category names. capitals do not matter.'],
  run(args) {
    const searchText = args.trim().replace(/^"|"$/g, '').toLowerCase();
    if (!searchText) throw new Error('what are you looking for? e.g. find dentist');
    const contains = (...fields) => fields.some(field => field && String(field).toLowerCase().includes(searchText));

    const plans = state.data.plans.filter(plan => {
      const category = categoryById(plan.category_id);
      return contains(plan.title, plan.location, plan.notes, category && category.name, category && category.tag);
    });
    const todos = state.data.todos.filter(todo => contains(todo.title, todo.notes));
    const bucketItems = state.data.bucket.filter(item => contains(item.title, item.notes));
    const total = plans.length + todos.length + bucketItems.length;
    if (!total) return print(`nothing found for "${searchText}"`, 'dim');

    const lines = [`${total} found for "${searchText}"`];
    if (plans.length) {
      lines.push('plans');
      for (const plan of plans) {
        lines.push(`  #${plan.id} ${tagText(categoryById(plan.category_id))}${plan.title}, ${describeWhen(plan)}${plan.location ? ' @' + plan.location : ''}`);
      }
    }
    if (todos.length) {
      lines.push('to do');
      for (const todo of todos) lines.push(`  #${todo.id} ${todo.title}, ${dueText(todo.deadline)}${todoRepeatText(todo)}`);
    }
    if (bucketItems.length) {
      lines.push('bucket list');
      for (const item of bucketItems) lines.push(`  ${item.id}. ${BUCKET_BOXES[item.status]} ${item.title}`);
    }
    print(lines.join('\n'), 'pre');
  },
};

COMMANDS.undo = {
  group: 'other', desc: 'take back your last change', ex: 'undo', usage: 'undo',
  details: [
    'works for add, edit, rm, skip, move, stop, cat and todo.',
    'bucket list changes are permanent and cannot be undone.',
    'only the last change of this session can be undone.',
  ],
  run() {
    const lastChange = state.undo;
    if (!lastChange) throw new Error('nothing to undo yet');
    if (lastChange.permanent) throw new Error(`your last change was "${lastChange.label}". the bucket list is permanent, so that can't be undone`);
    confirmThen(`undo "${lastChange.label}"? this ${lastChange.what}. (y/n)`, async () => {
      await lastChange.run();
      state.undo = null;
      printSuccess(`undone: ${lastChange.label}`);
    });
  },
};

COMMANDS.help = {
  group: 'other', desc: 'this list, or help <command>', ex: 'help add', usage: 'help [command]',
  run(args) {
    const asked = args.trim().toLowerCase();
    if (asked) return this.showOne(asked);

    const lines = [];
    let currentGroup = '';
    for (const [name, command] of Object.entries(COMMANDS)) {
      if (command.group !== currentGroup) {
        currentGroup = command.group;
        lines.push((lines.length ? '\n' : '') + currentGroup);
      }

      const rows = command.sub
        ? [[name, command.desc, name === 'bucket' || name === 'todo' ? command.ex : ''],
           ...Object.entries(command.sub).map(([subName, sub]) => [`${name} ${subName}`, sub.desc, sub.ex])]
        : [[name, command.desc, command.ex]];
      for (const [fullName, description, example] of rows) {
        if (fullName === 'cat') continue;
        const [first, second] = fullName.split(' ');
        const shortName = shortVersionOf(first) ? shortVersionOf(first) + (second ? ' ' + second : '') : '';
        lines.push(`  ${shortName.padEnd(8)}${fullName.padEnd(13)}${description.padEnd(42)}${example === fullName ? '' : example}`);
      }
    }
    lines.push('', 'the first column is the short version: t add Pay rent fri = todo add Pay rent fri.',
      'd, 3, w and m switch the view. help <command> shows details. Tab completes, ↑ ↓ repeat earlier commands.');
    print(lines.join('\n'), 'pre');
  },

  showOne(asked) {
    const name = COMMANDS[asked] ? asked : (SHORT_COMMANDS[asked] || '').split(' ')[0];
    const command = COMMANDS[name];
    if (!command) throw new Error(`no command "${asked}". type help to see all`);
    const shortName = shortVersionOf(name);
    print(command.usage, 'strong');
    print('  ' + command.desc + (shortName ? `  (short: ${shortName})` : ''));
    (command.details || []).forEach(line => print('  ' + line, 'dim'));
    if (command.sub) Object.values(command.sub).forEach(sub => print(`  e.g. ${sub.ex}`, 'dim'));
    else print(`  e.g. ${command.ex}`, 'dim');
  },
};

COMMANDS.theme = {
  group: 'other', desc: 'dark, light or auto (this device)', ex: 'theme dark', usage: 'theme dark | light | auto',
  details: ['auto follows your device setting. the choice is saved on this device only.'],
  run(args) {
    const theme = args.trim().toLowerCase();
    if (!['dark', 'light', 'auto'].includes(theme)) throw new Error('theme takes dark, light or auto');
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch {  }
    printSuccess(`theme: ${theme}`);
  },
};

COMMANDS.clear = {
  group: 'other', desc: 'clear this output', ex: 'clear', usage: 'clear',
  run() { ui.output.textContent = ''; },
};

COMMANDS.logout = {
  group: 'other', desc: 'log out', ex: 'logout', usage: 'logout',
  async run() {
    await callServer('logout');
    location.reload();
  },
};

const SHORT_COMMANDS = {
  a: 'add', s: 'show', e: 'edit', f: 'find', t: 'todo', b: 'bucket', c: 'cat', v: 'view', g: 'goto',
  n: 'next', p: 'prev', u: 'undo', h: 'help', '?': 'help', commands: 'help',
  d: 'view d', 3: 'view 3', w: 'view w', m: 'view m',
  remove: 'rm', delete: 'rm', del: 'rm',
};

const shortVersionOf = name => Object.keys(SHORT_COMMANDS).find(short => SHORT_COMMANDS[short] === name && short.length === 1);

function editDistance(first, second) {
  const table = Array.from({ length: first.length + 1 }, (_, row) => [row, ...Array(second.length).fill(0)]);
  for (let column = 1; column <= second.length; column++) table[0][column] = column;
  for (let row = 1; row <= first.length; row++) {
    for (let column = 1; column <= second.length; column++) {
      const sameLetter = first[row - 1] === second[column - 1];
      table[row][column] = Math.min(
        table[row - 1][column] + 1,
        table[row][column - 1] + 1,
        table[row - 1][column - 1] + (sameLetter ? 0 : 1),
      );
    }
  }
  return table[first.length][second.length];
}

async function runLine(line) {
  line = line.trim();
  if (!line) return;

  const showMatch = line.match(/^show\s+#?(\d+)$/i);
  const lastOutput = ui.output.lastElementChild;
  if (showMatch && lastOutput && lastOutput.dataset.show === showMatch[1]) {
    lastOutput.classList.remove('flash');
    void lastOutput.offsetWidth;
    lastOutput.classList.add('flash');
    return;
  }

  print(promptText() + ' ' + line, 'echo');
  state.history.push(line);
  state.historyIndex = state.history.length;

  let name = line.split(/\s+/)[0].toLowerCase();
  let args = line.slice(name.length).trim();
  if (!COMMANDS[name] && SHORT_COMMANDS[name]) {
    const [realName, ...extraArgs] = SHORT_COMMANDS[name].split(' ');
    name = realName;
    args = [...extraArgs, args].filter(Boolean).join(' ');
  }

  const command = COMMANDS[name];
  if (!command) {
    const guess = Object.keys(COMMANDS).find(known => editDistance(known, name) <= 2);
    return printError(`unknown command "${name}".${guess ? ` did you mean ${guess}?` : ''} type help to see all commands`);
  }
  try {
    await command.run(args);
  } catch (error) {
    printError(error.message);
  }
}

const ALL_COMMAND_NAMES = ['add', 'show', 'edit', 'rm', 'skip', 'move', 'stop', 'view', 'today', 'next', 'prev', 'goto', 'find', 'undo', 'cat', 'todo', 'bucket', 'theme', 'help', 'clear', 'logout'];
const RUN_NOW = '✓ done';

const chip = (label, insert = label, extra = {}) => ({ label, insert, ...extra });
const runNowChip = () => chip(RUN_NOW, '', { run: true });
const dateChips = () => [chip('today'), chip('tomorrow'), ...DAY_NAMES.map(name => chip(name))];
const timeChips = () => frequentTimes().map(time => chip(time));
const categoryChips = () => state.data.categories.map(category => chip(`[${category.tag}] ${category.name}`, `[${category.tag}]`));
const dateChip = date => chip(`${DAY_NAMES[weekdayIndex(date)]} ${shortDate(date)}`, typedDate(date));

function planChips(repeatingOnly) {
  let plans = state.data.plans;
  if (!isListView()) {
    const [firstDate, lastDate] = visibleRange();
    const onScreen = new Map(occurrences(firstDate, lastDate).map(occurrence => [occurrence.plan.id, occurrence.plan]));
    plans = [...onScreen.values()];
  }
  return plans
    .filter(plan => !repeatingOnly || plan.repeat_type !== 'none')
    .map(plan => chip(`#${plan.id} ${plan.title}`, String(plan.id)));
}

function suggestionsFor(typedText) {
  if (state.mode !== 'command') return [];
  if (state.pendingConfirm) return [chip('y', 'y', { run: true }), chip('n', 'n', { run: true })];

  const words = typedText.split(/\s+/);
  if (words.length === 1) return ALL_COMMAND_NAMES.map(name => chip(name));

  let commandName = words[0].toLowerCase();
  if (!COMMANDS[commandName] && SHORT_COMMANDS[commandName] && !SHORT_COMMANDS[commandName].includes(' ')) {
    commandName = SHORT_COMMANDS[commandName];
  }

  const withoutLastWord = typedText.endsWith(' ') ? typedText : typedText.split(/\s+/).slice(0, -1).join(' ');
  const finished = withoutLastWord.split(/\s+/).slice(1).filter(Boolean);
  const allWords = typedText.split(/\s+/).slice(1).filter(Boolean);

  switch (commandName) {
    case 'add':
    case 'edit': return planShorthandChips(commandName, finished, allWords);
    case 'show':
    case 'rm': return finished.length ? [] : planChips(false);
    case 'skip':
    case 'move':
    case 'stop': return seriesChips(commandName, finished);
    case 'undo':
      if (finished.length || !state.undo || state.undo.permanent) return [];
      return [chip(`undo ${state.undo.label}`, '', { run: true })];
    case 'view':
      if (finished.length) return [];
      return [['d', 'day'], ['3', '3 days'], ['w', 'week'], ['m', 'month']].map(([view, name]) => chip(`${view} ${name}`, view, { run: true }));
    case 'goto': {
      if (finished.length) return [];
      const nextWeek = isoWeek(addDays(today(), 7));
      const nextMonth = FULL_MONTH_NAMES[monthOf(addMonths(today(), 1)) - 1];
      const [todayChip, tomorrowChip, ...weekdayChips] = dateChips();
      return [todayChip, tomorrowChip, chip(`week ${nextWeek}`, `week ${nextWeek}`, { run: true }), chip(nextMonth, nextMonth, { run: true }), ...weekdayChips];
    }
    case 'theme': return finished.length ? [] : ['dark', 'light', 'auto'].map(theme => chip(theme, theme, { run: true }));
    case 'cat': return categoryCommandChips(finished);
    case 'todo': return todoCommandChips(finished, allWords);
    case 'bucket': return bucketCommandChips(finished);
    case 'help': return finished.length ? [] : Object.keys(COMMANDS).map(name => chip(name, name, { run: true }));
    default: return [];
  }
}

function planShorthandChips(commandName, finished, allWords) {
  if (commandName === 'edit' && !finished.length) return planChips(false);
  const parts = parseParts(allWords.slice(commandName === 'edit' ? 1 : 0).join(' '));
  if (commandName === 'add' && !parts.title) return [chip('type a title…', '', { hint: true })];

  const chips = [];
  if (!parts.dates.length) chips.push(...dateChips());
  if (!parts.times.length) chips.push(...timeChips());
  if (parts.tag === null) chips.push(...categoryChips());
  if (commandName === 'add' && parts.every === null) {
    const weekday = DAY_NAMES[weekdayIndex(parts.dates[0] || today())];
    chips.push(chip(`every ${weekday}`), chip('every month'), chip('every year'));
  }
  if (parts.location === null && parts.notes === null) chips.push(chip('@place', '@', { glue: true }));
  if (parts.travel === null && (parts.location !== null || commandName === 'edit')) {
    chips.push(...[15, 30, 45].map(minutes => chip(`travel ${minutes}`)));
  }
  if (parts.notes === null) chips.push(chip('-- note', '--'));

  const readyToRun = commandName === 'add' ? parts.title && parts.times.length : allWords.length > 1;
  if (readyToRun) chips.unshift(runNowChip());
  return chips;
}

function seriesChips(commandName, finished) {
  if (!finished.length) return planChips(true);
  const plan = planById(finished[0]);
  if (!plan) return [];
  if (commandName === 'stop') return finished.length === 1 ? [chip('today'), runNowChip()] : [];
  if (finished.length === 1) return upcomingDates(plan).map(dateChip);
  if (commandName === 'move' && finished.length === 2) {
    const fromDate = parseDate(finished[1]);
    return fromDate ? [-1, 1, 2].map(days => dateChip(addDays(fromDate, days))) : [];
  }
  if (commandName === 'move' && finished.length === 3) return [runNowChip(), ...timeChips()];
  return [];
}

function categoryCommandChips(finished) {
  if (!finished.length) return ['add', 'ls', 'rm'].map(name => chip(name));
  if (finished[0] === 'rm' && finished.length === 1) {
    return state.data.categories.map(category => chip(`[${category.tag}] ${category.name}`, category.tag, { run: true }));
  }
  if (finished[0] === 'add' && finished.length >= 3) return BORDER_STYLES.map(border => chip(border));
  return [];
}

function todoCommandChips(finished, allWords) {
  const todoPicks = state.data.todos.map(todo => chip(`#${todo.id} ${todo.title}`, String(todo.id)));
  const [subCommand] = finished;
  if (!subCommand) return ['add', 'edit', 'done', 'plan'].map(name => chip(name));
  if (subCommand === 'done' && finished.length === 1) return todoPicks.map(pick => ({ ...pick, run: true }));
  if ((subCommand === 'edit' || subCommand === 'plan') && finished.length === 1) return todoPicks;

  if (subCommand === 'plan') {
    const parts = parseParts(allWords.slice(2).join(' '));
    const chips = [];
    if (!parts.dates.length) chips.push(...dateChips());
    if (!parts.times.length) chips.push(...timeChips());
    if (parts.tag === null) chips.push(...categoryChips());
    if (parts.times.length) chips.unshift(runNowChip());
    return chips;
  }

  if (subCommand === 'add' || (subCommand === 'edit' && finished.length > 1)) {
    const parts = parseParts(allWords.slice(subCommand === 'edit' ? 2 : 1).join(' '));
    if (subCommand === 'add' && !parts.title) return [chip('type a title…', '', { hint: true })];
    const typedNoDeadline = /(^|\s)no\s+deadline(\s|$)/i.test(allWords.join(' '));
    const chips = [];
    if (!parts.dates.length && !typedNoDeadline) chips.push(chip('no deadline'), ...dateChips());
    if (parts.every === null && !typedNoDeadline) chips.push(chip('every month'), chip('every week'), chip('every year'));
    if (parts.notes === null) chips.push(chip('-- note', '--'));
    const readyToRun = subCommand === 'add' ? parts.dates.length || typedNoDeadline : true;
    if (readyToRun) chips.unshift(runNowChip());
    return chips;
  }
  return [];
}

function bucketCommandChips(finished) {
  const [subCommand] = finished;
  if (!subCommand) return ['add', 'done', 'fail'].map(name => chip(name));
  if ((subCommand === 'done' || subCommand === 'fail') && finished.length === 1) {
    return state.data.bucket
      .filter(item => item.status === 'open')
      .map(item => chip(`#${item.id} ${item.title}`, String(item.id), { run: true }));
  }
  if (subCommand === 'add' && finished.length > 1) return [chip('-- note', '--'), runNowChip()];
  return [];
}

function matchChips(typedText) {
  const all = suggestionsFor(typedText);
  const partialWord = typedText.endsWith(' ') || !typedText ? '' : typedText.split(/\s+/).pop();
  const completions = partialWord
    ? all.filter(option => option.insert && option.insert.toLowerCase().startsWith(partialWord.toLowerCase()) && option.insert !== partialWord)
    : [];
  return completions.length
    ? { chips: completions, replacesWord: true, partialWord }
    : { chips: all, replacesWord: false, partialWord };
}

function applyChip(picked, match) {
  if (picked.hint) return ui.input.focus();
  let text = ui.input.value;
  if (picked.insert) {
    if (match.replacesWord) text = text.slice(0, text.length - match.partialWord.length) + picked.insert;
    else text = (text && !text.endsWith(' ') ? text + ' ' : text) + picked.insert;
    if (!picked.glue && !picked.run) text += ' ';
  }
  ui.input.value = text;
  if (picked.run) submitInput();
  else {
    refreshPrompt();
    ui.input.focus();
  }
}

function refreshPrompt() {
  const typedText = ui.input.value;
  ui.promptLabel.textContent =
    state.mode === 'username' ? 'login:' :
    state.mode === 'password' ? 'password:' :
    state.pendingConfirm ? '(y/n)' : promptText();
  ui.input.type = state.mode === 'password' ? 'password' : 'text';

  const match = matchChips(typedText);
  if (!typedText && !state.pendingConfirm && !IS_TOUCH_SCREEN) match.chips = [];
  ui.chips.textContent = '';
  for (const option of match.chips) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.className = option.run && !option.insert ? 'chip go' : option.hint ? 'chip hint' : 'chip';
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => applyChip(option, match));
    ui.chips.appendChild(button);
  }

  let ghostText = '';
  if (match.replacesWord) {
    ghostText = match.chips[0].insert.slice(match.partialWord.length);
  } else {
    const command = COMMANDS[typedText.trim().toLowerCase()];
    const justTheCommand = typedText.endsWith(' ') && typedText.trim().split(/\s+/).length === 1;
    if (command && justTheCommand) ghostText = command.usage.slice(typedText.trim().length + 1);
  }
  ui.ghost.innerHTML = ghostText && typedText.length < 60
    ? `<span class="typed">${escapeHtml(typedText)}</span>${escapeHtml(ghostText)}`
    : '';
}

async function submitInput() {
  const typedText = ui.input.value;
  ui.input.value = '';
  markAnswerStart();
  try {
    await handleInput(typedText);
  } finally {
    scrollToAnswer();
    refreshPrompt();
  }
}

async function handleInput(typedText) {
  if (state.mode === 'username') {
    if (!typedText.trim()) return refreshPrompt();
    print('login: ' + typedText, 'echo');
    state.loginUsername = typedText.trim();
    state.mode = 'password';
    return refreshPrompt();
  }

  if (state.mode === 'password') {
    print('password:', 'echo');
    state.mode = 'username';
    refreshPrompt();
    try {
      await callServer('login', { username: state.loginUsername, password: typedText });
      location.reload();
    } catch (error) {
      printError(error.message);
    }
    return;
  }

  if (state.pendingConfirm) {
    const answer = typedText.trim().toLowerCase();
    const onYes = state.pendingConfirm;
    state.pendingConfirm = null;
    if (answer === 'y' || answer === 'yes') {
      print(promptText() + ' y', 'echo');
      try { await onYes(); } catch (error) { printError(error.message); }
      return refreshPrompt();
    }
    print('cancelled', 'dim');
    if (!['', 'n', 'no'].includes(answer)) await runLine(typedText);
    return;
  }

  await runLine(typedText);
}

ui.input.addEventListener('input', refreshPrompt);

ui.input.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitInput();
  }
  else if (event.key === 'Tab') {
    event.preventDefault();
    const match = matchChips(ui.input.value);
    const first = match.chips.find(option => option.insert && !option.run) || (match.replacesWord && match.chips[0]);
    if (first) applyChip({ ...first, run: false }, match);
  }
  else if (event.key === 'ArrowUp' && state.mode === 'command' && state.history.length) {
    event.preventDefault();
    state.historyIndex = Math.max(0, state.historyIndex - 1);
    ui.input.value = state.history[state.historyIndex];
    refreshPrompt();
  }
  else if (event.key === 'ArrowDown' && state.mode === 'command') {
    event.preventDefault();
    state.historyIndex = Math.min(state.history.length, state.historyIndex + 1);
    ui.input.value = state.history[state.historyIndex] || '';
    refreshPrompt();
  }
  else if (event.key === 'Escape') {
    if (state.pendingConfirm) {
      state.pendingConfirm = null;
      print('cancelled', 'dim');
    }
    ui.input.value = '';
    refreshPrompt();
  }
});

function escapeHtml(text) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text).replace(/[&<>"']/g, character => replacements[character]);
}

const lineOf = character => character.repeat(240);

function characterWidth() {
  const probe = document.createElement('span');
  probe.textContent = 'x'.repeat(20);
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  ui.view.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 20;
  probe.remove();
  return width || 8;
}

function visibleRange() {
  const cursor = state.cursor;
  switch (state.view) {
    case 'd': return [cursor, cursor];
    case '3': return [cursor, addDays(cursor, 2)];
    case 'm': {
      const firstMonday = mondayOf(cursor.slice(0, 8) + '01');
      return [firstMonday, addDays(firstMonday, 41)];
    }
    default: {
      const monday = mondayOf(cursor);
      return [monday, addDays(monday, 6)];
    }
  }
}

function rangeLabel() {
  if (state.view === 'bucket') return 'bucket list';
  if (state.view === 'todo') return 'to do';
  if (state.view === 'm') return `${FULL_MONTH_NAMES[monthOf(state.cursor) - 1]} ${yearOf(state.cursor)}`;

  const [firstDate, lastDate] = visibleRange();
  const week = `week ${isoWeek(firstDate)}`;
  if (state.view === 'd') return `${week} · ${fullDate(firstDate)}`;

  const sameMonth = firstDate.slice(0, 7) === lastDate.slice(0, 7);
  const sameYear = yearOf(firstDate) === yearOf(lastDate);
  const span = sameMonth
    ? `${dayOfMonth(firstDate)}–${shortDate(lastDate)} ${yearOf(lastDate)}`
    : `${shortDate(firstDate)}${sameYear ? '' : ' ' + yearOf(firstDate)} – ${shortDate(lastDate)} ${yearOf(lastDate)}`;
  return `${week} · ${span}`;
}

function renderStatus() {
  const viewName = { d: 'day', 3: '3 days', w: 'week', m: 'month', bucket: 'bucket', todo: 'to do' }[state.view];
  ui.status.innerHTML = APP.loggedIn
    ? `<span>index</span><span>${escapeHtml(rangeLabel())}</span><span class="wide">view: ${viewName}</span><span class="clock">${currentTime()}</span>`
    : `<span>index</span><span>not logged in</span><span class="clock">${currentTime()}</span>`;
}

function wrapText(text, width) {
  width = Math.max(1, Math.floor(width));
  const lines = [];
  let line = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapTitle(title, width, maxLines) {
  const lines = wrapText(title, width);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(1, Math.floor(width) - 1)) + '…';
  return kept;
}

function flowText(parts, widthAt, rowCount) {
  const rows = [];
  for (const [partNumber, [text, style]] of parts.entries()) {
    const words = String(text).split(/[ \t\n]+/).filter(Boolean);
    while (words.length) {
      while (rows.length < rowCount && widthAt(rows.length) < 4) rows.push(null);
      if (rows.length >= rowCount) {
        const lastRow = rows.filter(Boolean).pop();
        if (lastRow && lastRow.part === partNumber) lastRow.text = lastRow.text.slice(0, Math.max(1, lastRow.width - 1)) + '…';
        return rows;
      }
      const width = widthAt(rows.length);
      let line = '';
      while (words.length) {
        const word = words[0];
        if (word.length > width && word.includes('\u00a0')) {
          words.splice(0, 1, ...word.split('\u00a0'));
          continue;
        }
        if (!line && word.length > width) {
          line = word.slice(0, width);
          words[0] = word.slice(width);
          break;
        }
        if ((line ? line.length + 1 : 0) + word.length > width) break;
        line = line ? `${line} ${word}` : word;
        words.shift();
      }
      rows.push({ text: line, style, width, part: partNumber });
    }
  }
  return rows;
}

function planBox(occurrence, style, widthInChars, coveredBy = []) {
  const { plan, start, end } = occurrence;
  const category = categoryById(plan.category_id);
  const [topLeft, topRight, bottomLeft, bottomRight, horizontal, vertical] = BOX_CHARACTERS[category ? category.border : 'solid'];
  const label = `#${plan.id}${category ? ` [${category.tag}]` : ''}`;
  const time = `${start}–${end}${occurrence.movedFrom ? ' (moved)' : ''}`;
  const travel = +plan.travel_minutes || 0;
  const lineCount = Math.max(1, Math.floor((toMinutes(end) - toMinutes(start)) / 15));
  const open = (extraClass = '') => `<div class="ev${extraClass}" style="${style}" data-id="${plan.id}" title="${escapeHtml(plan.title)}, ${time}">`;
  const row = (content, withRightSide) =>
    `<div class="row"><span class="side">${vertical}</span><span class="txt">${content}</span>${withRightSide ? `<span class="side">${vertical}</span>` : ''}</div>`;
  const bold = text => `<b>${escapeHtml(text)}</b>`;
  const dim = text => `<span class="dim">${escapeHtml(text)}</span>`;

  if (widthInChars < 12) {
    if (lineCount === 1) return open(' slim') + row(bold(plan.title)) + '</div>';
    const rows = [
      `<span class="lbl">${escapeHtml(widthInChars < 7 ? '#' + plan.id : label)}</span>`,
      ...wrapTitle(plan.title, widthInChars - 2, Math.max(1, lineCount - 2)).map(bold),
      dim(start),
    ];
    if (travel) rows.push(dim('→' + leaveAt(start, travel)));
    while (rows.length < lineCount) rows.push('');
    return open(' slim') + rows.slice(0, lineCount).map(content => row(content)).join('') + '</div>';
  }

  if (lineCount < 3) {
    const rows = [`<span class="lbl">${escapeHtml(label)}</span> ${bold(plan.title)}`, dim(time)].slice(0, lineCount);
    return open() + rows.map(content => row(content)).join('') + '</div>';
  }

  const innerRows = lineCount - 2;
  const innerWidth = Math.max(4, Math.floor(widthInChars) - 4);
  const startMinutes = toMinutes(start);
  const widthAt = rowNumber => {
    const rowFrom = startMinutes + 15 * (rowNumber + 1);
    const rowTo = rowFrom + 15;
    return coveredBy
      .filter(cover => cover.from < rowTo && cover.to > rowFrom)
      .reduce((narrowest, cover) => Math.min(narrowest, cover.width), innerWidth);
  };
  const glue = text => text.replace(/ /g, '\u00a0');
  const parts = [
    [plan.title, 'b'],
    [time, 'dim'],
    travel ? [`${glue(`→ leave ${leaveAt(start, travel)}`)} (${glue(`${travelText(travel)} travel`)})`, 'dim'] : null,
    plan.location ? [`@${plan.location}`, 'dim'] : null,
    plan.notes ? [plan.notes, 'dim'] : null,
  ].filter(Boolean);
  const rows = flowText(parts, widthAt, innerRows)
    .map(line => !line ? '' : line.style === 'b' ? bold(line.text) : dim(line.text));

  return open() +
    `<div class="row edge"><span>${topLeft}${horizontal} </span><span class="lbl">${escapeHtml(label)}</span><span class="fill"> ${lineOf(horizontal)}</span><span>${topRight}</span></div>` +
    rows.map(content => row(content, true)).join('') +
    Array(innerRows - rows.length).fill(row('', true)).join('') +
    `<div class="row edge"><span>${bottomLeft}</span><span class="fill">${lineOf(horizontal)}</span><span>${bottomRight}</span></div></div>`;
}

function travelTrail(occurrence, style) {
  const lineCount = Math.max(1, Math.floor(occurrence.travel / 15));
  const firstLine = `<span class="dim">→ ${escapeHtml(travelText(occurrence.travel))} travel, leave ${leaveAt(occurrence.start, occurrence.travel)}</span>`;
  const rows = [firstLine, ...Array(lineCount - 1).fill('')]
    .map(content => `<div class="row"><span class="side">┊</span><span class="txt">${content}</span></div>`);
  const destination = occurrence.plan.location || occurrence.plan.title;
  return `<div class="ev travel" style="${style}" data-id="${occurrence.plan.id}" title="travel to ${escapeHtml(destination)}">${rows.join('')}</div>`;
}

function todoLines(date, maxShown = 3) {
  const now = today();
  const due = state.data.todos.filter(todo => todo.deadline && (todo.deadline === date || (date === now && todo.deadline < now)));
  const lines = due.slice(0, maxShown).map(todo => {
    const late = todo.deadline < now;
    return `<div class="todo-line${late ? ' late' : ''}" data-todo="${todo.id}" title="${escapeHtml(todo.title)}, due ${fullDate(todo.deadline)}">${late ? '!' : '☐'} ${escapeHtml(todo.title)}</div>`;
  });
  if (due.length > maxShown) lines.push(`<div class="todo-line more" data-todo="">+${due.length - maxShown} more to do</div>`);
  return lines.join('');
}

function stackPlans(dayPlans, columnChars) {
  dayPlans.sort((first, second) =>
    first.fromMinutes - second.fromMinutes ||
    (second.endMinutes - second.fromMinutes) - (first.endMinutes - first.fromMinutes));

  const normalShift = Math.min(3, columnChars * 0.18);
  const placed = [];
  for (const current of dayPlans) {
    const below = placed.filter(other => other.endMinutes > current.fromMinutes).pop();
    current.level = below ? below.level + 1 : 0;
    current.leftChars = 0;
    current.coveredBy = [];

    if (below) {
      const titleWidth = Math.min(below.plan.title.length, Math.floor(columnChars - below.leftChars) - 4);
      const landsOnTitle = current.fromMinutes < below.startMinutes + 30;
      const shift = landsOnTitle ? Math.min(titleWidth + 5, (columnChars - below.leftChars) / 2) : normalShift;
      current.leftChars = Math.min(below.leftChars + shift, columnChars * 0.6);
    }
    for (const other of placed) {
      if (other.endMinutes > current.fromMinutes && other.level < current.level) {
        other.coveredBy.push({ from: current.fromMinutes, to: current.endMinutes, width: Math.floor(current.leftChars - other.leftChars) - 3 });
      }
    }
    placed.push(current);
  }
  return dayPlans;
}

const percentOfDay = minutes => minutes / (MINUTES_PER_DAY / 100);

function renderGrid() {
  const [firstDate, lastDate] = visibleRange();
  const days = [];
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) days.push(date);
  const allOccurrences = occurrences(firstDate, lastDate);
  const now = today();
  const nowMinutes = toMinutes(currentTime());
  const charWidth = characterWidth();
  const columnChars = (ui.view.clientWidth - 8 * charWidth) / days.length / charWidth;

  let html = `<div class="grid cols-${days.length}" style="--cols:${days.length}"><div class="dh corner"></div>`;
  for (const date of days) {
    const monthName = days.length === 1 ? ' ' + MONTH_NAMES[monthOf(date) - 1] : '';
    html += `<div class="dh${date === now ? ' today' : ''}"><div class="dh-line"><span class="pre">── </span>` +
      `<span class="lbl">${DAY_NAMES[weekdayIndex(date)]} ${dayOfMonth(date)}${monthName}</span><span class="fill"> ${lineOf('─')}</span></div>${todoLines(date)}</div>`;
  }

  html += `<div class="hours">${Array.from({ length: 24 }, (_, hour) => `<div>${twoDigits(hour)}:00 ┤</div>`).join('')}</div>`;

  for (const date of days) {
    const dayPlans = allOccurrences.filter(occurrence => occurrence.date === date).map(occurrence => {
      const startMinutes = toMinutes(occurrence.start);
      const travel = +occurrence.plan.travel_minutes || 0;
      return { ...occurrence, travel, startMinutes, endMinutes: toMinutes(occurrence.end), fromMinutes: Math.max(0, startMinutes - travel) };
    });
    stackPlans(dayPlans, columnChars);

    html += `<div class="col" data-date="${date}">`;
    for (const item of dayPlans) {
      const left = item.leftChars.toFixed(1);
      const horizontal = `left:${left}ch;width:calc(100% - ${left}ch);z-index:${1 + item.level}`;
      if (item.travel && item.startMinutes > item.fromMinutes) {
        const paper = item.level ? ';background:var(--paper)' : '';
        html += travelTrail(item, `top:${percentOfDay(item.fromMinutes)}%;height:${percentOfDay(item.startMinutes - item.fromMinutes)}%;${horizontal}${paper}`);
      }
      html += planBox(item, `top:${percentOfDay(item.startMinutes)}%;height:${percentOfDay(item.endMinutes - item.startMinutes)}%;${horizontal}`,
        columnChars - item.leftChars, item.coveredBy);
    }
    if (date === now) {
      html += `<div class="now" style="top:${percentOfDay(nowMinutes)}%"><span class="lbl">now</span><span class="fill">${lineOf('━')}</span></div>`;
    }
    html += '</div>';
  }
  ui.view.innerHTML = html + '</div>';

  const rangeKey = state.view + firstDate;
  if (state.scrolledFor !== rangeKey) {
    state.scrolledFor = rangeKey;
    const hourHeight = ui.view.querySelector('.col').offsetHeight / 24;
    const startHour = days.includes(now) ? Math.max(0, Math.floor(nowMinutes / 60) - 2) : 7;
    ui.view.scrollTop = Math.max(0, (startHour - 0.3) * hourHeight);
  }
}

function renderMonth() {
  const [firstDate] = visibleRange();
  const allOccurrences = occurrences(firstDate, addDays(firstDate, 41));
  const shownMonth = state.cursor.slice(0, 7);
  const now = today();

  let html = '<div class="month">' + DAY_NAMES.map(name => `<div class="mh">${name}</div>`).join('');
  for (let dayNumber = 0; dayNumber < 42; dayNumber++) {
    const date = addDays(firstDate, dayNumber);
    const dayPlans = allOccurrences.filter(occurrence => occurrence.date === date);
    const classes = `cell${date.slice(0, 7) !== shownMonth ? ' other' : ''}${date === now ? ' today' : ''}`;
    html += `<div class="${classes}" data-date="${date}"><span class="num">${dayOfMonth(date)}</span>${todoLines(date, 2)}`;
    html += dayPlans.slice(0, 4).map(({ plan, start }) => {
      const category = categoryById(plan.category_id);
      const side = BOX_CHARACTERS[category ? category.border : 'solid'][5];
      const tag = category ? `[${escapeHtml(category.tag)}]` : `#${plan.id}`;
      return `<div class="m-item"><span class="side">${side}</span><span class="time">${start} </span><span class="tag">${tag}</span><span class="title"> ${escapeHtml(plan.title)}</span></div>`;
    }).join('');
    if (dayPlans.length > 4) html += `<div class="more">+${dayPlans.length - 4} more</div>`;
    html += '</div>';
  }
  ui.view.innerHTML = html + '</div>';
}

function renderBucket() {
  const items = state.data.bucket;
  const countWithStatus = status => items.filter(item => item.status === status).length;
  let html = `<div class="bucket"><pre class="bucket-head">bucket list
${'═'.repeat(11)}
${items.length} items, ${countWithStatus('open')} open, ${countWithStatus('completed')} completed, ${countWithStatus('failed')} failed</pre>`;

  if (!items.length) html += `<pre class="empty">
     \\         /
      \\_______/
       |     |      nothing in here yet.
       |     |      add your first item:
       |_____|      bucket add Learn to sail
</pre>`;

  html += '<ol>' + items.map(item => {
    const stamp = item.status === 'open' ? ''
      : `<span class="stamp ${item.status}">${item.status}<small>${escapeHtml(shortDate(item.resolved))} ${yearOf(item.resolved)}</small></span>`;
    const notes = item.notes ? `<div class="notes">${escapeHtml(item.notes)}</div>` : '';
    return `<li class="${item.status}"><div class="item">` +
      `<div><span class="n">${String(item.id).padStart(3)}.</span> <span class="box">${BUCKET_BOXES[item.status]}</span> <span class="title">${escapeHtml(item.title)}</span></div>` +
      `<div class="meta">${notes}<div class="added">added ${escapeHtml(shortDate(item.created))} ${yearOf(item.created)}</div></div></div>` +
      `<div class="stamp-col">${stamp}</div></li>`;
  }).join('') + '</ol></div>';
  ui.view.innerHTML = html;
}

function renderTodo() {
  const now = today();
  const tomorrow = addDays(now, 1);
  const endOfWeek = addDays(mondayOf(now), 6);
  const todos = state.data.todos;
  const groups = [
    ['overdue', todo => todo.deadline && todo.deadline < now],
    ['today', todo => todo.deadline === now],
    ['tomorrow', todo => todo.deadline === tomorrow],
    ['this week', todo => todo.deadline && todo.deadline > tomorrow && todo.deadline <= endOfWeek],
    ['later', todo => todo.deadline && todo.deadline > endOfWeek && todo.deadline > tomorrow],
    ['no deadline', todo => !todo.deadline],
  ];
  const overdueCount = todos.filter(groups[0][1]).length;

  let html = `<div class="todo"><pre class="bucket-head">to do
${'═'.repeat(5)}
${todos.length} open${overdueCount ? `, ${overdueCount} overdue` : ''}</pre>`;
  if (!todos.length) html += `<pre class="empty">
     ┌───┐
     │ ✓ │    all done.
     └───┘    add one with: todo add Pay rent fri
</pre>`;

  for (const [groupName, belongsInGroup] of groups) {
    const inGroup = todos.filter(belongsInGroup);
    if (!inGroup.length) continue;
    html += `<div class="todo-group${groupName === 'overdue' ? ' overdue' : ''}"><span>${groupName} </span><span class="fill">${lineOf('─')}</span></div><ul>`;
    html += inGroup.map(todo => {
      const repeat = todo.repeat_type && todo.repeat_type !== 'none'
        ? `<span class="rep" title="${REPEAT_WORDS[todo.repeat_type]}">↻ ${todo.repeat_type}</span> ` : '';
      const due = todo.deadline ? `${DAY_NAMES[weekdayIndex(todo.deadline)]} ${escapeHtml(shortDate(todo.deadline))}` : '';
      const notes = todo.notes ? `<span class="notes">${escapeHtml(todo.notes)}</span>` : '';
      return `<li><span class="box" data-done="${todo.id}" title="done">[ ]</span><span class="n">#${todo.id}</span>` +
        `<span class="t"><span class="title" data-edit="${todo.id}">${escapeHtml(todo.title)}</span>${notes}</span>` +
        `<span class="due">${repeat}${due}</span>` +
        `<button type="button" class="done-btn" data-done="${todo.id}">[ done ]</button></li>`;
    }).join('');
    html += '</ul>';
  }
  ui.view.innerHTML = html + '</div>';
}

function render() {
  if (state.view === 'm' || isListView()) {
    const rangeKey = state.view + visibleRange()[0];
    if (state.scrolledFor !== rangeKey) {
      state.scrolledFor = rangeKey;
      requestAnimationFrame(() => { ui.view.scrollTop = 0; });
    }
  }
  if (!APP.loggedIn) ui.view.innerHTML = '';
  else if (state.view === 'bucket') renderBucket();
  else if (state.view === 'todo') renderTodo();
  else if (state.view === 'm') renderMonth();
  else renderGrid();
  renderStatus();
}

ui.view.addEventListener('click', event => {
  const doneButton = event.target.closest('[data-done]');
  if (doneButton) {
    markAnswerStart();
    runLine(`todo done ${doneButton.dataset.done}`).then(() => { scrollToAnswer(); refreshPrompt(); });
    return;
  }

  const todoTitle = event.target.closest('[data-edit]');
  if (todoTitle) {
    ui.input.value = `todo edit ${todoTitle.dataset.edit} `;
    ui.input.focus();
    refreshPrompt();
    return;
  }

  if (event.target.closest('.todo-line')) {
    event.stopPropagation();
    state.view = 'todo';
    render();
    return;
  }

  const planElement = event.target.closest('.ev');
  if (planElement) { runLine(`show ${planElement.dataset.id}`); return; }

  const monthCell = event.target.closest('.cell');
  if (monthCell) {
    state.cursor = monthCell.dataset.date;
    state.view = 'd';
    render();
    return;
  }

  const dayColumn = event.target.closest('.col');
  if (dayColumn) {
    const column = dayColumn.getBoundingClientRect();
    const hour = Math.min(23, Math.floor((event.clientY - column.top) / column.height * 24));
    const endHour = hour === 23 ? '24' : twoDigits(hour + 1);
    ui.input.value = `add  ${typedDate(dayColumn.dataset.date)} ${twoDigits(hour)}:00-${endHour}:00`;
    ui.input.focus();
    ui.input.setSelectionRange(4, 4);
    refreshPrompt();
  }
});

state.cursor = today();
render();
refreshPrompt();
if (matchMedia('(pointer: fine)').matches) ui.input.focus();

setInterval(() => {
  const scrollPosition = ui.view.scrollTop;
  if (APP.loggedIn && !isListView() && state.view !== 'm') {
    renderGrid();
    ui.view.scrollTop = scrollPosition;
  }
  renderStatus();
}, 60000);

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (APP.loggedIn && ['d', '3', 'w'].includes(state.view)) renderGrid();
  }, 150);
});

if (APP.loggedIn) {
  print(`${APP.lastLogin ? `last login ${APP.lastLogin}. ` : ''}type help to see all commands`, 'dim');
  callServer('state').catch(error => printError(error.message));
}