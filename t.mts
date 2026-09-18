import { parseTaskInput, splitTasks } from './src/parser/taskParser.js';
const NOW = new Date(2026, 8, 18);
for (const c of [
  'Починить фильтры #багфикс #mobile, завтра, 2h',
  'Срочная задача !важно, 20.09, 1h',
  'Критичный баг !5, сегодня, 30m #prod',
  'Обычная задача, завтра, 1h'
]) console.log(JSON.stringify(parseTaskInput(c, NOW)));
console.log('--- batch ---');
console.log(JSON.stringify(splitTasks('Задача 1, завтра, 1h\n---\nЗадача 2, 20.09, 2h\nописание второй\n---\nЗадача 3, 25.09, 30m')));
