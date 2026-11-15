// Copyright 2026 massivehadron.com ltd.

import {button, element, loadSetting, number, saveSetting, shortTime} from './ui.js';

export const osVersion = '9.0';
export const storageCapacityMb = 16000;
export const offloadSizeMb = 4000;
export const tabletProducts = {
  botos_plus: {
    name: 'BotOS Plus',
    description: 'One-time upgrade for timed pauses on notification sounds.',
    icon: 'settings'
  },
  botcloud: {
    name: 'BotCloud',
    description: 'Subscription to offload cached media and free up ' + number.format(offloadSizeMb) + ' MB.',
    monogram: 'Cloud'
  }
};

export function createTabletPreferences() {
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const params = new URLSearchParams(location.search);
  const hasOsUpgrade = localPreview && params.get('preview-botos-plus') === '1';
  const hasCloudSubscription = localPreview && params.get('preview-botcloud') === '1';
  let bannerPosition = loadSetting('notificationPosition', 'top') === 'bottom' ? 'bottom' : 'top';
  let pauseUntil = loadSetting('notificationSoundsPausedUntil', 0);
  let contentOffloaded = loadSetting('contentOffloaded', false) === true;

  return {
    hasOsUpgrade,
    hasCloudSubscription,
    get bannerPosition() { return bannerPosition; },
    get pauseUntil() {
      return hasOsUpgrade && Number.isSafeInteger(pauseUntil) && pauseUntil <= 8.64e15 && pauseUntil > Date.now()
        ? pauseUntil : 0;
    },
    get contentOffloaded() { return contentOffloaded; },
    setBannerPosition(position) {
      bannerPosition = position;
      saveSetting('notificationPosition', position);
    },
    pauseSounds(minutes) {
      if (!hasOsUpgrade) return;
      pauseUntil = Date.now() + minutes * 60000;
      saveSetting('notificationSoundsPausedUntil', pauseUntil);
    },
    resumeSounds() {
      pauseUntil = 0;
      saveSetting('notificationSoundsPausedUntil', 0);
    },
    offloadContent() {
      if (!hasCloudSubscription || contentOffloaded) return;
      contentOffloaded = true;
      saveSetting('contentOffloaded', true);
    }
  };
}

export function createSettings(tablet) {
  const preferences = tablet.preferences;
  const {hasOsUpgrade, hasCloudSubscription} = preferences;
  const software = 'BotOS ' + osVersion + (hasOsUpgrade ? ' Plus' : '');
  const size = number.format(offloadSizeMb) + ' MB';
  const about = element('section', 'settings-panel', element('h3', '', 'About'),
    element('dl', 'settings-details',
      element('dt', '', 'Device name'), element('dd', '', 'Eggbot’s tablet'),
      element('dt', '', 'Model number'), element('dd', '', 'BotTab 16 · BT-T16'),
      element('dt', '', 'Software'), element('dd', '', software)));

  const usage = element('p', 'settings-usage');
  usage.setAttribute('role', 'status');
  const meter = element('meter', 'settings-meter');
  meter.max = storageCapacityMb;
  meter.setAttribute('aria-label', 'Storage used');
  const cloudStatus = element('p', 'muted');
  const cloudAction = button(hasCloudSubscription ? 'Offload content' : 'View subscription', () => {
    if (!hasCloudSubscription) {
      tablet.openStoreListing('botcloud');
      return;
    }
    preferences.offloadContent();
    refreshStorage();
  }, 'primary');
  const storage = element('section', 'settings-panel',
    element('div', 'settings-panel-heading', element('h3', '', 'Storage'),
      element('p', 'muted', number.format(storageCapacityMb) + ' MB total')),
    meter, usage, element('h4', '', 'Offload content to the cloud'), cloudStatus, cloudAction);

  const positions = ['top', 'bottom'].map(position =>
    button(position === 'top' ? 'Top' : 'Bottom', () => {
      preferences.setBannerPosition(position);
      refreshPosition();
    }));
  const placement = element('div', 'settings-positions actions', ...positions);
  placement.setAttribute('role', 'group');
  placement.setAttribute('aria-label', 'Banner position');
  const soundStatus = element('p', 'muted');
  soundStatus.setAttribute('role', 'status');
  const resume = button('Resume sounds', () => {
    preferences.resumeSounds();
    refreshSounds();
  });
  const durations = [[15, '15 min'], [60, '1 hour'], [480, '8 hours']];
  const pauseControls = element('div', 'actions', ...durations.map(([minutes, label]) => button(label, () => {
    preferences.pauseSounds(minutes);
    refreshSounds();
  })), resume);
  pauseControls.hidden = !hasOsUpgrade;
  const notifications = element('section', 'settings-panel', element('h3', '', 'Notifications'),
    element('h4', '', 'Banner position'), placement,
    element('h4', '', 'Notification sounds'), soundStatus, pauseControls);

  const upgrade = element('section', 'settings-panel', element('h3', '', tabletProducts.botos_plus.name),
    element('p', 'muted', hasOsUpgrade ? 'Installed. You can pause notification chimes.' :
      'Pause notification chimes while banners and unread counts keep coming.'),
    hasOsUpgrade ? null : button('View upgrade', () => tablet.openStoreListing('botos_plus'), 'primary'));

  const view = element('section', 'settings-app', element('div', 'app-content',
    element('header', 'app-heading', tablet.art('settings'), element('h2', '', 'Settings')),
    element('div', 'settings-grid', element('div', 'settings-column', about, storage),
      element('div', 'settings-column', notifications, upgrade))));

  function refreshStorage() {
    const available = tablet.freeSpaceMb;
    const used = storageCapacityMb - available;
    meter.value = used;
    usage.textContent = number.format(used) + ' MB used · ' + number.format(available) + ' MB available';
    cloudStatus.textContent = preferences.contentOffloaded ? size + ' reclaimed.' : hasCloudSubscription
      ? 'Offload cached media to reclaim ' + size + '.' : 'Free up ' + size + ' with a BotCloud subscription.';
    if (preferences.contentOffloaded && document.activeElement === cloudAction) {
      usage.tabIndex = -1;
      usage.focus();
    }
    cloudAction.hidden = preferences.contentOffloaded;
  }

  function refreshPosition() {
    positions.forEach((control, index) => {
      control.setAttribute('aria-pressed', String(preferences.bannerPosition === (index ? 'bottom' : 'top')));
    });
  }

  function refreshSounds() {
    const expiry = preferences.pauseUntil;
    const status = expiry ? 'Paused until ' + shortTime.format(expiry) :
      hasOsUpgrade ? 'Chimes are on.' : 'Timed pauses require BotOS Plus.';
    if (soundStatus.textContent !== status) soundStatus.textContent = status;
    if (!expiry && document.activeElement === resume) pauseControls.firstElementChild.focus();
    resume.hidden = !expiry;
  }

  return {
    view,
    open() {
      refreshStorage();
      refreshPosition();
      refreshSounds();
    },
    tick: refreshSounds
  };
}
