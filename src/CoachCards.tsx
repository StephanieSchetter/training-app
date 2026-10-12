// Cards for the coach's read of a run and of a week.
import { Debrief, Note, WeekReview } from './coach';

function Notes({ notes }: { notes: Note[] }) {
  return (
    <div className="coach-notes">
      {notes.map((n, i) => <div className="coach-note" key={i}><span className={'dot ' + n.tone} /><span>{n.text}</span></div>)}
    </div>
  );
}

export function DebriefCard({ debrief, compact, onOpen }: { debrief: Debrief; compact?: boolean; onOpen?: () => void }) {
  return (
    <div className={'card coach' + (debrief.tone === 'watch' ? ' alert-card' : '')}>
      <div className="overline">Coach's read{compact ? ' · your last run' : ''}</div>
      <b>{debrief.verdict}</b>
      {compact ? <Notes notes={debrief.notes.slice(0, 1)} /> : <Notes notes={debrief.notes} />}
      {debrief.next && <div className="coach-next">{debrief.next}</div>}
      {compact && onOpen && <button className="btn" onClick={onOpen}>See the full read</button>}
    </div>
  );
}

const span = (r: WeekReview) => {
  const f = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  return `${f(r.from)} to ${f(r.to)}`;
};

export function ReviewCard({ review }: { review: WeekReview }) {
  return (
    <div className="card coach">
      <div className="overline">Week {review.week} review · {span(review)}{review.complete ? '' : ' · so far'}</div>
      <b>{review.focus}</b>
      <Notes notes={review.notes} />
    </div>
  );
}
