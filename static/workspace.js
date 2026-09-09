/* Presentation and accessibility for the SunRoom workspace. Simulation stays in app.js. */
window.createSunRoomWorkspace = function ({ navigate, pause, retry, openLocation, undo, validate }) {
  const form = document.getElementById('simulation-form');
  const inspector = document.getElementById('inspector');
  const inspectorDialog = document.getElementById('inspector-dialog');
  const mobile = window.matchMedia('(max-width: 980px)');
  const primaryTabs = [...document.querySelectorAll('[data-workspace-mode]')];
  const remembered = { room: 'room-3d', exposure: 'sunlight-map', improve: 'goal-studio' };
  const titles = { room: ['Explore your room', 'See your space in a different light'], exposure: ['Follow the sunlight', 'From a single day to the changing seasons'], improve: ['Find a better balance', 'Explore changes for the way you live'] };
  let selectedInspector = 'window';
  const dialogTriggers = new Map();
  function openDialog(id, trigger = document.activeElement) {
    const dialog = document.getElementById(id);
    if (!dialog || dialog.open) return;
    pause();
    document.querySelector('.workspace-menu').open = false;
    dialogTriggers.set(dialog, trigger);
    dialog.showModal();
    if (id === 'location-dialog') openLocation();
  }
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('close', () => {
      const trigger = dialogTriggers.get(dialog);
      if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
  document.querySelectorAll('[data-open-dialog]').forEach(button => button.addEventListener('click', () => openDialog(button.dataset.openDialog, button)));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close()));
  function placeInspector() {
    if (mobile.matches) inspectorDialog.append(inspector);
    else {
      if (inspectorDialog.open) inspectorDialog.close();
      document.getElementById('inspector-slot').append(inspector);
    }
  }
  mobile.addEventListener('change', placeInspector);
  placeInspector();
  function showInspector(kind = selectedInspector, { open = true } = {}) {
    selectedInspector = kind;
    document.querySelectorAll('[data-inspector-pane]').forEach(pane => { pane.hidden = pane.dataset.inspectorPane !== kind; });
    document.querySelectorAll('[data-inspector]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.inspector === kind)));
    document.getElementById('inspector-title').textContent = { room: 'Room settings', window: 'Window details', furniture: 'Arrange furniture' }[kind];
    if (kind === 'furniture') inspector.querySelector('.furniture-tools').open = true;
    if (open && mobile.matches) openDialog('inspector-dialog');
  }
  document.querySelectorAll('[data-inspector]').forEach(button => button.addEventListener('click', () => showInspector(button.dataset.inspector)));
  document.querySelector('[data-open-inspector]').addEventListener('click', () => showInspector());
  document.getElementById('mobile-camera-preset').addEventListener('change', event => document.querySelector(`[data-room3d-camera-preset="${event.target.value}"]`).click());
  function setView(view) {
    const mode = ['room-3d', 'current'].includes(view) ? 'room' : view === 'goal-studio' ? 'improve' : 'exposure';
    remembered[mode] = view;
    form.dataset.mode = mode;
    form.dataset.view = view;
    const timeline = document.getElementById('room3d-animation-controls');
    if (mode === 'room') document.getElementById('room3d-reading').before(timeline);
    else document.querySelector('.view-bar').after(timeline);
    primaryTabs.forEach(button => {
      const active = button.dataset.workspaceMode === mode;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[data-view-group]').forEach(button => { button.hidden = button.dataset.viewGroup !== mode; });
    document.querySelector('.room3d-toolbar').hidden = view !== 'room-3d';
    document.getElementById('workspace-content').setAttribute('aria-labelledby', `mode-${mode}`);
    document.getElementById('workspace-title').textContent = titles[mode][0];
    document.getElementById('workspace-kicker').textContent = titles[mode][1];
  }
  primaryTabs.forEach((button, index) => {
    button.addEventListener('click', () => navigate(remembered[button.dataset.workspaceMode]));
    button.addEventListener('keydown', event => {
      const next = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      primaryTabs[next].click();
      primaryTabs[next].focus();
    });
  });
  function setFieldError(input, message) {
    const id = `${input.id || input.name}-error`;
    let error = document.getElementById(id);
    if (message && !error) {
      error = document.createElement('small');
      error.id = id;
      error.className = 'field-error';
      input.insertAdjacentElement('afterend', error);
      input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
    }
    input.setAttribute('aria-invalid', String(Boolean(message)));
    if (error) { error.textContent = message; error.hidden = !message; }
  }
  form.querySelectorAll('input[type=number], input[type=date], input[type=time]').forEach(input => {
    input.addEventListener('input', () => {
      setFieldError(input, input.validity.valid && input.value !== '' ? '' : input.validationMessage || 'Enter a value to update the preview.');
      if (input.name.startsWith('window_') && input.validity.valid && input.value !== '') validate();
    });
  });
  document.getElementById('retry-update').addEventListener('click', retry);
  document.getElementById('design-undo-button').addEventListener('click', undo);
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey && !event.target.closest('input, textarea, select, [contenteditable]')) {
      if (!document.getElementById('design-undo-button').disabled) { event.preventDefault(); undo(); }
    }
  });
  return {
    setView, showInspector, setFieldError,
    update(payload) {
      document.getElementById('workspace-location').textContent = payload.form_values?.location_name || form.elements.location_name.value || 'Custom location';
      const date = document.getElementById('selected-date-input').value;
      document.getElementById('example-label').hidden = date !== '2025-01-15';
    },
    status(state) {
      document.getElementById('retry-update').hidden = state !== 'error';
      document.getElementById('workspace-content').setAttribute('aria-busy', String(state === 'loading' || state === 'pending'));
      if (state === 'idle') document.getElementById('design-error').hidden = true;
    },
  };
};
