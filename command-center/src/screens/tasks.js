// Tasks — PHASE1-SPEC.md §9.3. CRUD, linked to project or standalone.

import { esc, setHeader, withErrorToast } from '../lib/ui.js';
import { listTasks, listProjects } from '../lib/queries.js';
import { CreateTask, UpdateTask, CompleteTask } from '../lib/actions.js';

function view() { return document.getElementById('view'); }

export async function renderTasks() {
  setHeader('WORK QUEUE', 'Tasks');
  const [tasks, projects] = await Promise.all([listTasks(), listProjects()]);
  const projectTitle = (id) => projects.find((p) => p.id === id)?.title;
  const order = { open: 0, doing: 1, done: 2 };
  const sorted = [...tasks].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  view().innerHTML = `
    <div class="card">
      <div class="kicker">NEW TASK</div>
      <div class="grid two">
        <div class="field"><label>TITLE</label><input id="newTaskTitle" placeholder="Write the customer path copy"></div>
        <div class="field"><label>PROJECT (OPTIONAL)</label>
          <select id="newTaskProject"><option value="">Standalone</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>PRIORITY</label>
          <select id="newTaskPriority"><option value="low">Low</option><option value="normal" selected>Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select>
        </div>
        <div class="field"><label>DUE DATE</label><input id="newTaskDue" type="date"></div>
      </div>
      <div class="actions"><button class="btn primary" id="addTask">ADD TASK</button></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">ALL TASKS</div>
      ${sorted.length ? sorted.map((t) => `
        <div class="inventory-row">
          <div>
            <div class="kicker">${esc(t.priority.toUpperCase())}${t.project_id ? ` · ${esc(projectTitle(t.project_id) || 'unknown project')}` : ' · STANDALONE'}</div>
            <strong>${esc(t.title)}</strong>
            <div class="muted">${t.due_date ? `due ${esc(t.due_date)}` : 'no due date'}</div>
          </div>
          <div class="actions">
            <select data-status="${esc(t.id)}">
              <option value="open" ${t.status === 'open' ? 'selected' : ''}>Open</option>
              <option value="doing" ${t.status === 'doing' ? 'selected' : ''}>Doing</option>
              <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
            </select>
            ${t.status !== 'done' ? `<button class="btn primary" data-complete="${esc(t.id)}">COMPLETE</button>` : ''}
          </div>
        </div>`).join('') : '<p class="muted">No tasks yet — add one above.</p>'}
    </div>`;

  document.getElementById('addTask').onclick = () => withErrorToast(async () => {
    const title = document.getElementById('newTaskTitle').value.trim();
    if (!title) return;
    await CreateTask({
      title,
      projectId: document.getElementById('newTaskProject').value || null,
      priority: document.getElementById('newTaskPriority').value,
      dueDate: document.getElementById('newTaskDue').value || null,
    });
    renderTasks();
  });
  view().querySelectorAll('[data-status]').forEach((sel) => sel.onchange = () => withErrorToast(async () => {
    await UpdateTask({ id: sel.dataset.status, status: sel.value });
    renderTasks();
  }));
  view().querySelectorAll('[data-complete]').forEach((b) => b.onclick = () => withErrorToast(async () => {
    await CompleteTask({ id: b.dataset.complete });
    renderTasks();
  }));
}
