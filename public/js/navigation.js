export const TOOL_TABS = ['budines', 'truco', 'metronome', 'tuner'];

export function initToolNavigation({
  nav = document.querySelector('#bottom-tabs'),
  panels = [...document.querySelectorAll('[data-tool-panel]')],
  initialTab = 'budines',
  allowedTabs = TOOL_TABS,
  onChange = () => {}
} = {}) {
  if (!nav) {
    return null;
  }

  const normalizedAllowedTabs = allowedTabs.filter((tab) => TOOL_TABS.includes(tab));
  const tabs = normalizedAllowedTabs.length ? normalizedAllowedTabs : TOOL_TABS;
  const buttons = [...nav.querySelectorAll('[data-tool-tab]')].filter((button) => tabs.includes(button.dataset.toolTab));
  const panelMap = new Map(panels.filter((panel) => tabs.includes(panel.dataset.toolPanel)).map((panel) => [panel.dataset.toolPanel, panel]));
  let currentTab = tabs.includes(initialTab) ? initialTab : tabs[0];

  nav.addEventListener('click', (event) => {
    const button = findTabButton(event);
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
    if (!tabs.includes(tab)) {
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

    document.body.dataset.activeTool = currentTab;
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

function findTabButton(event) {
  const target = event.target;
  if (target?.closest) {
    return target.closest('[data-tool-tab]');
  }

  return event
    .composedPath?.()
    .find((node) => node?.dataset?.toolTab);
}
