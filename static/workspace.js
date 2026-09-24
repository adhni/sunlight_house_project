/* Presentation and accessibility for the SunRoom workspace. Simulation stays in app.js. */
window.createSunRoomWorkspace = function ({ navigate, pause, retry, openLocation, undo, validate, setExploreActive }) {
  const form = document.getElementById('simulation-form');
  const inspector = document.getElementById('inspector');
  const inspectorDialog = document.getElementById('inspector-dialog');
  const exploreDialog = document.getElementById('room3d-explore-dialog');
  const exploreButton = document.getElementById('room3d-explore');
  const exploreEditor = document.getElementById('explore-editor');
  const exploreEditButton = document.getElementById('explore-edit');
  let exploreActive = false;
  let exploreReturnPoints = [];
  let exploreScroll = 0;
  let desktopEditorOpen = true;
  const editButton = document.getElementById('edit-room-button');
  const mobile = window.matchMedia('(max-width: 980px)');
  const primaryTabs = [...document.querySelectorAll('[data-workspace-mode]')];
  const remembered = { room: 'room-3d', exposure: 'sunlight-map', improve: 'goal-studio' };
  const titles = { room: ['Explore your room', 'Sunlight at your selected time'], exposure: ['Follow the sunlight', 'Total direct sunlight over a day or season'], improve: ['Find a better balance', 'Explore changes for the way you live'] };
  let selectedInspector = 'window';
  const dialogTriggers = new Map();
  function openDialog(id, trigger = document.activeElement) {
    const dialog = document.getElementById(id);
    if (!dialog || dialog.open) return;
    pause();
    document.querySelector('.workspace-menu').open = false;
    dialogTriggers.set(dialog, trigger);
    dialog.showModal();
    if (id === 'inspector-dialog') editButton.setAttribute('aria-expanded', 'true');
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
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
    if (exploreActive && button.dataset.closeDialog === 'inspector-dialog') {
      setExploreEditor(false);
      exploreEditButton.focus();
    } else if (button.dataset.closeDialog === 'inspector-dialog' && !mobile.matches && form.dataset.mode !== 'improve') {
      desktopEditorOpen = false;
      placeInspector();
      editButton.focus();
    } else document.getElementById(button.dataset.closeDialog).close();
  }));
  function placeInspector() {
    if (exploreActive) exploreEditor.append(inspector);
    else if (mobile.matches || form.dataset.mode === 'improve') inspectorDialog.append(inspector);
    else {
      if (inspectorDialog.open) inspectorDialog.close();
      document.getElementById('inspector-slot').append(inspector);
    }
    const docked = !mobile.matches && form.dataset.mode !== 'improve';
    form.dataset.editorOpen = String(docked && desktopEditorOpen);
    document.getElementById('inspector-slot').hidden = !docked || !desktopEditorOpen;
    editButton.textContent = docked && desktopEditorOpen ? 'Hide editor' : 'Edit room';
    editButton.setAttribute('aria-expanded', String(docked ? desktopEditorOpen : inspectorDialog.open));
    editButton.setAttribute('aria-controls', docked ? 'inspector-slot' : 'inspector-dialog');
  }
  mobile.addEventListener('change', placeInspector);
  placeInspector();
  function showInspector(kind = selectedInspector, { open = true } = {}) {
    selectedInspector = kind;
    document.querySelectorAll('[data-inspector-pane]').forEach(pane => { pane.hidden = pane.dataset.inspectorPane !== kind; });
    document.querySelectorAll('[data-inspector]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.inspector === kind)));
    document.getElementById('inspector-title').textContent = { room: 'Room settings', window: 'Window details', furniture: 'Arrange furniture' }[kind];
    if (kind === 'furniture') inspector.querySelector('.furniture-tools').open = true;
    if (open && exploreActive) setExploreEditor(true);
    else if (open && (mobile.matches || form.dataset.mode === 'improve')) openDialog('inspector-dialog');
    else if (open) { desktopEditorOpen = true; placeInspector(); }
  }
  document.querySelectorAll('[data-inspector]').forEach(button => button.addEventListener('click', () => showInspector(button.dataset.inspector)));
  editButton.addEventListener('click', () => {
    if (!mobile.matches && form.dataset.mode !== 'improve' && desktopEditorOpen) {
      desktopEditorOpen = false;
      placeInspector();
    } else showInspector();
  });
  inspectorDialog.addEventListener('close', () => {
    editButton.setAttribute('aria-expanded', String(!mobile.matches && form.dataset.mode !== 'improve' && desktopEditorOpen));
  });
  document.getElementById('mobile-camera-preset').addEventListener('change', event => document.querySelector(`[data-room3d-camera-preset="${event.target.value}"]`).click());
  function setExploreEditor(open) {
    exploreEditor.hidden = !open;
    exploreDialog.dataset.editorOpen = String(open);
    exploreEditButton.setAttribute('aria-expanded', String(open));
    exploreEditButton.textContent = open ? 'Hide editor' : 'Edit room';
  }
  function restoreExplore() {
    if (!exploreActive) return;
    exploreActive = false;
    setExploreActive(false);
    exploreReturnPoints.forEach(({ node, marker }) => marker.replaceWith(node));
    exploreReturnPoints = [];
    setExploreEditor(false);
    document.body.classList.remove('is-exploring');
    placeInspector();
    window.scrollTo({ top: exploreScroll, behavior: 'instant' });
    exploreButton.focus({ preventScroll: true });
  }
  function exitExplore() {
    if (!exploreActive) return;
    exploreDialog.close();
    restoreExplore();
  }
  exploreButton.addEventListener('click', () => {
    if (exploreActive) return;
    exploreScroll = window.scrollY;
    exploreActive = true;
    const move = (node, slot) => {
      const marker = document.createComment('Explore return point');
      node.before(marker);
      exploreReturnPoints.push({ node, marker });
      document.getElementById(slot).append(node);
    };
    move(document.getElementById('result-panel-room-3d'), 'explore-model-slot');
    move(document.querySelector('.room3d-toolbar'), 'explore-camera-slot');
    move(document.getElementById('room3d-animation-controls'), 'explore-timeline-slot');
    move(document.getElementById('design-undo-button'), 'explore-undo-slot');
    move(document.querySelector('.workspace-status'), 'explore-status-slot');
    move(inspector, 'explore-editor');
    document.querySelector('.room3d-display-options').open = false;
    document.body.classList.add('is-exploring');
    exploreDialog.showModal();
    setExploreActive(true);
  });
  exploreDialog.addEventListener('close', restoreExplore);
  document.getElementById('explore-exit').addEventListener('click', exitExplore);
  exploreEditButton.addEventListener('click', () => {
    if (exploreEditor.hidden) {
      showInspector();
      inspector.querySelector('.inspector-tabs [aria-pressed=true]').focus();
    } else setExploreEditor(false);
  });
  function setView(view) {
    // Also restore the workspace if WebGL falls back while Explore is open.
    if (exploreActive && view !== 'room-3d') exitExplore();
    const mode = ['room-3d', 'current'].includes(view) ? 'room' : view === 'goal-studio' ? 'improve' : 'exposure';
    remembered[mode] = view;
    form.dataset.mode = mode;
    form.dataset.view = view;
    placeInspector();
    const timeline = document.getElementById('room3d-animation-controls');
    if (exploreActive) document.getElementById('explore-timeline-slot').append(timeline);
    else if (mode === 'room') document.getElementById('room3d-reading').before(timeline);
    else document.querySelector('.view-bar').after(timeline);
    primaryTabs.forEach(button => {
      const active = button.dataset.workspaceMode === mode;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[data-view-group]').forEach(button => { button.hidden = button.dataset.viewGroup !== mode; });
    document.querySelector('.room3d-toolbar').hidden = view !== 'room-3d';
    const description = document.getElementById('view-description');
    description.hidden = mode !== 'exposure';
    description.textContent = view === 'long-range'
      ? 'Each colour shows the estimated total hours of direct sunlight over the selected season or year. For a particular hour, open Room.'
      : 'Each colour shows the total hours of direct sunlight across the selected day. For a particular hour, open Room.';
    const periodLabel = document.querySelector('.timeline-date label');
    periodLabel.textContent = mode === 'improve' ? 'Reference date' : 'Date';
    document.getElementById('set-now-button').textContent = mode === 'room' ? 'Use current time' : "Use today's date";

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
