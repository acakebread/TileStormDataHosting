// Copyright 2026 massivehadron.com ltd.

import {button, element, loadSetting, number, saveSetting, shortTime} from './ui.js';
import {buyPurchase, hasPurchase, hasSilverBotCloud, redeemPromotionCode, subscriptionTier, syncPurchases} from './purchases.js?v=high-scores';
import {acceptMoniker, loadPlayerProfile, playerId, playerMoniker, savePlayerMoniker, savePlayerProfile} from './high-scores.js?v=profile-keep';

export const osVersion = '9.0';
export const storageCapacityMb = 16000;
export const offloadSizeMb = 4000;
export const botOsPlusProduct = 'botosplus';
export const botCloudProduct = 'botcloud';
export const tabletProducts = {
  [botOsPlusProduct]: {
    name: 'BotOS Plus',
    description: 'One-time upgrade to switch notifications off until you turn them back on.',
    icon: 'settings'
  },
  [botCloudProduct]: {
    name: 'BotCloud',
    description: 'Offload cached media and free up ' + number.format(offloadSizeMb) + ' MB.',
    art: './art/botcloud.jpg'
  }
};

export function createTabletPreferences() {
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const params = new URLSearchParams(location.search);
  const previewOsUpgrade = localPreview && params.get('preview-botos-plus') === '1';
  const previewBotCloud = localPreview && params.get('preview-botcloud') === '1';
  let bannerPosition = loadSetting('notificationPosition', 'top') === 'bottom' ? 'bottom' : 'top';
  let soundsEnabled = loadSetting('notificationSoundsEnabled', true) !== false;
  let pauseUntil = loadSetting('notificationsPausedUntil', 0);
  let notificationsDisabled = loadSetting('notificationsDisabled', false) === true;
  let contentOffloaded = loadSetting('contentOffloaded', false) === true;

  return {
    get hasOsUpgrade() { return previewOsUpgrade || hasPurchase(botOsPlusProduct); },
    get hasCloudAccess() { return previewBotCloud || hasPurchase(botCloudProduct) || hasSilverBotCloud(); },
    get bannerPosition() { return bannerPosition; },
    get soundsEnabled() { return soundsEnabled; },
    get notificationsPausedUntil() {
      return Number.isSafeInteger(pauseUntil) && pauseUntil <= 8.64e15 && pauseUntil > Date.now()
        ? pauseUntil : 0;
    },
    get notificationsDisabled() { return notificationsDisabled && this.hasOsUpgrade; },
    get notificationsSuppressed() { return this.notificationsDisabled || Boolean(this.notificationsPausedUntil); },
    get contentOffloaded() { return contentOffloaded; },
    setBannerPosition(position) {
      bannerPosition = position;
      saveSetting('notificationPosition', position);
    },
    setSoundsEnabled(enabled) {
      soundsEnabled = enabled;
      saveSetting('notificationSoundsEnabled', enabled);
    },
    pauseNotifications(minutes) {
      if (!Number.isFinite(minutes) || minutes <= 0) return;
      notificationsDisabled = false;
      saveSetting('notificationsDisabled', false);
      pauseUntil = Date.now() + minutes * 60000;
      saveSetting('notificationsPausedUntil', pauseUntil);
    },
    setNotificationsDisabled(disabled) {
      if (disabled && !this.hasOsUpgrade) return;
      notificationsDisabled = disabled;
      saveSetting('notificationsDisabled', disabled);
      if (disabled) {
        pauseUntil = 0;
        saveSetting('notificationsPausedUntil', 0);
      }
    },
    resumeNotifications() {
      pauseUntil = 0;
      notificationsDisabled = false;
      saveSetting('notificationsPausedUntil', 0);
      saveSetting('notificationsDisabled', false);
    },
    offloadContent() {
      if (!this.hasCloudAccess || contentOffloaded) return;
      contentOffloaded = true;
      saveSetting('contentOffloaded', true);
    }
  };
}

export function createSettings(tablet) {
  const preferences = tablet.preferences;
  const software = element('dd');
  const size = number.format(offloadSizeMb) + ' MB';
  const about = element('section', 'settings-panel', element('h3', '', 'About'),
    element('dl', 'settings-details',
      element('dt', '', 'Device name'), element('dd', '', 'Eggbot’s tablet'),
      element('dt', '', 'Model number'), element('dd', '', 'BotTab 16 · BT-T16'),
      element('dt', '', 'Software'), software));

  // Nickname is the profile moniker: the only public player name (nickname, handle, alias).
  const nickname = element('input');
  nickname.type = 'text';
  nickname.maxLength = 48;
  nickname.autocomplete = 'nickname';
  nickname.placeholder = 'Nickname';
  nickname.setAttribute('aria-label', 'Nickname');
  nickname.value = playerMoniker();
  const playerStatus = element('p', 'muted');
  playerStatus.setAttribute('role', 'status');
  const saveNickname = element('button', 'primary', 'Save nickname');
  saveNickname.type = 'submit';
  const nicknameForm = element('form', 'promotion-entry', nickname, saveNickname);
  nicknameForm.addEventListener('submit', async event => {
    event.preventDefault();
    const moniker = acceptMoniker(nickname.value);
    if (!moniker) {
      playerStatus.textContent = 'Enter a nickname of up to 48 characters.';
      return;
    }
    saveNickname.disabled = true;
    playerStatus.textContent = 'Saving nickname…';
    savePlayerMoniker(moniker);
    try {
      const reply = await savePlayerProfile({moniker});
      nickname.value = playerMoniker();
      playerStatus.textContent = reply.accepted
        ? 'Saved. High scores now show ' + (reply.label || moniker) + '.'
        : 'A newer nickname was saved on another device. This tablet is now using ' + (reply.label || 'that nickname') + '.';
    } catch {
      playerStatus.textContent = 'Saved on this tablet. The high score table could not be reached.';
    } finally {
      saveNickname.disabled = false;
    }
  });
  const player = element('section', 'settings-panel', element('h3', '', 'Player profile'),
    element('p', 'muted', 'Your nickname is the name on the high score tables.'),
    nicknameForm, playerStatus);
  loadPlayerProfile().then(() => {
    nickname.value = playerMoniker();
    if (!playerMoniker()) return playerId().then(id => {
      playerStatus.textContent = 'High scores currently show ' + id.slice(0, 12) + '.';
    });
  }).catch(() => {});

  const usage = element('p', 'settings-usage');
  usage.setAttribute('role', 'status');
  const meter = element('meter', 'settings-meter');
  meter.max = storageCapacityMb;
  meter.setAttribute('aria-label', 'Storage used');
  const cloudStatus = element('p', 'muted');
  const registration = element('a', '', 'Register or manage your email');
  registration.href = '../membership.html';
  let displayedCloudAccess;
  const cloudAction = button('View BotCloud', () => {
    if (!preferences.hasCloudAccess) {
      tablet.openStoreListing(botCloudProduct);
      return;
    }
    preferences.offloadContent();
    refreshStorage();
  }, 'primary');
  const storage = element('section', 'settings-panel',
    element('div', 'settings-panel-heading', element('h3', '', 'Storage'),
      element('p', 'muted', number.format(storageCapacityMb) + ' MB total')),
    meter, usage, element('h4', '', 'Offload content to the cloud'), cloudStatus, cloudAction, registration);

  const positions = ['top', 'bottom'].map(position =>
    button(position === 'top' ? 'Top' : 'Bottom', () => {
      preferences.setBannerPosition(position);
      refreshPosition();
    }));
  const placement = element('div', 'settings-toggle actions', ...positions);
  placement.setAttribute('role', 'group');
  placement.setAttribute('aria-label', 'Banner position');
  const soundButtons = [true, false].map(enabled => button(enabled ? 'On' : 'Off', () => {
    preferences.setSoundsEnabled(enabled);
    refreshSoundButtons();
  }));
  const sounds = element('div', 'settings-toggle actions', ...soundButtons);
  sounds.setAttribute('role', 'group');
  sounds.setAttribute('aria-label', 'Notification sounds');
  const pauseStatus = element('p', 'muted');
  pauseStatus.setAttribute('role', 'status');
  const resume = button('Resume notifications', () => {
    preferences.resumeNotifications();
    refreshPause();
  });
  const durations = [[15, '15 min'], [60, '1 hour'], [480, '8 hours']];
  const pauseOff = button('Off', () => {
    preferences.setNotificationsDisabled(!preferences.notificationsDisabled);
    if (preferences.notificationsDisabled) tablet.dismissNotification();
    refreshPause();
  });
  const pauseControls = element('div', 'actions', ...durations.map(([minutes, label]) => button(label, () => {
    preferences.pauseNotifications(minutes);
    tablet.dismissNotification();
    refreshPause();
  })), pauseOff);
  pauseControls.setAttribute('role', 'group');
  pauseControls.setAttribute('aria-label', 'Pause duration');
  const notifications = element('section', 'settings-panel', element('h3', '', 'Notifications'),
    element('h4', '', 'Banner position'), placement,
    element('h4', '', 'Notification sounds'), sounds,
    element('h4', '', 'Pause notifications'), pauseControls, pauseStatus, resume);

  const upgradeStatus = element('p', 'muted');
  const upgradeAction = button('View upgrade', () => tablet.openStoreListing(botOsPlusProduct), 'primary');
  const upgrade = element('section', 'settings-panel', element('h3', '', tabletProducts[botOsPlusProduct].name),
    upgradeStatus, upgradeAction);

  const syncStatus = element('p', 'muted');
  syncStatus.setAttribute('role', 'status');
  const sync = button('Sync purchases', async () => {
    sync.disabled = true;
    syncStatus.hidden = false;
    syncStatus.textContent = 'Syncing purchases…';
    try {
      syncStatus.textContent = await syncPurchases({preferWebGL: true})
        ? 'Purchases are up to date.' : 'Couldn’t finish syncing purchases. Try again shortly.';
    } finally {
      sync.disabled = false;
    }
  });
  syncStatus.hidden = true;
  const purchases = element('section', 'settings-panel', element('h3', '', 'Purchases'), sync, syncStatus);

  const certificate = element('span', 'subscription-certificate');
  certificate.setAttribute('aria-hidden', 'true');
  const tierName = element('strong');
  const tiers = ['Bronze', 'Silver', 'Gold', 'Platinum'];
  const tierButtons = tiers.map(tier => button(tier, () => {
    if (buyPurchase(tier.toLowerCase())) tablet.toast('Continue in the checkout tab when ready.');
    else tablet.toast('Allow popups to open checkout.');
  }));
  const subscription = element('section', 'settings-panel', element('h3', '', 'Subscription'),
    element('div', 'subscription-level', certificate, tierName),
    element('p', 'muted', 'Subscriptions unlock features and apps. See BotStore for details.'),
    element('h4', '', 'Upgrade subscription'),
    element('div', 'actions', ...tierButtons));

  const promotionCode = element('input');
  promotionCode.type = 'text';
  promotionCode.required = true;
  promotionCode.maxLength = 260;
  promotionCode.autocomplete = 'off';
  promotionCode.spellcheck = false;
  promotionCode.setAttribute('aria-label', 'Promotion code');
  const redeem = element('button', 'primary', 'Redeem');
  redeem.type = 'submit';
  const promotionStatus = element('p', 'muted');
  promotionStatus.setAttribute('role', 'status');
  const promotionForm = element('form', 'promotion-entry', promotionCode, redeem);
  promotionForm.addEventListener('submit', async event => {
    event.preventDefault();
    const code = promotionCode.value.trim();
    if (!code || redeem.disabled) return;
    redeem.disabled = promotionCode.readOnly = true;
    promotionStatus.textContent = 'Checking code…';
    try {
      promotionStatus.textContent = await redeemPromotionCode(code);
      promotionCode.value = '';
    } catch (error) {
      promotionStatus.textContent = error.status ? error.message : 'Could not check the code. Try again.';
    } finally {
      redeem.disabled = promotionCode.readOnly = false;
    }
  });
  const promotion = element('section', 'settings-panel', element('h3', '', 'Promotion code'),
    promotionForm, promotionStatus);

  const view = element('section', 'settings-app', element('div', 'app-content',
    element('header', 'app-heading', tablet.art('settings'), element('h2', '', 'Settings')),
    element('div', 'settings-grid',
      element('div', 'settings-column', about, storage, purchases, subscription),
      element('div', 'settings-column', notifications, upgrade, player, promotion))));

  function refreshSubscription() {
    const tier = subscriptionTier();
    if (tierName.textContent === tier) return;
    certificate.dataset.tier = tier;
    tierName.textContent = tier;
    const rank = tiers.indexOf(tier);
    tierButtons.forEach((control, index) => { control.disabled = index <= rank; });
  }

  function refreshStorage() {
    const {contentOffloaded, hasCloudAccess} = preferences;
    displayedCloudAccess = hasCloudAccess;
    const available = tablet.freeSpaceMb;
    const used = storageCapacityMb - available;
    meter.value = used;
    usage.textContent = number.format(used) + ' MB used · ' + number.format(available) + ' MB available';
    cloudStatus.textContent = contentOffloaded ? size + ' reclaimed.' : hasCloudAccess
      ? 'Offload cached media to reclaim ' + size + '.' : 'Free up ' + size + ' with BotCloud.';
    cloudAction.textContent = hasCloudAccess ? 'Offload content' : 'View BotCloud';
    if (contentOffloaded && document.activeElement === cloudAction) {
      usage.tabIndex = -1;
      usage.focus();
    }
    cloudAction.hidden = contentOffloaded;
  }

  function refreshPosition() {
    positions.forEach((control, index) => {
      control.setAttribute('aria-pressed', String(preferences.bannerPosition === (index ? 'bottom' : 'top')));
    });
  }

  function refreshSoundButtons() {
    soundButtons[0].setAttribute('aria-pressed', String(preferences.soundsEnabled));
    soundButtons[1].setAttribute('aria-pressed', String(!preferences.soundsEnabled));
  }

  function refreshPause() {
    const {hasOsUpgrade} = preferences;
    const disabled = preferences.notificationsDisabled;
    const expiry = preferences.notificationsPausedUntil;
    const status = disabled ? 'Notifications are off.' :
      expiry ? 'Paused until ' + shortTime.format(expiry) : '';
    if (pauseStatus.textContent !== status) pauseStatus.textContent = status;
    pauseStatus.hidden = !status;
    const paused = disabled || Boolean(expiry);
    if (!paused && document.activeElement === resume) pauseControls.firstElementChild.focus();
    if (!hasOsUpgrade && document.activeElement === pauseOff) pauseControls.firstElementChild.focus();
    resume.textContent = disabled ? 'Turn on' : 'Resume notifications';
    resume.hidden = !paused;
    pauseOff.hidden = !hasOsUpgrade;
    pauseOff.setAttribute('aria-pressed', String(disabled));
    upgradeAction.hidden = hasOsUpgrade;
    const version = 'BotOS ' + osVersion + (hasOsUpgrade ? ' Plus' : '');
    if (software.textContent !== version) {
      software.textContent = version;
      upgradeStatus.textContent = hasOsUpgrade ? 'Installed. You can switch notifications off.' :
        'Switch notifications off until you turn them back on.';
    }
  }

  window.addEventListener('tilestorm-purchases-changed', refreshStorage);
  return {
    view,
    open() {
      refreshStorage();
      refreshPosition();
      refreshSoundButtons();
      refreshPause();
      refreshSubscription();
      syncPurchases();
    },
    tick() {
      refreshPause();
      refreshSubscription();
      if (displayedCloudAccess !== preferences.hasCloudAccess) refreshStorage();
    }
  };
}
