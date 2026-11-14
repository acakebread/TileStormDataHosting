// Copyright 2026 massivehadron.com ltd.

import {button, element} from './ui.js';

const defaultQuery = 'best place to find cheap robot accessories';

const news = [
  ['Botfield depot opens a second charging bay', 'The second bay is open to everyone who can find the key. The Foreman says he put it somewhere safe.'],
  ['Eggbot finishes a shift with 12% battery', 'The Tile Crew called it a new personal best. Management asked if he could cover tomorrow.'],
  ['Botville’s pothole gets a name', 'Residents voted to call it Barry. The council has fitted a sign and postponed the repair.']
];

const results = [
  ['Chrome wheel hubs, set of four', 'sparebits.invalid', 'From $4.99', 'Bring back that showroom shine. Fits most Eggbot axles with some persuasion.'],
  ['Refurbished Platinumion batteries', 'volt-bargains.invalid', 'From $12.00', 'A full charge in as little as six hours. Tested on a charger that usually works.'],
  ['All-terrain tyres for small chassis', 'budget-treads.invalid', '$8.50 a pair', 'Extra grip on wet tiles, loose grout and the ramp outside the depot.'],
  ['Gold-tipped signal booster antenna', 'antenna-outlet.invalid', 'From $3.75', 'Pick up BotsUp alerts from across the workshop, even from inside the tool cupboard.'],
  ['Low-noise cooling fan kit', 'quiet-gears.invalid', '$6.25', 'Keep your motherboard cool on long shifts. Includes three of the four mounting screws.'],
  ['Emergency oil and bearing set', 'oil-and-bolts.invalid', '$2.99', 'Two bearings, a sample of premium oil and a sticker to cover the warning light.']
];

export function createFirebot(tablet) {
  const content = element('div', 'firebot-content');
  const query = element('input', 'firebot-query');
  query.type = 'search';
  query.value = defaultQuery;
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
    const stories = news.map(([headline, summary]) => element('article', 'firebot-story',
      element('h4', '', headline), element('p', '', summary)));
    show('Eggbot news', element('div', 'firebot-news', ...stories), focus);
  }

  function showResults() {
    home.hidden = false;
    const listings = results.map(([name, domain, price, description]) => {
      const link = element('a', '', name);
      link.href = 'https://' + domain + '/';
      link.addEventListener('click', event => {
        event.preventDefault();
        show('This site can’t be reached', element('div', 'firebot-error',
          element('p', '', domain + ' didn’t respond.'),
          element('p', 'firebot-error-code', 'ERR_NAME_NOT_RESOLVED'),
          button('Back to results', showResults)));
      });
      return element('li', 'firebot-result', element('small', '', domain),
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
