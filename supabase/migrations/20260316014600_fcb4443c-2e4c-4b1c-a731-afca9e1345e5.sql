
-- 1. DELETE empty "instruction main" rule
DELETE FROM agent_knowledge WHERE id = 'da26d2d0-f2a7-411f-ba6f-34de40699a76';

-- 2. DELETE duplicate Corrected Human Method (older version)
DELETE FROM agent_knowledge WHERE id = 'a9fd2d59-40fa-44c1-bc5e-076336d15d1e';

-- 3. FIX double-prefix on learned rule
UPDATE agent_knowledge
SET content = '[Methodology only]: NEVER assume standard lap splice lengths or concrete cover without explicit confirmation from project documents or general notes.'
WHERE id = '6db9feef-1887-4950-8fdf-4fecc6a462d2';

-- 4. MERGE Cluster A: Consolidate assumptions/missing info rules (user 71a25c13)
UPDATE agent_knowledge
SET content = 'ALWAYS explicitly state assumptions, missing details, and scope exclusions before proceeding. Distinguish industry-norm assumptions from drawing-specific data. Proactively ask for missing critical rebar details rather than assuming zero quantity. Provide a reconciliation/risk report before proceeding with any assumed values. Explicitly state assumptions about concrete cover when drawings do not specify it.',
    title = 'Auto-learned (consolidated: assumptions and missing info)'
WHERE id = '794fde9e-b0c2-4b27-a9ec-c82c9fc5929a';

DELETE FROM agent_knowledge WHERE id IN (
  'a065b072-e5a8-4161-95f3-baa4dba30c15',
  '64a8d565-eb61-413f-b917-c71050b49868',
  '8bde85bd-1deb-407b-a5cc-708b48229ad4',
  'd00f0c1c-42f7-4149-94a2-2d0442d27f77',
  'fbb153cf-41ef-4f8a-934c-add7b4c6b2c9'
);

-- 5. MERGE Cluster B: Consolidate current project data rules (user c67880f7)
UPDATE agent_knowledge
SET content = '[Methodology only]: ALWAYS use data exclusively from the current project drawings. Explicit dimensions on plans take precedence over scaled measurements. Cross-reference dimensions with explicit notes on drawings as these often override calculated perimeters. Prioritize identifying explicitly stated scope of work rather than attempting broad identification.',
    title = 'Auto-learned (consolidated: current project data only)'
WHERE id = 'acfbed4c-09a2-47fe-8dfa-5f45d026c19b';

DELETE FROM agent_knowledge WHERE id = '4555f467-379d-45c5-8ec2-acce67220c64';
