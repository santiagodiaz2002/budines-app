export const TOOL_TABS = ['budines', 'truco', 'metronome', 'tuner'];

export function initToolNavigation({
  nav = document.querySelector('#bottom-tabs'),
  panels = [...document.querySelectorAll('[data-tool-panel]')],
  initialTab = 'budines',
  onChange = () => {}
} = {}) {
  if (!nav) {
    return null;
  }

  const buttons = [...nav.querySelectorAll('[data-tool-tab]')];
  const panelMap = new Map(panels.map((panel) => [panel.dataset.toolPanel, panel]));
  let currentTab = TOOL_TABS.includes(initialTab) ? initialTab : 'budines';

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tool-tab]');
    if (!button) {
      return;
    }
    selectTab(button.dataset.toolTab);
  });

  nav.addEventListener('keydown', (event) => {
    const activeIndex = buttons.findIndex((button) => button.dataset.toolTab === currentTab);
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (activeIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
    selectTab(buttons[nextIndex].dataset.toolTab);
  });

  function selectTab(tab) {
    if (!TOOL_TABS.includes(tab)) {
      return;
    }
    currentTab = tab;

    for (const button of buttons) {
      const active = button.dataset.toolTab === currentTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    }

    for (const [name, panel] of panelMap.entries()) {
      panel.hidden = name !== currentTab;
    }

    onChange(currentTab);
  }

  selectTab(currentTab);

  return {
    selectTab,
    get currentTab() {
      return currentTab;
    },
    buttons
  };
}
