// Copyright 2026 massivehadron.com ltd.

import {button, element} from './ui.js';

export function createFirebot(tablet) {
  const data = tablet.data.tablet.firebot;
  const news = Array.isArray(data?.news) ? data.news.filter(story => typeof story?.title === 'string') : [];
  const results = Array.isArray(data?.results) ?
    data.results.filter(result => typeof result?.title === 'string' && typeof result.host === 'string') : [];
  const content = element('div', 'firebot-content');
  const query = element('input', 'firebot-query');
  query.type = 'search';
  query.value = typeof data?.defaultQuery === 'string' ? data.defaultQuery : '';
  query.autocomplete = 'off';
  query.setAttribute('aria-label', 'Search the BotWeb');
  const search = element('button', 'firebot-search-button', 'Search');
  search.type = 'submit';
  const form = element('form', 'firebot-search', query, search);
  form.setAttribute('role', 'search');
  const home = button('Browser home', () => showHome(true));
  const toolbar = element('header', 'firebot-toolbar',
    element('div', 'firebot-brand', tablet.art('firebot'), element('h2', '', 'Firebot')),
    home, form);
  const view = element('section', 'firebot', toolbar, content);

  function show(heading, body, focus = true) {
    const title = element('h3', '', heading);
    title.tabIndex = -1;
    content.replaceChildren(title, body);
    view.scrollTop = 0;
    if (focus) title.focus({preventScroll: true});
  }

  function showHome(focus) {
    home.hidden = true;
    const stories = news.map(({title, summary}) => element('article', 'firebot-story',
      element('h4', '', title), element('p', '', summary)));
    if (!stories.length) {
      show('Eggbot news', element('p', 'muted', data ? 'There’s no news yet.' : 'Firebot content is unavailable.'), focus);
      return;
    }
    show('Eggbot news', element('div', 'firebot-news', ...stories), focus);
  }

  function showResults() {
    home.hidden = false;
    if (!results.length) {
      show('Search results', element('p', 'muted', data ? 'No results found.' : 'Firebot content is unavailable.'));
      return;
    }
    const listings = results.map(({title, host, price, description}) => {
      const link = element('a', '', title);
      link.href = /^([a-z0-9-]+\.)+invalid$/i.test(host) ? 'https://' + host + '/' : '#firebot';
      link.addEventListener('click', event => {
        event.preventDefault();
        show('This site can’t be reached', element('div', 'firebot-error',
          element('p', '', host + ' didn’t respond.'),
          element('p', 'firebot-error-code', 'ERR_NAME_NOT_RESOLVED'),
          button('Back to results', showResults)));
      });
      return element('li', 'firebot-result', element('small', '', host),
        element('h4', '', link), element('p', '', description), element('strong', '', price));
    });
    show('Search results', element('ul', 'firebot-results', ...listings));
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    showResults();
  });
  showHome(false);
  return {view};
}
