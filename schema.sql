-- Schéma Supabase : coach de musculation
-- Toutes les tables utilisateur sont protégées par RLS (chaque user ne voit que ses lignes).

create type goal_type as enum ('hypertrophie', 'force', 'perte_de_gras', 'remise_en_forme');
create type rank_tier as enum ('bronze', 'argent', 'or', 'platine', 'diamant');

-- Profil et objectifs
create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  goal goal_type not null default 'hypertrophie',
  experience_level smallint not null default 1 check (experience_level between 1 and 3),
  target_sessions_per_week smallint not null default 5,   -- objectif final
  current_target_sessions smallint not null default 3,    -- objectif de la semaine (montée progressive)
  -- Champs facultatifs pour les rangs (données personnelles : consentement explicite)
  sex text check (sex in ('homme', 'femme', 'autre')),
  bodyweight_kg numeric(5,1),
  birth_year smallint,
  training_years numeric(3,1),
  share_stats boolean not null default false,             -- accepte d'entrer dans les stats agrégées
  rank_mode text not null default 'confiance' check (rank_mode in ('defi', 'confiance')),
  created_at timestamptz not null default now()
);

-- Bibliothèque d'exercices (lecture publique, écriture admin)
create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  muscle_group text not null,
  equipment text,
  cues jsonb not null default '[]',             -- points de contrôle technique
  common_mistakes jsonb not null default '[]',
  media_url text,                               -- image / animation
  default_rep_min smallint not null default 8,
  default_rep_max smallint not null default 12,
  increment_kg numeric(4,2) not null default 2.5
);

-- Programmes
create table programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  goal goal_type not null,
  method text not null,                         -- ex. 'double_progression', 'ppl', 'upper_lower'
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs on delete cascade,
  day_index smallint not null,
  name text not null
);

create table program_day_exercises (
  id uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references program_days on delete cascade,
  exercise_id uuid not null references exercises,
  position smallint not null,
  target_sets smallint not null default 3,
  rep_min smallint not null default 8,
  rep_max smallint not null default 12,
  target_rir smallint not null default 2
);

-- Séances réalisées
create table workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  program_day_id uuid references program_days,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  perceived_effort smallint check (perceived_effort between 1 and 10),
  notes text
);

create table workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts on delete cascade,
  exercise_id uuid not null references exercises,
  set_index smallint not null,
  reps smallint not null,
  weight_kg numeric(5,2) not null,
  rir smallint                                  -- reps en réserve, optionnel
);

-- Check-in du matin (10 secondes)
create table daily_checkins (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  sleep_hours numeric(3,1) not null,
  fatigue smallint not null check (fatigue between 1 and 5),    -- 1 = frais, 5 = épuisé
  soreness smallint not null check (soreness between 1 and 5),  -- 1 = rien, 5 = très courbaturé
  primary key (user_id, day)
);

-- État de gamification
create table rank_state (
  user_id uuid primary key references auth.users on delete cascade,
  points integer not null default 0,
  tier rank_tier not null default 'bronze',
  streak_weeks integer not null default 0,
  best_streak_weeks integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Jauge hebdomadaire : séances faites cette semaine (lundi = début)
create view weekly_gauge with (security_invoker = true) as
select
  p.user_id,
  p.current_target_sessions as target,
  count(w.id) filter (where w.ended_at is not null) as done
from profiles p
left join workouts w
  on w.user_id = p.user_id
  and w.started_at >= date_trunc('week', now())
group by p.user_id, p.current_target_sessions;

-- RLS
alter table profiles enable row level security;
alter table programs enable row level security;
alter table program_days enable row level security;
alter table program_day_exercises enable row level security;
alter table workouts enable row level security;
alter table workout_sets enable row level security;
alter table daily_checkins enable row level security;
alter table rank_state enable row level security;
alter table exercises enable row level security;

create policy "own profile" on profiles for all using (user_id = auth.uid());
create policy "own programs" on programs for all using (user_id = auth.uid());
create policy "own program days" on program_days for all
  using (exists (select 1 from programs p where p.id = program_id and p.user_id = auth.uid()));
create policy "own program exercises" on program_day_exercises for all
  using (exists (select 1 from program_days d join programs p on p.id = d.program_id
                 where d.id = program_day_id and p.user_id = auth.uid()));
create policy "own workouts" on workouts for all using (user_id = auth.uid());
create policy "own sets" on workout_sets for all
  using (exists (select 1 from workouts w where w.id = workout_id and w.user_id = auth.uid()));
create policy "own checkins" on daily_checkins for all using (user_id = auth.uid());
create policy "own rank" on rank_state for all using (user_id = auth.uid());
create policy "exercises readable" on exercises for select using (true);

-- =====================================================================
-- RANGS : niveau mondial (standards) + classement communauté (cohortes)
-- =====================================================================

create type strength_level as enum ('debutant', 'novice', 'intermediaire', 'avance', 'elite');

-- Standards de force : ratio (1RM estimé / poids de corps) par exercice, sexe et niveau.
-- À remplir depuis une source vérifiée et sous licence compatible (ne pas inventer de valeurs).
create table strength_standards (
  exercise_id uuid not null references exercises on delete cascade,
  sex text not null check (sex in ('homme', 'femme')),
  level strength_level not null,
  bw_ratio numeric(4,2) not null,
  source text not null,                          -- traçabilité de la source
  primary key (exercise_id, sex, level)
);
alter table strength_standards enable row level security;
create policy "standards readable" on strength_standards for select using (true);

-- Meilleur 1RM estimé par exercice (Epley, séries de 12 reps max pour rester fiable)
create view best_lifts with (security_invoker = true) as
select
  w.user_id,
  s.exercise_id,
  max(s.weight_kg * (1 + s.reps / 30.0)) as e1rm_kg
from workout_sets s
join workouts w on w.id = s.workout_id
where s.reps between 1 and 12
group by w.user_id, s.exercise_id;

-- Cohortes : sexe + tranche de poids (10 kg) + ancienneté. Agrégats uniquement, jamais de ligne individuelle.
-- Seuil minimal : une cohorte n'est exposée qu'à partir de 200 utilisateurs (anonymat + stats significatives).
create materialized view cohort_percentiles as
with lifts as (
  select
    p.sex,
    (floor(p.bodyweight_kg / 10) * 10)::int as weight_class,
    case
      when p.training_years < 1 then 'moins_1_an'
      when p.training_years < 3 then '1_3_ans'
      else 'plus_3_ans'
    end as experience,
    b.exercise_id,
    b.user_id,
    b.e1rm_kg / p.bodyweight_kg as ratio
  from best_lifts b
  join profiles p on p.user_id = b.user_id
  where p.share_stats
    and p.sex in ('homme', 'femme')
    and p.bodyweight_kg is not null
    and p.training_years is not null
)
select
  sex, weight_class, experience, exercise_id,
  count(*) as n,
  percentile_cont(0.10) within group (order by ratio) as p10,
  percentile_cont(0.25) within group (order by ratio) as p25,
  percentile_cont(0.50) within group (order by ratio) as p50,
  percentile_cont(0.75) within group (order by ratio) as p75,
  percentile_cont(0.90) within group (order by ratio) as p90
from lifts
group by sex, weight_class, experience, exercise_id
having count(*) >= 200;

-- À rafraîchir périodiquement (ex. nuit) : refresh materialized view cohort_percentiles;
grant select on cohort_percentiles to authenticated;
