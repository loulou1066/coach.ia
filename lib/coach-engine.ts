// Moteur de coaching natif : génère et ajuste un programme à partir de règles (aucune API externe).
export type Goal = 'hypertrophie' | 'force' | 'perte_de_gras' | 'remise_en_forme';
export type Params = { goal: Goal; days: number; minutes: number; place: 'salle' | 'maison'; level: number; limitation: string };
export type PlanEx = { name: string; sets: number; repMin: number; repMax: number; rir: number };
export type Plan = { name: string; method: string; why: string; days: { name: string; exercises: PlanEx[] }[] };
export type Effort = 'trop_dur' | 'bien' | 'trop_facile';

// Exercices par schéma de mouvement, du préféré au remplaçant
const SLOTS: Record<string, string[]> = {
  squat: ['Squat barre', 'Presse à cuisses', 'Squat goblet', 'Fentes bulgares'],
  hinge: ['Soulevé de terre roumain', 'Hip thrust', 'Leg curl'],
  hpush: ['Développé couché', 'Développé incliné haltères', 'Pompes'],
  incline: ['Développé incliné haltères', 'Dips', 'Écarté poulie', 'Pompes'],
  vpush: ['Développé militaire', 'Développé militaire haltères'],
  vpull: ['Tractions', 'Tirage vertical'],
  hpull: ['Rowing barre', 'Tirage horizontal poulie', 'Rowing haltère unilatéral'],
  quads: ['Leg extension', 'Fentes bulgares', 'Squat goblet'],
  hams: ['Leg curl', 'Soulevé de terre roumain'],
  glutes: ['Hip thrust', 'Fentes bulgares'],
  calves: ['Mollets debout'], side: ['Élévations latérales'], rear: ['Face pull', 'Oiseau haltères'],
  biceps: ['Curl biceps', 'Curl marteau'], triceps: ['Extension triceps poulie', 'Barre au front', 'Dips'], abs: ['Crunch poulie'],
};
const COMPOUND = new Set(['squat', 'hinge', 'hpush', 'incline', 'vpush', 'vpull', 'hpull']);
const COMPOUND_NAMES = new Set([...COMPOUND].flatMap((s) => SLOTS[s]));
const DAYS: Record<string, [string, string[]]> = {
  FB_A: ['Full body A', ['squat', 'hpush', 'hpull', 'vpush', 'hinge', 'abs']],
  FB_B: ['Full body B', ['hinge', 'incline', 'vpull', 'quads', 'side', 'triceps']],
  FB_C: ['Full body C', ['squat', 'hpush', 'hpull', 'glutes', 'rear', 'biceps']],
  UA: ['Haut du corps A', ['hpush', 'hpull', 'vpush', 'vpull', 'biceps', 'triceps']],
  UB: ['Haut du corps B', ['incline', 'vpull', 'hpull', 'side', 'rear', 'triceps', 'biceps']],
  LA: ['Bas du corps A', ['squat', 'hinge', 'quads', 'calves', 'abs']],
  LB: ['Bas du corps B', ['hinge', 'squat', 'hams', 'glutes', 'calves', 'abs']],
  PUSH: ['Push', ['hpush', 'vpush', 'incline', 'side', 'triceps']],
  PULL: ['Pull', ['vpull', 'hpull', 'rear', 'biceps', 'abs']],
  LEGS: ['Legs', ['squat', 'hinge', 'quads', 'hams', 'calves']],
};
const TEMPLATES: Record<number, [string, string[]]> = {
  1: ['Full body 1x', ['FB_A']], 2: ['Full body 2x', ['FB_A', 'FB_B']], 3: ['Full body 3x', ['FB_A', 'FB_B', 'FB_C']],
  4: ['Upper/Lower 4x', ['UA', 'LA', 'UB', 'LB']], 5: ['Push/Pull/Legs + Upper/Lower', ['PUSH', 'PULL', 'LEGS', 'UA', 'LA']],
  6: ['Push/Pull/Legs 2x', ['PUSH', 'PULL', 'LEGS', 'PUSH', 'PULL', 'LEGS']],
};
const REPS: Record<Goal, number[][]> = {
  force: [[3, 6], [8, 12]], hypertrophie: [[6, 10], [10, 15]], perte_de_gras: [[6, 10], [10, 15]], remise_en_forme: [[8, 12], [12, 15]],
};
// Exercices écartés selon la zone sensible (éviter n'est pas soigner : voir un professionnel si la douleur persiste)
const AVOID: Record<string, string[]> = {
  'épaule': ['Développé militaire', 'Développé militaire haltères', 'Dips', 'Développé couché'],
  'genou': ['Fentes bulgares', 'Leg extension', 'Squat barre', 'Squat goblet'],
  'bas du dos': ['Soulevé de terre roumain', 'Soulevé de terre', 'Rowing barre', 'Squat barre'],
  'coude / poignet': ['Barre au front', 'Dips', 'Curl biceps'],
};
const HOME = ['haltères', 'haltère', 'poids du corps'];

export function buildPlan(p: Params, cat: { name: string; equipment: string | null }[]): Plan {
  const avoid = AVOID[p.limitation] ?? [];
  const ok = (n: string) => { const c = cat.find((x) => x.name === n); return !!c && !avoid.includes(n) && (p.place === 'salle' || HOME.includes((c.equipment ?? '').toLowerCase())); };
  const [method, keys] = TEMPLATES[Math.min(6, Math.max(1, p.days))];
  const max = Math.min(8, Math.max(3, Math.round(p.minutes / 10)));   // environ 10 min par exercice (3 séries + repos)
  const used: Record<string, number> = {};
  const days = keys.map((key, i) => {
    const chosen: PlanEx[] = [];
    for (const slot of DAYS[key][1]) {
      if (chosen.length >= max) break;
      const opts = SLOTS[slot].filter((x) => ok(x) && !chosen.some((c) => c.name === x));
      if (!opts.length) continue;
      const k = used[slot] ?? 0; used[slot] = k + 1;
      const comp = COMPOUND.has(slot); const [lo, hi] = REPS[p.goal][comp ? 0 : 1];
      chosen.push({ name: opts[k % opts.length], sets: p.level === 1 && !comp ? 2 : 3, repMin: lo, repMax: hi, rir: p.goal === 'remise_en_forme' ? 3 : 2 });
    }
    return { name: `Jour ${i + 1} : ${DAYS[key][0]}`, exercises: chosen };
  });
  const why = `Pour ${p.days} séance(s) de ${p.minutes} min par semaine, la répartition « ${method} » couvre tous les groupes musculaires. Les mouvements lourds passent en premier, avec des fourchettes de reps adaptées à ton objectif et 1 à 3 reps en réserve. Double progression : tu montes la charge quand tu atteins le haut de la fourchette. Prévois une semaine de décharge toutes les 4 à 6 semaines.`;
  return { name: `${method} (${p.goal.replace(/_/g, ' ')})`, method, why, days };
}

// Réajustement selon le ressenti de la dernière séance
export function adjustEx(e: { name: string; sets: number; rir: number }, effort: Effort) {
  if (effort === 'trop_dur') return { sets: Math.max(2, e.sets - 1), rir: Math.min(4, e.rir + 1) };
  if (effort === 'trop_facile') return { sets: COMPOUND_NAMES.has(e.name) ? Math.min(5, e.sets + 1) : e.sets, rir: Math.max(1, e.rir - 1) };
  return { sets: e.sets, rir: e.rir };
}
