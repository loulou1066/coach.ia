'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { readiness, nextRecommendation, gauge, pointsForSession, tierFor, type SetLog } from '@/lib/progression';

const today = () => new Date().toLocaleDateString('sv-SE');
const REASONS: any = { progression: 'on monte la charge', maintien: 'même charge, +1 rep', allegement: 'récupération faible : un set en moins', deload: 'deload : on allège' };

export default function Page() {
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setUid(data.session?.user.id ?? null); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUid(s?.user.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (!ready) return <main><p>Chargement…</p></main>;
  return <main>{uid ? <App uid={uid} /> : <Auth />}</main>;
}

function Auth() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [msg, setMsg] = useState('');
  async function go(up: boolean) {
    const { error } = up ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : up ? 'Compte créé. Vérifie tes emails si la confirmation est activée.' : '');
  }
  return (<div className="card"><h2>Coach muscu</h2>
    <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
    <input placeholder="Mot de passe (6+)" type="password" value={password} onChange={e => setPassword(e.target.value)} />
    <button onClick={() => go(false)}>Se connecter</button>
    <button className="alt" onClick={() => go(true)}>Créer un compte</button><small>{msg}</small></div>);
}

function App({ uid }: { uid: string }) {
  const [tab, setTab] = useState<'jour' | 'seance'>('jour');
  useEffect(() => { (async () => {
    await supabase.from('profiles').upsert({ user_id: uid });
    await supabase.from('rank_state').upsert({ user_id: uid });
  })(); }, [uid]);
  return (<>
    <div className="tabs"><button className={tab === 'jour' ? '' : 'alt'} onClick={() => setTab('jour')}>Aujourd'hui</button>
      <button className={tab === 'seance' ? '' : 'alt'} onClick={() => setTab('seance')}>Séance</button></div>
    {tab === 'jour' ? <Today uid={uid} /> : <Session uid={uid} />}
    <button className="alt" onClick={() => supabase.auth.signOut()}>Déconnexion</button></>);
}

function Today({ uid }: { uid: string }) {
  const [g, setG] = useState({ done: 0, target: 3 }); const [rank, setRank] = useState<any>({ points: 0, tier: 'bronze' });
  const [score, setScore] = useState<number | null>(null); const [f, setF] = useState({ sleep: 7, fatigue: 3, soreness: 3 });
  const load = useCallback(async () => {
    const { data: gv } = await supabase.from('weekly_gauge').select('*').eq('user_id', uid).maybeSingle();
    if (gv) setG({ done: Number(gv.done), target: gv.target });
    const { data: r } = await supabase.from('rank_state').select('*').eq('user_id', uid).maybeSingle();
    if (r) setRank(r);
    const { data: c } = await supabase.from('daily_checkins').select('*').eq('user_id', uid).eq('day', today()).maybeSingle();
    if (c) { setF({ sleep: Number(c.sleep_hours), fatigue: c.fatigue, soreness: c.soreness });
      setScore(readiness({ sleepHours: Number(c.sleep_hours), fatigue: c.fatigue, soreness: c.soreness })); }
  }, [uid]);
  useEffect(() => { load(); }, [load]);
  async function save() {
    await supabase.from('daily_checkins').upsert({ user_id: uid, day: today(), sleep_hours: f.sleep, fatigue: f.fatigue, soreness: f.soreness });
    setScore(readiness({ sleepHours: f.sleep, fatigue: f.fatigue, soreness: f.soreness }));
  }
  const gg = gauge(g.done, g.target);
  return (<>
    <div className="card"><b>Semaine : {gg.done} / {gg.target} séances</b><div className="bar"><div style={{ width: gg.pct + '%' }} /></div>
      <small>Rang : {rank.tier} · {rank.points} pts</small></div>
    <div className="card"><b>Check-in du matin</b>
      <label>Sommeil (h)<input type="number" step="0.5" value={f.sleep} onChange={e => setF({ ...f, sleep: +e.target.value })} /></label>
      <label>Fatigue (1 frais – 5 épuisé)<input type="number" min={1} max={5} value={f.fatigue} onChange={e => setF({ ...f, fatigue: +e.target.value })} /></label>
      <label>Courbatures (1 – 5)<input type="number" min={1} max={5} value={f.soreness} onChange={e => setF({ ...f, soreness: +e.target.value })} /></label>
      <button onClick={save}>Enregistrer</button>
      {score !== null && <p>Récupération : <b>{score} / 100</b></p>}</div></>);
}

function Session({ uid }: { uid: string }) {
  const [exs, setExs] = useState<any[]>([]); const [exId, setExId] = useState(''); const [rec, setRec] = useState<any>(null);
  const [sets, setSets] = useState<any[]>([]); const [w, setW] = useState(0); const [r, setR] = useState(8); const [rir, setRir] = useState(2);
  const [score, setScore] = useState(70); const [msg, setMsg] = useState('');
  useEffect(() => { (async () => {
    const { data } = await supabase.from('exercises').select('*').order('name'); setExs(data ?? []);
    const { data: c } = await supabase.from('daily_checkins').select('*').eq('user_id', uid).eq('day', today()).maybeSingle();
    if (c) setScore(readiness({ sleepHours: Number(c.sleep_hours), fatigue: c.fatigue, soreness: c.soreness }));
  })(); }, [uid]);
  useEffect(() => { if (!exId) return; (async () => {
    const { data } = await supabase.from('workout_sets').select('workout_id,reps,weight_kg,rir,workouts!inner(started_at)').eq('exercise_id', exId).limit(80);
    const by: Record<string, { t: string; s: SetLog[] }> = {};
    (data ?? []).forEach((x: any) => { if (!by[x.workout_id]) by[x.workout_id] = { t: x.workouts.started_at, s: [] };
      by[x.workout_id].s.push({ reps: x.reps, weightKg: Number(x.weight_kg), rir: x.rir ?? undefined }); });
    const last = Object.values(by).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 2).map(v => v.s);
    const e = exs.find(x => x.id === exId);
    const rc = nextRecommendation(last, { repMin: e.default_rep_min, repMax: e.default_rep_max, targetRir: 2, incrementKg: Number(e.increment_kg), targetSets: 3 }, score);
    setRec(rc); if (rc.weightKg) setW(rc.weightKg); setR(rc.repGoal);
  })(); }, [exId, exs, score]);
  async function finish() {
    if (!sets.length) return;
    const { data: wk, error } = await supabase.from('workouts').insert({ user_id: uid, ended_at: new Date().toISOString() }).select().single();
    if (error || !wk) { setMsg(error?.message ?? 'Erreur'); return; }
    await supabase.from('workout_sets').insert(sets.map((s, i) => ({ workout_id: wk.id, exercise_id: s.exercise_id, set_index: i + 1, reps: s.reps, weight_kg: s.weight, rir: s.rir })));
    const { data: rk } = await supabase.from('rank_state').select('points').eq('user_id', uid).maybeSingle();
    const pts = (rk?.points ?? 0) + pointsForSession({ prs: 0, streakWeeks: 0 });
    await supabase.from('rank_state').upsert({ user_id: uid, points: pts, tier: tierFor(pts), updated_at: new Date().toISOString() });
    setSets([]); setMsg('Séance enregistrée.');
  }
  const ex = exs.find(x => x.id === exId);
  return (<div className="card"><b>Nouvelle séance</b>
    <select value={exId} onChange={e => setExId(e.target.value)}><option value="">Choisir un exercice</option>
      {exs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
    {rec && <p><small>{rec.weightKg ? `Objectif : ${rec.weightKg} kg × ${rec.repGoal} reps, ${rec.sets} séries (${REASONS[rec.reason]})` : 'Première fois : pars léger et note ta charge.'}</small></p>}
    {ex && <details><summary>Technique</summary><ul>{(ex.cues ?? []).map((c: string) => <li key={c}>{c}</li>)}</ul>
      <small>Erreurs : {(ex.common_mistakes ?? []).join(' · ')}</small></details>}
    <input type="number" step="0.5" placeholder="Charge (kg)" value={w} onChange={e => setW(+e.target.value)} />
    <input type="number" placeholder="Reps" value={r} onChange={e => setR(+e.target.value)} />
    <input type="number" placeholder="Reps en réserve" value={rir} onChange={e => setRir(+e.target.value)} />
    <button disabled={!exId} onClick={() => setSets([...sets, { exercise_id: exId, name: ex.name, reps: r, weight: w, rir }])}>Ajouter la série</button>
    {sets.map((s, i) => <p key={i}>{s.name} : {s.weight} kg × {s.reps}</p>)}
    <button onClick={finish}>Terminer la séance</button><small>{msg}</small></div>);
}
