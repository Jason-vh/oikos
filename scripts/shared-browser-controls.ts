import assert from 'node:assert/strict';
import type { Dialog } from 'playwright';
import type { Connection } from './shared-browser-fixture';

export async function observeBlocked(peer: Connection) {
  await peer.page.waitForFunction(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="connection"]');
    return panel && !panel.hidden && /Disconnected|Reconnecting/.test(panel.textContent ?? '');
  });
}

export async function pageReady(peer: Connection, writing = false) {
  await peer.page.waitForFunction(({ expected, owned, writing }) => {
    const game = (window as any).oikos;
    const panel = document.querySelector<HTMLElement>('[data-testid="connection"]');
    if (!game || !panel?.hidden || JSON.stringify(game.state) !== expected) return false;
    const { activeId, viewedId } = game.cityContext;
    if (owned.length ? !owned.includes(activeId) : activeId !== null) return false;
    if (viewedId !== null && !game.state.cities.some((city: any) => city.id === viewedId)) return false;
    return !writing || activeId !== null && viewedId === activeId;
  }, { expected: JSON.stringify(peer.snapshot.world), owned: peer.snapshot.session.ownedCityIds, writing });
}

export async function chooseDiscard(peer: Connection, confirm: boolean) {
  let handled = 0;
  let nativeConfirm = true;
  const native = async (dialog: Dialog) => {
    handled++;
    nativeConfirm = dialog.type() === 'confirm';
    if (confirm) await dialog.accept();
    else await dialog.dismiss();
  };
  const navigations = peer.navigations.length;
  peer.page.on('dialog', native);
  try {
    await peer.page.getByTestId('discard-pending').click({ noWaitAfter: true });
    if (!handled) {
      const discard = /^(?:yes[,\s]+)?(?:discard|abandon)\b/i;
      const dialogs = peer.page.getByRole('dialog').or(peer.page.getByRole('alertdialog'));
      const dialog = dialogs.filter({ visible: true, has: peer.page.getByRole('button', { name: discard }) });
      await dialog.waitFor({ state: 'visible', timeout: 3000 });
      const cancel = /cancel|keep|back|close|^no(?:,|$)/i;
      assert.equal(await dialog.getByRole('button', { name: cancel }).first().isEnabled(), true, 'DOM confirmation exposes cancellation');
      const action = confirm ? discard : cancel;
      await dialog.getByRole('button', { name: action }).first().click({ noWaitAfter: true });
      handled++;
    }
    assert.equal(nativeConfirm, true, 'native discard dialog must be cancellable');
    assert.equal(handled, 1, 'discard has one explicit cancellable confirmation');
    assert.equal(peer.navigations.length, navigations, 'discard did not navigate');
  } finally { peer.page.off('dialog', native); }
}
