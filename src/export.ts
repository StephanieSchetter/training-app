// "Export all" (spec 13): one Excel workbook with a sheet per table.
import { strToU8, zipSync } from 'fflate';
import type { AppState } from './store';

type Cell = string | number | boolean | null | undefined;
type Sheet = { name: string; head: string[]; rows: Cell[][] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const col = (n: number) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function sheetXml(sheet: Sheet): string {
  const row = (cells: Cell[], r: number, bold = false) => `<row r="${r}">${cells.map((c, i) => {
    const ref = `${col(i)}${r}`;
    if (c === null || c === undefined || c === '') return '';
    if (typeof c === 'number' && Number.isFinite(c)) return `<c r="${ref}"><v>${c}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(String(c))}</t></is></c>`;
  }).join('')}</row>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>${row(sheet.head, 1, true)}${sheet.rows.map((r, i) => row(r, i + 2)).join('')}</sheetData></worksheet>`;
}

function workbook(sheets: Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s)); });
  return zipSync(files);
}

const time = (ms?: number) => (ms ? new Date(ms).toLocaleString('en-AU', { hour12: false }) : '');
const yn = (b: unknown) => (b ? 'yes' : '');

/** Every table the app keeps, as rows. */
export function tables(s: AppState): Sheet[] {
  const p = s.program!;
  const exName = (id: string) => p.exercises[id]?.name ?? id;
  const session = new Map(s.sessions.map(x => [x.id, x]));
  const RIR = ['0', '1', '2', '3', '4+'];
  const days = Object.values(s.garminDays).sort((a, b) => a.date.localeCompare(b.date));
  const acts = [...s.garminActs].sort((a, b) => a.startLocal.localeCompare(b.startLocal));
  return [
    { name: 'Gym sessions', head: ['Session id', 'Date', 'Session', 'Block', 'Week', 'Gym', 'Practice', 'Started', 'Finished', 'Bad day', 'Readiness', 'Readiness accepted', 'Warm-up drills ticked', 'Swaps', 'Notes'],
      rows: s.sessions.map(x => [x.id, x.date, p.sessions[x.type]?.name ?? x.type, p.block, x.week, x.gymId, yn(x.practice), time(x.startedAt), time(x.finishedAt), yn(x.badDay), x.readiness?.score, x.readiness ? (x.readiness.accepted ? 'accepted' : 'ignored') : '', x.warmup.length, Object.entries(x.swaps).map(([a, b]) => `${exName(a)} -> ${exName(b)}`).join('; '), x.notes]) },
    { name: 'Sets', head: ['Set id', 'Session id', 'Date', 'Session', 'Exercise', 'Planned exercise', 'Set', 'Side', 'Weight kg', 'Reps', 'RIR', 'Ramp-up', 'Extra pull-ups', 'Controlled no swing', 'Assistance', 'Level', 'Suggested kg', 'Suggested reps'],
      rows: [...s.sets].sort((a, b) => a.ts - b.ts).map(x => [x.id, x.sessionId, session.get(x.sessionId)?.date, p.sessions[session.get(x.sessionId)?.type ?? '']?.name, exName(x.exId), exName(x.plannedExId), x.setNo, x.side, x.weight, x.reps, x.rir === null ? '' : RIR[x.rir], yn(x.rampUp), yn(x.extra), x.controlled === undefined ? '' : x.controlled ? 'yes' : 'no', x.assist, x.level, x.suggestedWeight, x.suggestedReps]) },
    { name: 'Runs', head: ['Run id', 'Date', 'Run', 'Type', 'Week', 'Practice', 'Started', 'Finished', 'Parts done', 'Parts total', '2 more reps?', 'Speed before', 'Speed after', 'Readiness', 'Readiness accepted', '5 km time (sec)'],
      rows: s.runs.map(x => [x.id, x.date, x.title, x.type, x.week, yn(x.practice), time(x.startedAt), time(x.finishedAt), x.segs.filter(g => g.done).length, x.segs.length, x.answer, x.speedBefore, x.speedAfter, x.readiness?.score, x.readiness ? (x.readiness.accepted ? 'accepted' : 'ignored') : '', x.timeTrialSec]) },
    { name: 'Run parts', head: ['Run id', 'Date', 'Section', 'Part', 'Rep or main run', 'Prescribed km/h', 'Actual km/h', 'Done'],
      rows: s.runs.flatMap(x => x.segs.map(g => [x.id, x.date, g.section, g.text, yn(g.work), g.prescribed, g.actual, yn(g.done)])) },
    { name: 'Time trials', head: ['Date', '5 km time (sec)', 'Average km/h', 'Interval speed before', 'Interval speed after'],
      rows: s.runs.filter(x => x.timeTrialSec).map(x => [x.date, x.timeTrialSec, Math.round(5 / (x.timeTrialSec! / 3600) * 100) / 100, x.speedBefore, x.speedAfter]) },
    { name: 'Morning check-ins', head: ['Date', 'After session', 'Knee', 'Back', '10% lighter offered', 'Back-flare swap offered', 'Block pulls offered'],
      rows: s.checkins.map(c => [c.date, p.sessions[session.get(c.sessionId)?.type ?? '']?.name, c.knee, c.back, c.reduce, c.backFlare, c.blockPull]) },
    { name: 'Alerts', head: ['Date', 'Alert', 'Answer'], rows: s.alerts.map(a => [a.date, a.kind, a.status]) },
    { name: 'Garmin daily', head: ['Date', 'Resting HR', 'Overnight HRV', 'Sleep hours', 'Sleep score', 'Training Readiness', 'Training load'],
      rows: days.map(d => [d.date, d.restingHr, d.hrv, d.sleepHours, d.sleepScore, d.readiness, d.trainingLoad]) },
    { name: 'Garmin activities', head: ['Activity id', 'Date', 'Start (local)', 'Type', 'Duration (sec)', 'Average HR', 'Max HR', 'Training load', 'Distance km', 'Laps'],
      rows: acts.map(a => [a.id, a.date, a.startLocal, a.type, a.durationSec, a.avgHr, a.maxHr, a.trainingLoad, a.distanceKm, a.laps.length]) },
    { name: 'Garmin laps', head: ['Activity id', 'Date', 'Lap', 'Time (sec)', 'Distance km', 'Average HR'],
      rows: acts.flatMap(a => a.laps.map((l, i) => [a.id, a.date, i + 1, l.sec, l.km, l.avgHr])) },
    { name: 'Body weight', head: ['Date', 'Kg'], rows: [...s.weights].sort((a, b) => a.date.localeCompare(b.date)).map(w => [w.date, w.kg]) },
    { name: 'Schedule', head: ['Date', 'Session', 'Week', 'Order in day', 'Done', 'Skipped'], rows: [...s.schedule].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order).map(x => [x.date, x.type, x.week, x.order, yn(x.done), yn(x.skipped)]) },
    { name: 'FIFO stints', head: ['Location', 'First day', 'Last day', 'Gym profile'], rows: s.stints.map(x => [x.location, x.start, x.end, x.gym]) },
    { name: 'Shifts', head: ['Date', 'Shift or travel'], rows: Object.entries(s.days).sort().map(([d, v]) => [d, v]) },
    { name: 'Gym profiles', head: ['Gym', 'Dumbbell step kg', 'Smallest plate kg', 'Kettlebells kg'], rows: s.profiles.map(g => [g.name, g.dumbbellStep, g.smallestPlate, g.kettlebells.join(', ')]) },
    { name: 'Machine steps', head: ['Gym', 'Machine', 'Step kg'], rows: s.profiles.flatMap(g => Object.entries(g.machineSteps).map(([ex, step]) => [g.name, exName(ex), step])) },
    { name: 'Rest times', head: ['Exercise', 'Rest (sec)'], rows: Object.entries(s.restOverrides).map(([ex, v]) => [exName(ex), v]) },
    { name: 'Evening stretch', head: ['Date', 'Stretches ticked', 'Done'], rows: Object.entries(s.stretch).sort().map(([d, v]) => [d, v.length, yn(v.length >= p.stretches.length)]) },
    { name: 'Physio findings', head: ['Applies from', 'Finding'], rows: s.physio.map(f => [f.date, f.text]) },
    { name: 'Program', head: ['Session', 'Exercise', 'Scheme', 'Pair', 'Equipment', 'Tags', 'Main muscles', 'Helper muscles'],
      rows: Object.values(p.sessions).flatMap(se => se.items.map(i => [se.name, exName(i.ex), JSON.stringify(i.scheme), i.pair, p.exercises[i.ex]?.equip, p.exercises[i.ex]?.tags?.join(', '), p.exercises[i.ex]?.main?.join(', '), p.exercises[i.ex]?.helper?.join(', ')])) },
  ];
}

/** Build the workbook and hand it to the browser as a download. Returns the file name. */
export function exportAll(s: AppState, today: string): string {
  const bytes = workbook(tables(s));
  const name = `training-export-${today}.xlsx`;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}
