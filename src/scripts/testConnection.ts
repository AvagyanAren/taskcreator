/**
 * Read-only EdgeFocus connectivity check. Creates nothing.
 *   npm run test:edgefocus
 */
import { EdgeFocusClient, EdgeFocusError } from '../api/edgefocus.js';
import { ConfigError, loadConfig } from '../config/index.js';
import { formatEstimate, rfc3339ToIsoDay } from '../parser/taskParser.js';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => console.log(`  ✗ ${m}`);

async function main() {
  console.log('Проверка доступа к EdgeFocus API.');
  console.log('Только чтение — ни одна задача не создаётся и не изменяется.\n');

  const config = loadConfig();
  console.log(`Base URL:  ${config.baseUrl}`);
  console.log(`Project:   ${config.projectId}`);
  console.log(`Kanban:    view ${config.kanbanViewId}`);
  console.log(`Table:     view ${config.tableViewId}`);
  console.log(`Bucket:    "${config.targetBucket}"\n`);

  const client = new EdgeFocusClient(config);

  const token = (process.env.EDGEFOCUS_TOKEN ?? '').trim();
  ok(`EDGEFOCUS_TOKEN найден (${token.length} символов, начинается с "${token.slice(0, 3)}")`);

  console.log('\n[0] GET /projects — проверка самого токена');
  const projects = await client.getProjects();
  ok(`токен валиден, доступно проектов: ${projects.length}`);
  const mine = projects.find((p) => p.id === config.projectId);
  if (mine) ok(`проект ${config.projectId} есть в списке — "${mine.title}"`);
  else bad(`проект ${config.projectId} НЕ найден среди доступных токену проектов`);

  console.log('\n[1] GET /projects/{id}');
  const project = await client.getProject();
  ok(`project ${project.id} — "${project.title}"`);

  console.log('\n[2] GET /projects/{id}/views/{view}/buckets');
  const buckets = await client.getBuckets();
  ok(`${buckets.length} bucket(s):`);
  for (const b of buckets) console.log(`      - "${b.title}" (id ${b.id}, ${b.count ?? 0} tasks)`);

  console.log(`\n[3] Looking for bucket "${config.targetBucket}"`);
  const target = buckets.find(
    (b) => (b.title ?? '').trim().toLowerCase() === config.targetBucket.trim().toLowerCase()
  );
  if (!target) {
    bad(`bucket "${config.targetBucket}" NOT found`);
    process.exitCode = 1;
  } else {
    ok(`found — id ${target.id}`);
  }

  console.log('\n[4] GET /projects/{id}/views/{view}/tasks (first 5)');
  const tasks = await client.getViewTasks({ perPage: 5 });
  ok(`${tasks.length} task(s) returned`);
  for (const t of tasks.slice(0, 5)) {
    console.log(
      `      #${t.id} ${t.title} | ${rfc3339ToIsoDay(t.end_date) ?? 'no date'} | ${formatEstimate(t.time_estimate ?? null)}`
    );
  }

  console.log('\nAll read-only checks completed.');
}

main().catch((err) => {
  console.error('\nCheck failed.');
  if (err instanceof ConfigError) console.error(err.message);
  else if (err instanceof EdgeFocusError) {
    console.error(`  ${err.message}`);
    if (err.detail) console.error(`  Technical details:\n  ${err.detail}`);
    if (err.kind === 'auth') {
      console.error('\n  Что делать:');
      console.error('   1. Откройте EdgeFocus в браузере под своей учётной записью.');
      console.error('   2. Аватар (справа сверху) → Settings → API tokens.');
      console.error('   3. Создайте новый токен и отметьте ВСЕ permissions — в частности');
      console.error('      Projects, Tasks, Buckets и Project Views (без них не работают колонки).');
      console.error('   4. Скопируйте значение ЦЕЛИКОМ — оно показывается только один раз.');
      console.error('   5. Замените строку EDGEFOCUS_TOKEN=... в файле .env и запустите проверку снова.');
    }
  } else console.error(err);
  process.exit(1);
});
