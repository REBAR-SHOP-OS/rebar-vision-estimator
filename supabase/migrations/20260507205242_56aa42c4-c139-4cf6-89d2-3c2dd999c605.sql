
DELETE FROM public.estimate_items WHERE project_id='3aa61dc8-5a84-43af-89c4-de052135201c';

WITH ctx AS (
  SELECT
    '3aa61dc8-5a84-43af-89c4-de052135201c'::uuid AS pid,
    '71a25c13-e42c-4d4f-902f-029798b5b441'::uuid AS uid,
    '026bbec7-a4cf-4d40-afe8-1e6e0165f0d7'::uuid AS s_foot,
    '28c82d6c-dc36-489e-a077-961da0292e87'::uuid AS s_pier,
    '1f0d32e6-c6e6-4214-b936-83615de432d0'::uuid AS s_wall,
    'fb57ddda-dec1-4645-b0cd-c5ebe2979dc1'::uuid AS s_step
)
INSERT INTO public.estimate_items
  (project_id, user_id, segment_id, item_type, description, bar_size, quantity_count, total_length, total_weight, status, confidence, assumptions_json)
SELECT pid, uid, segment_id, 'rebar', description, bar_size, qty, len_m, wt, 'verified', 1.0, jsonb_build_object('source','LONDON_CRU1-7.xlsx','mark',mark)
FROM ctx,
(VALUES
  -- FOOTINGS (F1-F8 + F2 steps)
  ('F1','15M @250 BEW',        '15M', 10,    8.5,  13.345, (SELECT s_foot FROM ctx)),
  ('F2','15M @250 BEW',        '15M', 168, 226.8, 356.076, (SELECT s_foot FROM ctx)),
  ('F3','15M @250 BEW',        '15M', 144, 208.8, 327.816, (SELECT s_foot FROM ctx)),
  ('F4','15M @250 BEW',        '15M', 126, 195.3, 306.621, (SELECT s_foot FROM ctx)),
  ('F5','15M @250 BEW',        '15M',  56,  92.4, 145.068, (SELECT s_foot FROM ctx)),
  ('F6','15M @250 BEW',        '15M',  32,  59.2,  92.944, (SELECT s_foot FROM ctx)),
  ('F7','15M @250 BEW',        '15M',  16,  31.2,  48.984, (SELECT s_foot FROM ctx)),
  ('F8','15M @250 BEW',        '15M',  72, 147.6, 231.732, (SELECT s_foot FROM ctx)),
  ('F2-2STEP','15M @250 BEW',  '15M',   6,  24.3,  38.151, (SELECT s_foot FROM ctx)),
  ('F2-2STEP','15M @250 BEW',  '15M',  18,  24.3,  38.151, (SELECT s_foot FROM ctx)),
  ('F2-1STEP','15M @250 BEW',  '15M',   6,  12.0,  18.840, (SELECT s_foot FROM ctx)),
  ('F2-1STEP','15M @250 BEW',  '15M',   8,  10.8,  16.956, (SELECT s_foot FROM ctx)),
  -- FW (Foundation/Shear Walls)
  ('FW','20M CONT T&B',         '20M',   4, 663.268, 1561.99614, (SELECT s_wall FROM ctx)),
  ('FW','15M @610 DOWEL',       '15M', 486, 222.102,  348.70014, (SELECT s_wall FROM ctx)),
  ('FW','15M @406 DOWEL (LT)',  '15M', 365, 419.75,   659.0075,  (SELECT s_wall FROM ctx)),
  -- PIERS
  ('P1','4-15M VERTICAL',       '15M',   4,  6.14,   9.6398,  (SELECT s_pier FROM ctx)),
  ('P1','10M @300 TIES (3 set)','10M',   5,  6.75,   5.29875, (SELECT s_pier FROM ctx)),
  ('P2','4-15M VERTICAL',       '15M',  56, 85.96, 134.9572,  (SELECT s_pier FROM ctx)),
  ('P2','10M @300 TIES (3 set)','10M',  70, 94.5,   74.1825,  (SELECT s_pier FROM ctx)),
  ('P3','4-15M VERTICAL',       '15M',  48, 73.68, 115.6776,  (SELECT s_pier FROM ctx)),
  ('P3','10M @300 TIES (3 set)','10M',  60, 81.0,   63.585,   (SELECT s_pier FROM ctx)),
  ('P4','4-15M VERTICAL',       '15M',  36, 55.26,  86.7582,  (SELECT s_pier FROM ctx)),
  ('P4','10M @300 TIES (3 set)','10M',  45, 60.75,  47.68875, (SELECT s_pier FROM ctx)),
  ('P5','4-15M VERTICAL',       '15M',  16, 24.56,  38.5592,  (SELECT s_pier FROM ctx)),
  ('P5','10M @300 TIES (3 set)','10M',  20, 27.0,   21.195,   (SELECT s_pier FROM ctx)),
  ('P6','4-15M VERTICAL',       '15M',   8, 12.28,  19.2796,  (SELECT s_pier FROM ctx)),
  ('P6','10M @300 TIES (3 set)','10M',  10, 13.5,   10.5975,  (SELECT s_pier FROM ctx)),
  ('P7','4-15M VERTICAL',       '15M',   4,  6.14,   9.6398,  (SELECT s_pier FROM ctx)),
  ('P7','10M @300 TIES (3 set)','10M',   5,  6.75,   5.29875, (SELECT s_pier FROM ctx)),
  ('P8','4-15M VERTICAL',       '15M',  16, 24.56,  38.5592,  (SELECT s_pier FROM ctx)),
  ('P8','10M @300 TIES (3 set)','10M',  20, 27.0,   21.195,   (SELECT s_pier FROM ctx)),
  -- STEPS ON GRADE
  ('SOG','3-10M CONT LONGITUDINAL','10M',  9, 380.187, 298.446795, (SELECT s_step FROM ctx)),
  ('SOG','3-10M CONT TRANSVERSE',  '10M',  9, 226.1115, 177.49753, (SELECT s_step FROM ctx))
) AS v(mark, description, bar_size, qty, len_m, wt, segment_id);
