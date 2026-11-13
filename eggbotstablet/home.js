// Copyright 2026 massivehadron.com ltd.

import {button, element} from './ui.js';
import {createSlideGesture} from './slide.js';

export function createHomePager(viewport, navigation, pages) {
  const grids = pages.map(() => element('div', 'app-grid'));
  const panels = grids.map(grid => element('div', 'home-page', grid));
  const track = element('div', 'slide-track', ...panels);
  const dots = pages.map((_, index) => {
    const dot = button('', () => goTo(index));
    dot.setAttribute('aria-label', 'Home page ' + (index + 1));
    return dot;
  });
  let page = 0;
  const slider = createSlideGesture(viewport, track, {
    step: direction => goTo(page + direction),
    constrain(position, width) {
      const limit = -(pages.length - 1) * width;
      const bounded = Math.max(limit, Math.min(0, position));
      return bounded + (position - bounded) * .25;
    }
  });

  viewport.append(track);
  navigation.append(...dots);
  updateActivePage();

  function updateActivePage() {
    panels.forEach((panel, index) => {
      panel.inert = index !== page;
      if (index === page) dots[index].setAttribute('aria-current', 'page');
      else dots[index].removeAttribute('aria-current');
    });
  }

  function goTo(index) {
    const next = Math.max(0, Math.min(pages.length - 1, index));
    const previous = page;
    slider.slideTo(-next * 100);

    page = next;
    if (page === previous) return;
    const focused = document.activeElement;
    if (panels[previous].contains(focused) || focused === dots[previous]) {
      dots[page].focus({preventScroll: true});
    }
    updateActivePage();
  }

  return {
    goTo, cancelDrag: slider.cancel,
    step(direction) { goTo(page + direction); },
    render(createIcon) {
      grids.forEach((grid, index) => grid.replaceChildren(...pages[index].map(createIcon).filter(Boolean)));
    }
  };
}
