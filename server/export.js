import ExcelJS from 'exceljs';

const STATUS = { not_started: 'Não iniciada', in_progress: 'Em andamento', paused: 'Pausada', done: 'Concluída', late: 'Atrasada', cancelled: 'Cancelada' };
const PRIORITY = { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' };
const hours = (s) => Math.round((s / 3600) * 100) / 100;

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map(([header, key, width = 16]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0073EA' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  rows.forEach((r) => ws.addRow(r));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

export function buildWorkbook(d, { from, to, company }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gestão de Demandas';
  const s = d.summary;
  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [{ width: 38 }, { width: 22 }];
  [
    ['Empresa', company], ['Período', `${from} a ${to}`],
    ['Tarefas planejadas', s.tasks], ['Tarefas concluídas', s.done],
    ['Atingimento (%)', s.tasks ? Math.round((s.done / s.tasks) * 1000) / 10 : 0],
    ['Horas apontadas', hours(s.seconds)], ['Horas estimadas (tarefas do período)', Math.round((s.estimated_minutes / 60) * 100) / 100],
    ['Horas estimadas (concluídas)', Math.round((d.estVsActual.estimated_minutes / 60) * 100) / 100],
    ['Horas realizadas (concluídas)', Math.round((d.estVsActual.actual_minutes / 60) * 100) / 100],
  ].forEach((r) => resumo.addRow(r));
  resumo.getColumn(1).font = { bold: true };

  sheet(wb, 'Por colaborador', [['Colaborador', 'name', 28], ['Planejadas', 'planned'], ['Concluídas', 'done'], ['Atrasadas', 'late'], ['Atingimento %', 'percent'], ['Horas', 'hours'], ['Tempo médio/tarefa (min)', 'avg', 24]],
    d.users.map((u) => ({ ...u, hours: hours(u.seconds), avg: Math.round(u.avg_seconds / 60) })));
  sheet(wb, 'Tempo por categoria', [['Categoria', 'category', 28], ['Tarefas', 'tasks'], ['Horas', 'hours']], d.byCategory.map((r) => ({ ...r, hours: hours(r.seconds) })));
  sheet(wb, 'Atividades + tempo', [['Atividade', 'activity', 40], ['Categoria', 'category', 22], ['Ocorrências', 'occurrences'], ['Horas', 'hours'], ['Estimado médio (min)', 'avg_estimated_minutes', 20]],
    d.topActivities.map((r) => ({ ...r, hours: hours(r.seconds) })));
  sheet(wb, 'Atrasos por categoria', [['Categoria', 'category', 28], ['Tarefas', 'tasks'], ['Com atraso', 'late'], ['Índice de atraso %', 'late_rate', 20]], d.lateByCategory);
  sheet(wb, 'Estimado x Realizado', [['Tarefa', 'title', 40], ['Responsável', 'assignee', 24], ['Estimado (min)', 'estimated_minutes'], ['Realizado (min)', 'actual_minutes'], ['Diferença (min)', 'diff']],
    d.estVsActual.tasks.map((t) => ({ ...t, diff: t.actual_minutes - t.estimated_minutes })));
  sheet(wb, 'Evolução diária', [['Data', 'date', 14], ['Planejadas', 'planned'], ['Concluídas no dia', 'completed', 18], ['Atingimento %', 'percent'], ['Horas', 'hours']],
    d.evolution.map((r) => ({ ...r, hours: hours(r.seconds) })));
  sheet(wb, 'Tarefas', [
    ['ID', 'id', 8], ['Tipo', 'kind', 10], ['Tarefa', 'title', 40], ['Responsável', 'assignee', 22], ['Categoria', 'category', 18], ['Prioridade', 'priority', 12],
    ['Status', 'status', 14], ['Data planejada', 'planned_date', 15], ['Data atual/prazo', 'due_date', 16], ['Estimado (min)', 'estimated_minutes', 15],
    ['Realizado (min)', 'actual', 15], ['Transferências', 'rollover_count', 14], ['Início', 'started_at', 18], ['Conclusão', 'completed_at', 18], ['Observações', 'notes', 40],
  ], d.tasks.map((t) => ({ ...t, kind: t.kind === 'daily' ? 'Diária' : 'Semanal', status: STATUS[t.status], priority: PRIORITY[t.priority], actual: Math.round(t.tracked_seconds / 60) })));
  return wb;
}
