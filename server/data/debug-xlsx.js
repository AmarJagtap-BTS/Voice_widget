const XLSX = require('xlsx');
const wb = XLSX.readFile('server/knowledge-base/default/SCH_single sheet data.xlsx', { cellDates: true, cellNF: true });
const sheet = wb.Sheets['Base_Data'];
const range = XLSX.utils.decode_range(sheet['!ref']);
let weekCol = -1, dateCol = -1;
for (let c = range.s.c; c <= range.e.c; c++) {
  const addr = XLSX.utils.encode_cell({ r: 0, c });
  const cell = sheet[addr];
  const v = cell ? String(cell.v).trim() : '';
  if (v === 'Week') weekCol = c;
  if (v === 'Date') dateCol = c;
}
console.log('Week col index:', weekCol, '| Date col index:', dateCol);
for (let r = 1; r <= 5; r++) {
  const wAddr = XLSX.utils.encode_cell({ r, c: weekCol });
  const dAddr = XLSX.utils.encode_cell({ r, c: dateCol });
  console.log('Row', r, '| Week cell:', JSON.stringify(sheet[wAddr]), '| Date cell:', JSON.stringify(sheet[dAddr]));
}
