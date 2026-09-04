// Backup/Restore — PHASE1-SPEC.md §9.10 / §7.
// The recovery-key acknowledgment step is a real gate: Export is disabled until Nev has checked
// the "I saved this passphrase somewhere physically separate" box at least once (§10 acceptance
// criterion: "cannot be silently skipped").

import { esc, setHeader, withErrorToast, toast } from '../lib/ui.js';
import { exportBackup, restoreBackup, firstRunAcknowledgementNeeded } from '../lib/backup.js';
import { SaveLegacyState } from '../lib/actions.js';
import { getLegacyState } from '../lib/queries.js';

function view() { return document.getElementById('view'); }

export async function renderBackup() {
  setHeader('SURVIVE THE LAPTOP DYING', 'Backup / Restore');
  const needsAck = await firstRunAcknowledgementNeeded();
  const ack = await getLegacyState('recovery_key_acknowledged', null);

  view().innerHTML = `
    <div class="card ${needsAck ? 'glow' : ''}">
      <div class="kicker">RECOVERY PASSPHRASE</div>
      <div class="big">${needsAck ? 'ACKNOWLEDGE BEFORE YOUR FIRST EXPORT' : 'ACKNOWLEDGED'}</div>
      <p class="muted">Every export is encrypted with a passphrase you choose. The Command Center never stores it anywhere remote or recoverable — if it's lost, an exported backup cannot be restored. Save it somewhere physically separate from this laptop: a password manager, a printed copy in a safe place, etc.</p>
      <div class="field"><label><input type="checkbox" id="ackBox" ${ack ? 'checked' : ''} style="width:auto;margin-right:8px"> I understand and will save my recovery passphrase somewhere physically separate from this laptop.</label></div>
      ${ack ? `<p class="muted">Acknowledged ${esc(new Date(ack.at).toLocaleString())}.</p>` : ''}
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">EXPORT BACKUP</div>
      <p class="muted">Produces one encrypted file containing the live SQLite database, timestamped, that you save wherever you choose (Desktop, Documents, Downloads, or a mounted external drive).</p>
      <div class="field"><label>PASSPHRASE (min 8 characters — this becomes the vault password)</label><input id="exportPass" type="password" placeholder="choose a strong passphrase"></div>
      <div class="actions"><button class="btn primary" id="doExport" ${needsAck ? 'disabled' : ''}>EXPORT BACKUP</button></div>
      ${needsAck ? '<p class="muted">Check the acknowledgment box above to enable export.</p>' : ''}
    </div>

    <div class="card" style="margin-top:14px">
      <div class="kicker">RESTORE FROM BACKUP</div>
      <p class="muted">Rebuilds the database and vault from a previously exported file — for a fresh machine or after data loss. The app will reload once restore finishes.</p>
      <div class="field"><label>PASSPHRASE</label><input id="restorePass" type="password" placeholder="the passphrase used for that export"></div>
      <div class="actions"><button class="btn" id="doRestore">CHOOSE FILE & RESTORE</button></div>
    </div>

    <div id="backupStatus" class="card" style="margin-top:14px" hidden></div>`;

  document.getElementById('ackBox').onchange = (e) => withErrorToast(async () => {
    if (e.target.checked) {
      await SaveLegacyState({ key: 'recovery_key_acknowledged', value: { at: new Date().toISOString() } });
    } else {
      await SaveLegacyState({ key: 'recovery_key_acknowledged', value: null });
    }
    renderBackup();
  });

  document.getElementById('doExport').onclick = () => withErrorToast(async () => {
    const pass = document.getElementById('exportPass').value;
    const result = await exportBackup(pass);
    const box = document.getElementById('backupStatus');
    box.hidden = false;
    if (result.cancelled) {
      box.innerHTML = `<p class="muted">Export cancelled — no file was written.</p>`;
    } else {
      box.innerHTML = `<div class="kicker">EXPORT COMPLETE</div><p class="muted">Saved to ${esc(result.path)} at ${esc(result.timestamp)}.</p>`;
      toast('Backup exported.');
    }
  });

  document.getElementById('doRestore').onclick = () => withErrorToast(async () => {
    const pass = document.getElementById('restorePass').value;
    const result = await restoreBackup(pass);
    const box = document.getElementById('backupStatus');
    box.hidden = false;
    if (result.cancelled) {
      box.innerHTML = `<p class="muted">Restore cancelled — nothing was changed.</p>`;
      return;
    }
    box.innerHTML = `<div class="kicker">RESTORE COMPLETE</div><p class="muted">Restored from ${esc(result.restoredFrom)}. Reloading…</p>`;
    setTimeout(() => window.location.reload(), 1200);
  });
}
